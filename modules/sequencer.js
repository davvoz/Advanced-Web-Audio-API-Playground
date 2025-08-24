import { Module } from './module.js';

// Reasonable upper bound to keep UI responsive; can be raised if needed
const MAX_STEPS = 128;

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const noteNameToMidi = (name) => {
  // name like C#4
  const m = name.match(/^([A-G]#?)(-?\d)$/);
  if (!m) return 60;
  const idx = NOTE_NAMES.indexOf(m[1]);
  const oct = parseInt(m[2], 10);
  return (oct + 1) * 12 + idx; // MIDI standard: C-1 = 0
};

function buildNoteOptions(fromOct=2, toOct=6, defaultMidi=60) {
  const opts = [];
  for (let o = fromOct; o <= toOct; o++) {
    for (let i = 0; i < 12; i++) {
      const name = `${NOTE_NAMES[i]}${o}`;
      const midi = (o + 1) * 12 + i;
      opts.push({ name, midi });
    }
  }
  const defIdx = opts.findIndex(o => o.midi === defaultMidi);
  return { opts, defIdx: defIdx >= 0 ? defIdx : 0 };
}

export class SequencerModule extends Module {
  get title() { return 'Sequencer'; }

  buildAudio() {
    const ctx = this.audioCtx;
    this.pitch = ctx.createConstantSource();
    this.pitch.offset.value = midiToHz(48); // C3 default
    this.pitch.start();
    this.gate = ctx.createConstantSource();
    this.gate.offset.value = 0;
    this.gate.start();

    this.outputs = {
      pitch: { node: this.pitch }, // connect to Oscillator.freq
      gate: { node: this.gate },   // connect to Gain.gain (or other)
    };
    // Dummy params to allow connections
    this._inClock = ctx.createGain(); this._inClock.gain.value = 0;
    this._inBpm = ctx.createGain(); this._inBpm.gain.value = 0;
    this._inRun = ctx.createGain(); this._inRun.gain.value = 0;
    this.inputs = {
      bpm: { param: this._inBpm.gain }, // Transport.bpm
      clock: { param: this._inClock.gain }, // Transport.clock pulse 0/1
      run: { param: this._inRun.gain },
    };

  // State
  this.isRunning = true; // always follow external clock
  this.bpm = 120; // used only for gate length math if no external bpm ref
    this.steps = 8;
    this.gateLen = 0.5; // 50% of step length
    this.pattern = Array.from({ length: this.steps }, (_, i) => ({ on: i % 2 === 0, midi: 48 }));
    this._timer = null;
  this._stepIndex = 0;
  this._transportRef = null;
  this._gateSubs = new Map(); // id -> cb(state: 'on'|'off')
  this._pitchSubs = new Map(); // id -> cb(hz, active)
  }

  buildControls(container) {
  this.root.classList.add('module-sequencer');
  // No internal transport or tempo; Sequencer follows external Transport

    // Steps and gate
    const stepsCtl = document.createElement('div');
    stepsCtl.className = 'control';
  stepsCtl.innerHTML = `
      <label>Steps / Gate</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
    <div><small>Steps</small><input type="number" min="1" max="${MAX_STEPS}" step="1" value="${this.steps}" /></div>
        <div><small>Gate (%)</small><input type="range" min="0" max="1" step="0.01" value="0.5" /></div>
      </div>
    `;
    const stepsNum = stepsCtl.querySelector('input[type=number]');
    const gateRange = stepsCtl.querySelector('input[type=range]');
  // sync UI with current state
  stepsNum.value = String(this.steps);
  gateRange.value = String(this.gateLen);
  this._stepsNum = stepsNum;
  this._gateRange = gateRange;
    stepsNum.addEventListener('input', () => this.setSteps(Number(stepsNum.value)));
    gateRange.addEventListener('input', () => this.gateLen = Number(gateRange.value));

    // Pattern grid
    const grid = document.createElement('div');
    grid.className = 'control';
    grid.innerHTML = `
      <label>Pattern</label>
      <div class="seq-grid-wrap">
        <div class="seq-grid"></div>
      </div>`;
    this.gridBody = grid.querySelector('.seq-grid');
    this._renderGrid();

    container.appendChild(stepsCtl);
    container.appendChild(grid);
  }

  _renderGrid() {
    // Expand selectable range to go lower (C-1 .. B6)
    const { opts } = buildNoteOptions(-1,6,48);
  if (!this.gridBody) return;
  // scale step width: ensure readability, use CSS var and fixed min width per step
  this.gridBody.parentElement.parentElement.style.setProperty('--seq-steps', this.steps);
    this.gridBody.style.gridTemplateColumns = `repeat(${this.steps}, 160px)`;
    this.gridBody.innerHTML = '';
    for (let i = 0; i < this.steps; i++) {
      const cell = document.createElement('div');
      cell.className = 'seq-step';
      const step = this.pattern[i] || { on: false, midi: 48 };
      cell.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
          <small>Step ${i+1}</small>
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;"><input type="checkbox" ${step.on?'checked':''}/> On</label>
        </div>
        <select style="width:100%;margin-top:6px;background:#0d1330;color:#e6e8f0;border:1px solid #2a3468;border-radius:4px;padding:4px">
          ${opts.map(o => `<option value="${o.midi}" ${o.midi===step.midi?'selected':''}>${o.name}</option>`).join('')}
        </select>
      `;
      const onCb = cell.querySelector('input[type=checkbox]');
      const sel = cell.querySelector('select');
      onCb.addEventListener('input', () => this.pattern[i].on = onCb.checked);
      sel.addEventListener('input', () => this.pattern[i].midi = Number(sel.value));
      this.gridBody.appendChild(cell);
    }
  }

  setSteps(n) {
    this.steps = Math.max(1, Math.min(MAX_STEPS, n|0));
    if (this.pattern.length < this.steps) {
      const add = Array.from({ length: this.steps - this.pattern.length }, () => ({ on: false, midi: 48 }));
      this.pattern = this.pattern.concat(add);
    } else if (this.pattern.length > this.steps) {
      this.pattern.length = this.steps;
    }
    if (this._stepsNum) this._stepsNum.value = String(this.steps);
    this._renderGrid();
  }

  start() { this._stepIndex = 0; }

  stop() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const now = this.audioCtx.currentTime;
    this.gate.offset.setTargetAtTime(0, now, 0.01);
    if (this.gridBody) this.gridBody.querySelectorAll('.seq-step').forEach(el => el.classList.remove('active'));
  }

  onParamConnected(portName, fromModuleId, fromPortName) {
    if (portName === 'clock' && fromPortName === 'clock') {
      // If connected to a Transport.clock, subscribe
      const transport = this.getModuleById?.(fromModuleId);
      if (transport?.subscribeClock) {
        transport.subscribeClock(this.id, () => {
          if (!this.isRunning) return;
          this._advanceOneStep();
        });
        this._transportRef = transport;
        this._extClock = true;
      } else {
        this._extClock = true; // fallback flag
      }
    }
    if (portName === 'bpm') {
      // If connected to a ConstantSource BPM, we can't read AudioParam directly. But if from a Transport, mirror bpm.
      const src = this.getModuleById?.(fromModuleId);
      if (src && typeof src.bpm === 'number') { this.bpm = src.bpm; this._transportRef = src; }
    }
  }
  onParamDisconnected(portName, fromModuleId, fromPortName) {
    if (portName === 'clock' && fromPortName === 'clock') {
      const transport = this.getModuleById?.(fromModuleId);
      if (transport?.unsubscribeClock) transport.unsubscribeClock(this.id);
      this._extClock = false;
    }
    if (portName === 'bpm' && fromPortName === 'bpm') {
      const src = this.getModuleById?.(fromModuleId);
      if (this._transportRef && this._transportRef === src) this._transportRef = null;
    }
  }

  _advanceOneStep() {
    const now = this.audioCtx.currentTime;
    const idx = this._stepIndex % this.steps;
    const st = this.pattern[idx];
    // highlight active step
    if (this.gridBody) {
      this.gridBody.querySelectorAll('.seq-step').forEach((el, i) => el.classList.toggle('active', i === idx));
    }
    if (st && st.on) {
      const bpm = this._getBpm();
      const hz = midiToHz(st.midi);
      this.pitch.offset.cancelScheduledValues(now);
  this.pitch.offset.setValueAtTime(hz, now);
  this._pitchSubs.forEach(cb => { try { cb(hz, true); } catch {} });
      this.gate.offset.cancelScheduledValues(now);
      this.gate.offset.setValueAtTime(1, now);
      this.gate.offset.setTargetAtTime(0, now + (60/bpm)/4 * this.gateLen, 0.005);
  this._gateSubs.forEach(cb => { try { cb('on'); } catch {} });
  // schedule off near the gate end
  const offMs = ((60/bpm)/4 * this.gateLen) * 1000;
  setTimeout(() => { this._gateSubs.forEach(cb => { try { cb('off'); } catch {} }); }, offMs * 0.95);
    } else {
      this.gate.offset.setTargetAtTime(0, now, 0.005);
  this._gateSubs.forEach(cb => { try { cb('off'); } catch {} });
      this._pitchSubs.forEach(cb => { try { cb(this.pitch.offset.value, false); } catch {} });
    }
    this._stepIndex++;
  }

  _getBpm() { return this._transportRef?.bpm ?? this.bpm; }

  // ADSR can subscribe to gate changes for precise on/off
  subscribeGate(id, cb) { this._gateSubs.set(id, cb); }
  unsubscribeGate(id) { this._gateSubs.delete(id); }
  // Sampler/LFO can subscribe to pitch (Hz)
  subscribePitch(id, cb) { this._pitchSubs.set(id, cb); }
  unsubscribePitch(id) { this._pitchSubs.delete(id); }

  // Resizing handled by base Module now

  dispose() {
    super.dispose();
    this.stop();
  try { this.pitch?.disconnect(); this.gate?.disconnect(); this._inClock?.disconnect(); this._inBpm?.disconnect(); this._inRun?.disconnect(); } catch {}
  }

  toJSON() {
  return { steps: this.steps, gateLen: this.gateLen, pattern: this.pattern };
  }
  fromJSON(state) {
    if (!state) return;
    if (typeof state.steps === 'number') this.setSteps(state.steps);
    if (typeof state.gateLen === 'number') this.gateLen = state.gateLen;
    if (Array.isArray(state.pattern)) this.pattern = state.pattern.map(s => ({ on: !!s.on, midi: Number(s.midi)||48 }));
  if (this._stepsNum) this._stepsNum.value = String(this.steps);
  if (this._gateRange) this._gateRange.value = String(this.gateLen);
    if (this.gridBody) this._renderGrid();
  }
}
