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
      return { label, buffer: null, gain: ch, pan, vol: 0.9, panVal: 0, fallback };
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

    // Grid
    const gridWrap = document.createElement('div'); gridWrap.className = 'control';
    gridWrap.innerHTML = `<label>Pattern (Shift-click = Accent)</label><div data-role="grid" style="overflow:auto; max-height: 220px; border:1px solid #26305a; border-radius:6px; padding:8px; background:#0a0f2a"></div>`;
    container.appendChild(gridWrap);
    this._gridEl = gridWrap.querySelector('[data-role=grid]');
    this._renderGrid();

    // Slots controls
    const slots = document.createElement('div'); slots.className = 'control';
    slots.innerHTML = `<label>Tracks</label>`;
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid; grid-template-columns: 1fr 110px 110px 1fr; gap:8px; align-items:center;';
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
        <div style="display:flex;gap:8px;">
          <button class="btn" data-role="trig">Trig</button>
          <span class="hint" style="opacity:.7;">Drop file here</span>
        </div>`;
      grid.appendChild(row);
      this._slotRows[idx] = row;
      const loadBtn = row.querySelector('[data-role=load]');
      const fileInput = row.querySelector('input[type=file]');
      const vol = row.querySelector('[data-role=vol]');
      const pan = row.querySelector('[data-role=pan]');
      const trig = row.querySelector('[data-role=trig]');
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
      vol.addEventListener('input', () => { s.vol = Number(vol.value); s.gain.gain.setTargetAtTime(s.vol, this.audioCtx.currentTime, 0.01); });
      pan.addEventListener('input', () => { s.panVal = Number(pan.value); if (s.pan) s.pan.pan.setTargetAtTime(s.panVal, this.audioCtx.currentTime, 0.01); });
      trig.addEventListener('click', () => this._trigger(idx, 1));
    });
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
    if (portName === 'clock' && fromPortName === 'clock' && src?.subscribeClock) { src.subscribeClock(this.id, () => this._onTick(src)); this._transport = src; }
  }
  onParamDisconnected(portName, fromModuleId, fromPortName) {
    const src = this.getModuleById?.(fromModuleId);
    if (portName === 'clock' && fromPortName === 'clock' && src?.unsubscribeClock) { src.unsubscribeClock(this.id); if (this._transport===src) this._transport=null; }
  }

  _onTick(transport) {
    const step = this._pos % this._steps;
    for (let r = 0; r < this._lanes.length; r++) {
      if (this._pattern[r][step]) {
        const vel = (this._accent[r][step] ? 1.0 : 0.8) * this._velocity;
        this._trigger(r, vel);
      }
    }
    this._pos = (this._pos + 1) % Math.max(1, this._steps);
  }

  _trigger(lane, velocity = 1) {
    const i = Math.max(0, Math.min(this._slots.length - 1, lane));
    const s = this._slots[i];
    const ctx = this.audioCtx;
    const src = ctx.createBufferSource();
    src.buffer = s.buffer || s.fallback;
    const vGain = ctx.createGain();
    vGain.gain.value = Math.max(0, s.vol) * Math.max(0, velocity);
    src.connect(vGain).connect(s.gain);
    try { src.start(); } catch {}
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
      slots: this._slots.map(s => ({ vol: s.vol, pan: s.panVal, hasSample: !!s.buffer })),
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
      state.slots.forEach((ss, i) => { const s = this._slots[i]; if (!s) return; if (typeof ss.vol==='number') { s.vol = ss.vol; s.gain.gain.value = ss.vol; } if (typeof ss.pan==='number' && s.pan) { s.panVal = ss.pan; s.pan.pan.value = ss.pan; } });
    }
    this._renderGrid();
  }

  dispose() {
    try { this._out?.disconnect(); this._slots?.forEach(s => { try { s.gain?.disconnect(); s.pan?.disconnect(); } catch{} }); } catch{}
    super.dispose?.();
  }
}
