import { Module } from './module.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function makeClickBuffer(ctx, freq = 140, dur = 0.035) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let phase = 0;
  const twopi = Math.PI * 2;
  for (let i = 0; i < len; i++) {
    const t = i / ctx.sampleRate;
    const env = Math.exp(-t * 60);
    phase += twopi * freq / ctx.sampleRate;
    data[i] = Math.sin(phase) * env;
  }
  return buf;
}

export class DrumStationModule extends Module {
  get title() { return 'Drum Station'; }

  buildAudio() {
    const ctx = this.audioCtx;
    this._out = ctx.createGain(); this._out.gain.value = 0.9;

    this._lanes = ['Kick','Snare','CH','OH','Clap','Tom','Rim','Perc'];
    this._slots = this._lanes.map((label, i) => {
      const ch = ctx.createGain(); ch.gain.value = 0.9;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) ch.connect(pan), pan.connect(this._out); else ch.connect(this._out);
      const fallback = makeClickBuffer(ctx, 120 + i * 30);
      return { label, buffer: null, gain: ch, pan, vol: 0.9, panVal: 0, pitch: 0, muted: false, fallback };
    });

    // Sequencer state
    this._steps = 16;
    this._velocity = 1.0;
    this._pattern = Array.from({ length: this._lanes.length }, () => Array.from({ length: this._steps }, () => false));
    this._accent = Array.from({ length: this._lanes.length }, () => Array.from({ length: this._steps }, () => false));
    this._pos = 0; this._transport = null; this._tick = 0;

    this.inputs = {
      clock: { param: ctx.createGain().gain }, // for Transport clock connection
      gain: { param: this._out.gain },
    };
    this.outputs = { out: { node: this._out } };
  }

  buildControls(container) {
    this.root.classList.add('module-drum-station');
    // Master + Steps/Vel
    const head = document.createElement('div'); head.className = 'control';
    head.innerHTML = `
      <label>Drum Station</label>
      <div style="display:grid;grid-template-columns:repeat(5, minmax(0,1fr));gap:8px;align-items:center;">
        <div><small>Master</small><input data-role="master" type="range" min="0" max="1.5" step="0.01" value="0.9"></div>
        <div><small>Steps</small><input data-role="steps" type="number" min="1" max="64" step="1" value="16"></div>
        <div><small>Vel</small><input data-role="vel" type="number" min="0.1" max="1.5" step="0.1" value="1.0"></div>
        <button class="btn" data-role="clear">Clear</button>
        <button class="btn" data-role="stop">Stop All</button>
      </div>`;
    container.appendChild(head);
  const masterEl = head.querySelector('[data-role=master]');
  const stepsEl = head.querySelector('[data-role=steps]');
    const velEl = head.querySelector('[data-role=vel]');
    head.querySelector('[data-role=clear]').addEventListener('click', () => { this._pattern.forEach(r=>r.fill(false)); this._accent.forEach(r=>r.fill(false)); this._renderGrid(); });
    head.querySelector('[data-role=stop]').addEventListener('click', () => this._stopAll());
    masterEl.addEventListener('input', () => this._out.gain.setTargetAtTime(Number(masterEl.value), this.audioCtx.currentTime, 0.01));
    stepsEl.addEventListener('input', () => { this._steps = clamp(Number(stepsEl.value)||16,1,64); this._pattern.forEach(r => { if (r.length < this._steps) r.push(...Array(this._steps - r.length).fill(false)); r.length = this._steps; }); this._accent.forEach(r => { if (r.length < this._steps) r.push(...Array(this._steps - r.length).fill(false)); r.length = this._steps; }); this._renderGrid(); });
    velEl.addEventListener('input', () => { this._velocity = clamp(Number(velEl.value)||1, 0.1, 1.5); });
  // store stepsEl for programmatic updates
  this._stepsEl = stepsEl;

  // Duplicate button
  const dupBtn = document.createElement('button');
  dupBtn.className = 'btn';
  dupBtn.textContent = 'Duplicate';
  dupBtn.title = 'Duplicate pattern to double length (up to 64)';
  head.querySelector('div')?.appendChild(dupBtn);
  dupBtn.addEventListener('click', () => this._duplicatePattern());

    // Grid
  const gridWrap = document.createElement('div'); gridWrap.className = 'control';
  // Make pattern area full width of module
  gridWrap.style.gridColumn = '1 / -1';
  gridWrap.innerHTML = `<label>Pattern (Shift-click = Accent)</label><div data-role="grid" style="overflow:auto; max-height: 220px; border:1px solid #26305a; border-radius:6px; padding:8px; background:#0a0f2a; width:100%"></div>`;
    container.appendChild(gridWrap);
    this._gridEl = gridWrap.querySelector('[data-role=grid]');
    this._renderGrid();

    // Slots controls
    const slots = document.createElement('div'); slots.className = 'control';
    // Make tracks area full width of module
    slots.style.gridColumn = '1 / -1';
  // Keep controls inside module width without horizontal scrolling
  slots.style.overflowX = 'hidden';
    slots.innerHTML = `<label>Tracks</label>`;
    const grid = document.createElement('div');
  // Flexible columns that always fit within parent width
  grid.style.cssText = 'display:grid; width:100%; grid-template-columns: repeat(5, minmax(0, 1fr)); gap:8px; align-items:center;';
    slots.appendChild(grid);
    container.appendChild(slots);

    this._slotRows = [];
    this._slots.forEach((s, idx) => {
      const row = document.createElement('div'); row.style.cssText = 'display:contents';
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <strong>${s.label}</strong>
          <button class="btn" data-role="load">Load</button>
          <input class="hidden" type="file" accept="audio/*">
        </div>
        <div><small>Vol</small><input data-role="vol" type="range" min="0" max="1.5" step="0.01" value="${s.vol}"></div>
        <div><small>Pan</small><input data-role="pan" type="range" min="-1" max="1" step="0.01" value="${s.panVal}"></div>
        <div><small>Pitch (st)</small><input data-role="pitch" type="range" min="-24" max="24" step="1" value="${s.pitch||0}"></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:6px;"><input data-role="mute" type="checkbox"> <small>Mute</small></label>
          <button class="btn" data-role="trig">Trig</button>
          <span class="hint" style="opacity:.7;">Drop file here</span>
        </div>`;
      grid.appendChild(row);
      this._slotRows[idx] = row;
      const loadBtn = row.querySelector('[data-role=load]');
      const fileInput = row.querySelector('input[type=file]');
      const vol = row.querySelector('[data-role=vol]');
  const pan = row.querySelector('[data-role=pan]');
  const pitch = row.querySelector('[data-role=pitch]');
  const trig = row.querySelector('[data-role=trig]');
  const mute = row.querySelector('[data-role=mute]');
      loadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const f = fileInput.files?.[0]; if (!f) return;
        const arr = await f.arrayBuffer();
        this.audioCtx.decodeAudioData(arr.slice(0)).then(buf => { s.buffer = buf; }).catch(()=>{});
        fileInput.value = '';
      });
      row.addEventListener('dragover', (e) => e.preventDefault());
      row.addEventListener('drop', async (e) => {
        e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (!f) return; if (!f.type.startsWith('audio/')) return;
        const arr = await f.arrayBuffer();
        this.audioCtx.decodeAudioData(arr.slice(0)).then(buf => { s.buffer = buf; }).catch(()=>{});
      });
      vol.addEventListener('input', () => { s.vol = Number(vol.value); const target = s.muted ? 0 : s.vol; s.gain.gain.setTargetAtTime(target, this.audioCtx.currentTime, 0.01); });
      pan.addEventListener('input', () => { s.panVal = Number(pan.value); if (s.pan) s.pan.pan.setTargetAtTime(s.panVal, this.audioCtx.currentTime, 0.01); });
  pitch.addEventListener('input', () => { s.pitch = Number(pitch.value); });
      trig.addEventListener('click', () => this._trigger(idx, 1));
      if (mute) {
        mute.checked = !!s.muted;
        mute.addEventListener('input', () => {
          s.muted = !!mute.checked;
          const target = s.muted ? 0 : Math.max(0, s.vol);
          s.gain.gain.setTargetAtTime(target, this.audioCtx.currentTime, 0.01);
        });
      }
    });
  }

  _duplicatePattern() {
    const cur = this._steps|0;
    if (cur <= 0) return;
    if (cur >= 64) return; // already at max
    const target = Math.min(64, cur * 2);
    const copyLen = Math.min(cur, target - cur);
    for (let r = 0; r < this._pattern.length; r++) {
      const row = this._pattern[r].slice(0, cur);
      const rowAcc = this._accent[r].slice(0, cur);
      const extra = row.slice(0, copyLen);
      const extraAcc = rowAcc.slice(0, copyLen);
      const next = row.concat(extra);
      const nextAcc = rowAcc.concat(extraAcc);
      next.length = target; nextAcc.length = target;
      this._pattern[r] = next;
      this._accent[r] = nextAcc;
    }
    this._steps = target;
    if (this._stepsEl) this._stepsEl.value = String(this._steps);
    this._renderGrid();
  }

  _renderGrid() {
    if (!this._gridEl) return;
    const steps = this._steps;
    this._gridEl.innerHTML = '';
    const table = document.createElement('div');
    table.style.cssText = `display:grid; grid-template-columns: 80px repeat(${steps}, 28px); gap:6px; align-items:center;`;
    for (let r = 0; r < this._lanes.length; r++) {
      const name = document.createElement('div'); name.textContent = this._lanes[r]; name.style.color = '#9ab'; table.appendChild(name);
      for (let c = 0; c < steps; c++) {
        const cell = document.createElement('button');
        cell.className = 'btn step';
        const on = !!this._pattern[r][c];
        const acc = !!this._accent[r][c];
        cell.textContent = acc ? '●' : (on ? '•' : '·');
        cell.style.opacity = on ? (acc ? '1' : '0.85') : '0.4';
        cell.addEventListener('click', (e) => {
          if (e.shiftKey) {
            if (this._pattern[r][c]) this._accent[r][c] = !this._accent[r][c];
          } else {
            this._pattern[r][c] = !this._pattern[r][c];
            if (!this._pattern[r][c]) this._accent[r][c] = false;
          }
          this._renderGrid();
        });
        table.appendChild(cell);
      }
    }
    this._gridEl.appendChild(table);
  }

  onParamConnected(portName, fromModuleId, fromPortName) {
    const src = this.getModuleById?.(fromModuleId);
    if (portName === 'clock' && fromPortName === 'clock' && src?.subscribeClock) {
      // Receive precise timing info from Transport
      src.subscribeClock(this.id, (evt) => this._onTick(evt));
      this._transport = src;
    }
  }
  onParamDisconnected(portName, fromModuleId, fromPortName) {
    const src = this.getModuleById?.(fromModuleId);
    if (portName === 'clock' && fromPortName === 'clock' && src?.unsubscribeClock) { src.unsubscribeClock(this.id); if (this._transport===src) this._transport=null; }
  }

  _onTick(evt) {
  if (evt && evt.reset) { this._pos = 0; return; }
  const t = evt?.time ?? this.audioCtx.currentTime;
    const step = this._pos % this._steps;
    for (let r = 0; r < this._lanes.length; r++) {
      if (this._pattern[r][step]) {
        const vel = (this._accent[r][step] ? 1.0 : 0.8) * this._velocity;
        this._trigger(r, vel, t);
      }
    }
    this._pos = (this._pos + 1) % Math.max(1, this._steps);
  }

  _trigger(lane, velocity = 1, time) {
    const i = Math.max(0, Math.min(this._slots.length - 1, lane));
    const s = this._slots[i];
  if (s.muted) return;
    const ctx = this.audioCtx;
    const src = ctx.createBufferSource();
    src.buffer = s.buffer || s.fallback;
  // Apply per-lane pitch in semitones
  const pitchSemi = Number.isFinite(s.pitch) ? s.pitch : 0;
  const rate = Math.pow(2, pitchSemi / 12);
  src.playbackRate.value = Math.max(0.01, rate);
    const vGain = ctx.createGain();
    const amp = Math.max(0, s.vol) * Math.max(0, velocity);
    // Set gain at event time for tighter sync
    if (typeof time === 'number') {
      vGain.gain.setValueAtTime(amp, time);
    } else {
      vGain.gain.value = amp;
    }
    src.connect(vGain).connect(s.gain);
    try { typeof time === 'number' ? src.start(time) : src.start(); } catch {}
  }

  _stopAll() {
    const now = this.audioCtx.currentTime;
    const g = this._out.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(0.0001, now, 0.02);
    setTimeout(() => g.setTargetAtTime(0.9, this.audioCtx.currentTime, 0.02), 120);
  }

  toJSON() {
    return {
      steps: this._steps,
      velocity: this._velocity,
      lanes: this._lanes,
      pattern: this._pattern,
      accent: this._accent,
      master: this._out.gain.value,
  slots: this._slots.map(s => ({ vol: s.vol, pan: s.panVal, pitch: s.pitch||0, mute: !!s.muted, hasSample: !!s.buffer })),
    };
  }
  fromJSON(state) {
    if (!state) return;
    if (typeof state.steps==='number') this._steps = clamp(state.steps,1,64);
    if (typeof state.velocity==='number') this._velocity = clamp(state.velocity,0.1,1.5);
    if (Array.isArray(state.pattern)) this._pattern = state.pattern.map(r => r.slice(0, this._steps));
    if (Array.isArray(state.accent)) this._accent = state.accent.map(r => r.slice(0, this._steps));
    if (typeof state.master==='number') this._out.gain.value = state.master;
    if (Array.isArray(state.slots)) {
      state.slots.forEach((ss, i) => {
        const s = this._slots[i]; if (!s) return;
        if (typeof ss.vol==='number') { s.vol = ss.vol; }
        if (typeof ss.pan==='number' && s.pan) { s.panVal = ss.pan; s.pan.pan.value = ss.pan; }
        if (typeof ss.pitch==='number') { s.pitch = ss.pitch; }
        if (typeof ss.mute==='boolean') { s.muted = ss.mute; }
        s.gain.gain.value = s.muted ? 0 : Math.max(0, s.vol);
        // Sync UI sliders if available
        const row = this._slotRows?.[i];
        if (row) {
          const volEl = row.querySelector('[data-role=vol]');
          const panEl = row.querySelector('[data-role=pan]');
          const pitchEl = row.querySelector('[data-role=pitch]');
          if (volEl) volEl.value = String(s.vol);
          if (panEl) panEl.value = String(s.panVal);
          if (pitchEl) pitchEl.value = String(s.pitch||0);
          const muteEl = row.querySelector('[data-role=mute]'); if (muteEl) muteEl.checked = !!s.muted;
        }
      });
    }
    this._renderGrid();
  }

  dispose() {
    try { this._out?.disconnect(); this._slots?.forEach(s => { try { s.gain?.disconnect(); s.pan?.disconnect(); } catch{} }); } catch{}
    super.dispose?.();
  }
}
