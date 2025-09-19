import { Module } from './module.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const midiToName = (m) => {
  const idx = ((m % 12) + 12) % 12;
  const oct = Math.floor(m / 12) - 1;
  return `${NOTE_NAMES[idx]}${oct}`;
};
const noteNameToMidi = (name) => {
  // name like C#4
  const m = name.match(/^([A-G]#?)(-?\d)$/);
  if (!m) return 60;
  const idx = NOTE_NAMES.indexOf(m[1]);
  const oct = parseInt(m[2], 10);
  return (oct + 1) * 12 + idx; // MIDI standard: C-1 = 0
};

function buildNoteOptions(fromOct = 2, toOct = 6, defaultMidi = 60) {
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
      <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <span>Steps / Gate</span>
        <div style="display:inline-flex;gap:6px;">
          <button class="btn" data-role="dup">Duplicate</button>
          <button class="btn" data-role="expand">Expand</button>
        </div>
      </label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
  <div><small>Steps</small><input type="number" min="1" step="1" value="${this.steps}" /></div>
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

    // Duplicate and Fullscreen editor buttons
    stepsCtl.querySelector('[data-role=dup]')?.addEventListener('click', () => {
      this._duplicatePattern();
    });
    stepsCtl.querySelector('[data-role=expand]')?.addEventListener('click', () => this._openFullscreenEditor());

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

  _openFullscreenEditor() {
    const closeModal = () => {
      backdrop.remove();
      // re-render small grid to reflect changes
      if (this.gridBody) this._renderGrid();
    };
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const panel = document.createElement('div');
    panel.className = 'modal-panel';
    panel.innerHTML = `
      <div class="modal-header">
        <div class="title">Sequencer – Fullscreen Editor</div>
        <button class="btn" data-role="close">Close</button>
      </div>
      <div class="modal-content"></div>
    `;
    const content = panel.querySelector('.modal-content');
    const controls = document.createElement('div');
    controls.className = 'control';
    controls.innerHTML = `
      <div style="display:grid;grid-template-columns: repeat(12, minmax(90px, auto)); gap:10px; align-items:center;">
  <div><small>Steps</small><input data-role="fs-steps" type="number" min="1" step="1" value="${this.steps}" /></div>
        <div><small>Gate (%)</small><input data-role="fs-gate" type="range" min="0" max="1" step="0.01" value="${this.gateLen}" /></div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn" data-role="fs-clear">Clear</button>
          <button class="btn" data-role="fs-shift-left">Shift ◀</button>
          <button class="btn" data-role="fs-shift-right">Shift ▶</button>
          <button class="btn" data-role="fs-tr-down">Tr -1</button>
          <button class="btn" data-role="fs-tr-up">Tr +1</button>
          <button class="btn" data-role="fs-oct-down">Oct -1</button>
          <button class="btn" data-role="fs-oct-up">Oct +1</button>
          <button class="btn" data-role="fs-random">Random</button>
      <button class="btn" data-role="fs-dup">Duplicate</button>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <small>View</small>
          <div style="display:inline-flex;gap:6px;">
            <button class="btn" data-role="view-classic">Classic</button>
            <button class="btn" data-role="view-quick">Quick Edit</button>
          </div>
        </div>
      </div>
    `;
    const gridWrap = document.createElement('div');
    gridWrap.className = 'control';
    gridWrap.innerHTML = `<div class="seq-grid-wrap"><div class="seq-grid" data-role="fs-grid"></div></div>`;
    const fsGrid = gridWrap.querySelector('[data-role=fs-grid]');

    content.appendChild(controls);
    content.appendChild(gridWrap);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
    const onClose = () => closeModal();
    panel.querySelector('[data-role=close]')?.addEventListener('click', onClose);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) onClose(); });
    const escHandler = (e) => { if (e.key === 'Escape') { onClose(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);

    // Bind fullscreen controls
    const fsSteps = controls.querySelector('[data-role=fs-steps]');
    const fsGate = controls.querySelector('[data-role=fs-gate]');
    const fsClear = controls.querySelector('[data-role=fs-clear]');
    const fsShiftL = controls.querySelector('[data-role=fs-shift-left]');
    const fsShiftR = controls.querySelector('[data-role=fs-shift-right]');
    const fsTrDn = controls.querySelector('[data-role=fs-tr-down]');
    const fsTrUp = controls.querySelector('[data-role=fs-tr-up]');
    const fsOctDn = controls.querySelector('[data-role=fs-oct-down]');
    const fsOctUp = controls.querySelector('[data-role=fs-oct-up]');
    const fsRandom = controls.querySelector('[data-role=fs-random]');
    const fsDup = controls.querySelector('[data-role=fs-dup]');
    const viewClassic = controls.querySelector('[data-role=view-classic]');
    const viewQuick = controls.querySelector('[data-role=view-quick]');
    fsSteps.addEventListener('input', () => this.setSteps(Number(fsSteps.value)));
    fsGate.addEventListener('input', () => this.gateLen = Number(fsGate.value));
    fsClear.addEventListener('click', () => { this.pattern.forEach(p => { p.on = false; }); this._renderGridInto(fsGrid); });
    fsShiftL.addEventListener('click', () => { this.pattern.push(this.pattern.shift()); this._renderGridInto(fsGrid); });
    fsShiftR.addEventListener('click', () => { this.pattern.unshift(this.pattern.pop()); this._renderGridInto(fsGrid); });
    fsTrDn.addEventListener('click', () => { this.pattern.forEach(p => p.midi = clamp(p.midi - 1, 0, 108)); this._renderGridInto(fsGrid); });
    fsTrUp.addEventListener('click', () => { this.pattern.forEach(p => p.midi = clamp(p.midi + 1, 0, 108)); this._renderGridInto(fsGrid); });
    fsOctDn.addEventListener('click', () => { this.pattern.forEach(p => p.midi = clamp(p.midi - 12, 0, 108)); this._renderGridInto(fsGrid); });
    fsOctUp.addEventListener('click', () => { this.pattern.forEach(p => p.midi = clamp(p.midi + 12, 0, 108)); this._renderGridInto(fsGrid); });
    fsRandom.addEventListener('click', () => { this.pattern.forEach(p => { p.on = Math.random() < 0.6; p.midi = clamp(36 + Math.floor(Math.random() * 36), 0, 108); }); this._renderGridInto(fsGrid); });
    fsDup.addEventListener('click', () => { this._duplicatePattern(); fsSteps.value = String(this.steps); this._renderGridInto(fsGrid); });

    // View toggle: default to Classic for clarity
    this._fsMode = 'classic';
    const updateViewButtons = () => {
      viewClassic.classList.toggle('active', this._fsMode === 'classic');
      viewQuick.classList.toggle('active', this._fsMode === 'quick');
    };
    viewClassic.addEventListener('click', () => { this._fsMode = 'classic'; updateViewButtons(); this._renderGridInto(fsGrid); });
    viewQuick.addEventListener('click', () => { this._fsMode = 'quick'; updateViewButtons(); this._renderGridInto(fsGrid); });
    updateViewButtons();

    this._renderGridInto(fsGrid);
  }

  _renderGridInto(container) {
    if (!container) return;
    if (this._fsMode === 'classic') {
      this._renderGridClassic(container);
    } else {
      this._renderGridQuick(container);
    }
  }

  _renderGridClassic(container) {
    const { opts } = buildNoteOptions(-1, 6, 48);
    container.parentElement?.parentElement?.style.setProperty('--seq-steps', this.steps);
    container.style.gridTemplateColumns = `repeat(${this.steps}, 200px)`;
    container.innerHTML = '';
    for (let i = 0; i < this.steps; i++) {
      const step = this.pattern[i] || { on: false, midi: 48 };
      const cell = document.createElement('div');
      cell.className = 'seq-step';
      cell.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
          <small>Step ${i + 1}</small>
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;"><input data-role="on" type="checkbox" ${step.on ? 'checked' : ''}/> On</label>
        </div>
        <div style="display:grid;grid-template-columns: 1fr auto auto; gap:6px; align-items:center; margin-top:6px;">
          <select data-role="note" style="width:100%;background:#0d1330;color:#e6e8f0;border:1px solid #2a3468;border-radius:4px;padding:8px;font-size:13px;">
            ${opts.map(o => `<option value="${o.midi}" ${o.midi === step.midi ? 'selected' : ''}>${o.name}</option>`).join('')}
          </select>
          <button class="btn" data-role="semi-down" title="Semitone -1">-</button>
          <button class="btn" data-role="semi-up" title="Semitone +1">+</button>
        </div>
        <div style="display:grid;grid-template-columns: auto auto 1fr; gap:6px; align-items:center; margin-top:6px;">
          <button class="btn" data-role="oct-down" title="Octave -1">Oct-</button>
          <button class="btn" data-role="oct-up" title="Octave +1">Oct+</button>
          <button class="btn" data-role="play" title="Audition">Play</button>
        </div>
      `;
      const onCb = cell.querySelector('[data-role=on]');
      const sel = cell.querySelector('[data-role=note]');
      const semiDn = cell.querySelector('[data-role=semi-down]');
      const semiUp = cell.querySelector('[data-role=semi-up]');
      const octDn = cell.querySelector('[data-role=oct-down]');
      const octUp = cell.querySelector('[data-role=oct-up]');
      const play = cell.querySelector('[data-role=play]');
      onCb.addEventListener('input', () => this.pattern[i].on = onCb.checked);
      sel.addEventListener('input', () => this.pattern[i].midi = Number(sel.value));
      semiDn.addEventListener('click', () => { this.pattern[i].midi = clamp((this.pattern[i].midi | 0) - 1, 0, 108); sel.value = String(this.pattern[i].midi); });
      semiUp.addEventListener('click', () => { this.pattern[i].midi = clamp((this.pattern[i].midi | 0) + 1, 0, 108); sel.value = String(this.pattern[i].midi); });
      octDn.addEventListener('click', () => { this.pattern[i].midi = clamp((this.pattern[i].midi | 0) - 12, 0, 108); sel.value = String(this.pattern[i].midi); });
      octUp.addEventListener('click', () => { this.pattern[i].midi = clamp((this.pattern[i].midi | 0) + 12, 0, 108); sel.value = String(this.pattern[i].midi); });
      play.addEventListener('click', () => this._auditionMidi(this.pattern[i].midi));
      container.appendChild(cell);
    }
  }

  _renderGridQuick(container) {
    container.parentElement?.parentElement?.style.setProperty('--seq-steps', this.steps);
    container.style.gridTemplateColumns = `repeat(${this.steps}, 120px)`;
    container.innerHTML = '';
    let painting = null; // true/false or null
    const setOn = (idx, val) => { if (!this.pattern[idx]) this.pattern[idx] = { on: false, midi: 48 }; this.pattern[idx].on = val; };
    const changeMidi = (idx, delta) => { const p = this.pattern[idx]; if (!p) return; p.midi = clamp((p.midi | 0) + delta, 0, 108); };
    for (let i = 0; i < this.steps; i++) {
      const cell = document.createElement('div');
      cell.className = 'seq-step';
      cell.style.cursor = 'pointer';
      const step = this.pattern[i] || { on: false, midi: 48 };
      const noteLabel = midiToName(step.midi || 48);
      cell.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
          <small>${String(i + 1).padStart(2, '0')}</small>
          <span data-role="on" style="font-size:10px;opacity:.85;">${step.on ? 'On' : 'Off'}</span>
        </div>
        <div data-role="note" style="margin-top:6px;background:#0b1235;border:1px solid #2a3468;border-radius:6px;padding:10px;text-align:center;font-weight:600;">${noteLabel}</div>
      `;
      const onSpan = cell.querySelector('[data-role=on]');
      const noteEl = cell.querySelector('[data-role=note]');
      const refresh = () => {
        onSpan.textContent = this.pattern[i].on ? 'On' : 'Off';
        noteEl.textContent = midiToName(this.pattern[i].midi);
      };
      cell.addEventListener('mousedown', (e) => {
        painting = !(this.pattern[i].on);
        setOn(i, painting);
        refresh();
      });
      cell.addEventListener('mouseenter', (e) => {
        if (painting !== null && e.buttons === 1) { setOn(i, painting); refresh(); }
      });
      document.addEventListener('mouseup', () => { painting = null; }, { once: true });
      onSpan.addEventListener('click', () => { setOn(i, !this.pattern[i].on); refresh(); });
      noteEl.addEventListener('click', (e) => { changeMidi(i, e.shiftKey ? -1 : 1); refresh(); });
      noteEl.addEventListener('wheel', (e) => { e.preventDefault(); const delta = e.deltaY > 0 ? -1 : 1; changeMidi(i, delta); refresh(); });
      noteEl.tabIndex = 0;
      noteEl.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') { changeMidi(i, 1); refresh(); }
        else if (e.key === 'ArrowDown') { changeMidi(i, -1); refresh(); }
        else if (e.key === '+') { changeMidi(i, 12); refresh(); }
        else if (e.key === '-') { changeMidi(i, -12); refresh(); }
      });
      container.appendChild(cell);
    }
  }

  _auditionMidi(midi, dur = 0.2) {
    const hz = midiToHz(midi | 0);
    const osc = this.audioCtx.createOscillator();
    const g = this.audioCtx.createGain();
    g.gain.value = 0.0001;
    osc.type = 'sine';
    osc.frequency.value = hz;
    osc.connect(g).connect(this.audioCtx.destination);
    const t = this.audioCtx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start();
    osc.stop(t + dur + 0.02);
    setTimeout(() => { try { osc.disconnect(); g.disconnect(); } catch { } }, (dur + 0.05) * 1000);
  }

  _renderGrid() {
    // Expand selectable range to go lower (C-1 .. B6)
    const { opts } = buildNoteOptions(-1, 6, 48);
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
          <small>Step ${i + 1}</small>
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;"><input type="checkbox" ${step.on ? 'checked' : ''}/> On</label>
        </div>
        <select style="width:100%;margin-top:6px;background:#0d1330;color:#e6e8f0;border:1px solid #2a3468;border-radius:4px;padding:4px">
          ${opts.map(o => `<option value="${o.midi}" ${o.midi === step.midi ? 'selected' : ''}>${o.name}</option>`).join('')}
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
    this.steps = Math.max(1, (n | 0));
    if (this.pattern.length < this.steps) {
      const add = Array.from({ length: this.steps - this.pattern.length }, () => ({ on: false, midi: 48 }));
      this.pattern = this.pattern.concat(add);
    } else if (this.pattern.length > this.steps) {
      this.pattern.length = this.steps;
    }
    if (this._stepsNum) this._stepsNum.value = String(this.steps);
    this._renderGrid();
  }

  // Duplicate pattern to double length (unlimited)
  _duplicatePattern() {
    const cur = this.steps | 0;
    if (!cur || cur <= 0) return;
    const target = cur * 2;
    // Ensure we have at least cur items
    while (this.pattern.length < cur) this.pattern.push({ on: false, midi: 48 });
    const src = this.pattern.slice(0, cur).map(p => ({ on: !!p.on, midi: Number.isFinite(p?.midi) ? (p.midi | 0) : 48 }));
    const extra = src.slice(0, target - cur).map(p => ({ ...p }));
    this.pattern = src.concat(extra);
    this.setSteps(target);
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
        transport.subscribeClock(this.id, (evt) => {
          if (!this.isRunning) return;
          if (evt && evt.reset) {
            // jump to step 0 and clear highlights; don't schedule a note on reset tick
            this._stepIndex = 0;
            if (this.gridBody) this.gridBody.querySelectorAll('.seq-step').forEach(el => el.classList.remove('active'));
            return;
          }
          this._advanceOneStep(evt);
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

  _advanceOneStep(evt) {
    const t = evt?.time ?? this.audioCtx.currentTime;
    const idx = this._stepIndex % this.steps;
    const st = this.pattern[idx];
    // highlight active step
    if (this.gridBody) {
      this.gridBody.querySelectorAll('.seq-step').forEach((el, i) => el.classList.toggle('active', i === idx));
    }
    if (st && st.on) {
      const bpm = evt?.bpm ?? this._getBpm();
      const hz = midiToHz(st.midi);
      const gateDur = (60 / bpm) / 4 * this.gateLen;
      // schedule audio at exact time
      this.pitch.offset.cancelScheduledValues(t);
      this.pitch.offset.setValueAtTime(hz, t);
      this.gate.offset.cancelScheduledValues(t);
      this.gate.offset.setValueAtTime(1, t);
      this.gate.offset.setValueAtTime(0, t + gateDur);
      // schedule subscribers at the right wall-clock time
      const nowCtx = this.audioCtx.currentTime;
      const delayOn = Math.max(0, (t - nowCtx) * 1000);
      const delayOff = Math.max(0, (t + gateDur - nowCtx) * 1000);
      setTimeout(() => { this._gateSubs.forEach(cb => { try { cb('on'); } catch { } }); }, delayOn);
      setTimeout(() => { this._gateSubs.forEach(cb => { try { cb('off'); } catch { } }); }, delayOff);
      setTimeout(() => { this._pitchSubs.forEach(cb => { try { cb(hz, true); } catch { } }); }, delayOn);
    } else {
      this.gate.offset.setValueAtTime(0, t);
      const nowCtx = this.audioCtx.currentTime;
      const delay = Math.max(0, (t - nowCtx) * 1000);
      setTimeout(() => { this._gateSubs.forEach(cb => { try { cb('off'); } catch { } }); }, delay);
      setTimeout(() => { this._pitchSubs.forEach(cb => { try { cb(this.pitch.offset.value, false); } catch { } }); }, delay);
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
    try { this.pitch?.disconnect(); this.gate?.disconnect(); this._inClock?.disconnect(); this._inBpm?.disconnect(); this._inRun?.disconnect(); } catch { }
  }

  toJSON() {
    return { steps: this.steps, gateLen: this.gateLen, pattern: this.pattern };
  }
  fromJSON(state) {
    if (!state) return;
    if (typeof state.steps === 'number') this.setSteps(state.steps);
    if (typeof state.gateLen === 'number') this.gateLen = state.gateLen;
    if (Array.isArray(state.pattern)) this.pattern = state.pattern.map(s => ({ on: !!s.on, midi: Number.isFinite(s?.midi) ? (s.midi | 0) : 48 }));
    if (this._stepsNum) this._stepsNum.value = String(this.steps);
    if (this._gateRange) this._gateRange.value = String(this.gateLen);
    if (this.gridBody) this._renderGrid();
  }
}
