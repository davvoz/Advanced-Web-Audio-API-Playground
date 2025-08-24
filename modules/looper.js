import { Module } from './module.js';

// Utility
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class LooperModule extends Module {
  get title() { return 'Looper'; }

  buildAudio() {
    const ctx = this.audioCtx;
    this._out = ctx.createGain();
    this._out.gain.value = 1;
    this._vca = ctx.createGain();
    this._vca.gain.value = 1;
    this._vca.connect(this._out);
    this.outputs = { out: { node: this._out } };

    // Inputs
    this._inGate = ctx.createGain(); this._inGate.gain.value = 0; // dummy
    this._inBpm = ctx.createGain(); this._inBpm.gain.value = 0; // dummy
    this._inClock = ctx.createGain(); this._inClock.gain.value = 0; // dummy
    this.inputs = {
      gate: { param: this._inGate.gain },
      bpm: { param: this._inBpm.gain },
      clock: { param: this._inClock.gain },
      gain: { param: this._out.gain },
    };

    // Runtime
    this.buffer = null;
    this._src = null;
    this._fileName = '';
    this._duration = 0;

    // Loop state
    this._loopStart = 0;
    this._loopEnd = 0; // 0 => buffer.duration
    this._bars = 1; // target musical length in bars (4/4)
    this._quant = '1/4'; // quantize grid for start
    this._warp = true; // warp to BPM
    this._mode = 'loop'; // loop | gate
    this._armed = false; // waiting to start on grid
    this._clockCount = 0; // 16th-counter from Transport
    this._transportRef = null;

    // Waveform drawing state
    this._wave = { canvas: null };
  }

  buildControls(container) {
    this.root.classList.add('module-looper');

    // File loader + drop zone
    const fileCtl = document.createElement('div');
    fileCtl.className = 'control';
    fileCtl.innerHTML = `
      <label>Loop Source</label>
      <div style="display:flex;gap:6px;align-items:center;">
        <input data-role="file" type="file" accept="audio/*" />
        <button data-role="trigger" class="btn" title="Start/Restart">Start</button>
        <button data-role="stop" class="btn" title="Stop">Stop</button>
      </div>
      <div data-role="drop" style="margin-top:6px;padding:8px;border:1px dashed #2a3468;border-radius:6px;text-align:center;font-size:12px;color:#8a92b2;">Drop audio file here</div>
      <div data-role="meta" style="margin-top:6px;font-size:12px;color:#8a92b2;">No file</div>
    `;
    const fileInput = fileCtl.querySelector('[data-role=file]');
    const drop = fileCtl.querySelector('[data-role=drop]');
    const meta = fileCtl.querySelector('[data-role=meta]');
    const trigBtn = fileCtl.querySelector('[data-role=trigger]');
    const stopBtn = fileCtl.querySelector('[data-role=stop]');
    fileInput.addEventListener('change', async () => { const f = fileInput.files?.[0]; if (f) await this._loadFile(f, meta); fileInput.value=''; });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); });
    drop.addEventListener('drop', async (e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) await this._loadFile(f, meta); });
    trigBtn.addEventListener('click', () => this.start(true));
    stopBtn.addEventListener('click', () => this.stop());

    // Musical sync
    const syncCtl = document.createElement('div');
    syncCtl.className = 'control';
    syncCtl.innerHTML = `
      <label>Sync</label>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;">
        <div><small>Bars</small><input data-role="bars" type="number" min="1" max="64" step="1" value="1" /></div>
        <div><small>Quantize</small>
          <select data-role="quant">
            <option>1/16</option>
            <option>1/8</option>
            <option selected>1/4</option>
            <option>1/2</option>
            <option>1 bar</option>
          </select>
        </div>
        <label style="display:flex;align-items:center;gap:6px;margin:0"><input data-role="warp" type="checkbox" checked/> Warp to BPM</label>
        <div>
          <small>Mode</small>
          <select data-role="mode">
            <option value="loop" selected>Loop</option>
            <option value="gate">Gate</option>
          </select>
        </div>
      </div>
    `;

    // Loop region
    const loopCtl = document.createElement('div');
    loopCtl.className = 'control';
    loopCtl.innerHTML = `
      <label>Loop Region</label>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;align-items:center;">
        <div><small>Start (s)</small><input data-role="lstart" type="number" min="0" step="0.01" value="0" /></div>
        <div><small>End (s)</small><input data-role="lend" type="number" min="0" step="0.01" value="0" /></div>
        <div><small>Gain</small><input data-role="gain" type="range" min="0" max="2" step="0.01" value="1" /></div>
      </div>
      <label>Waveform</label>
      <canvas data-role="wave" width="420" height="80" style="width:100%;height:80px;background:#0a0f2a;border:1px solid #26305a;border-radius:4px"></canvas>
    `;

    // Wire controls
    const barsEl = syncCtl.querySelector('[data-role=bars]');
    const quantEl = syncCtl.querySelector('[data-role=quant]');
    const warpEl = syncCtl.querySelector('[data-role=warp]');
    const modeEl = syncCtl.querySelector('[data-role=mode]');
    const lstartEl = loopCtl.querySelector('[data-role=lstart]');
    const lendEl = loopCtl.querySelector('[data-role=lend]');
    const gainEl = loopCtl.querySelector('[data-role=gain]');
    const canvas = loopCtl.querySelector('[data-role=wave]');
    this._wave.canvas = canvas;

    barsEl.addEventListener('input', () => { this._bars = clamp(Number(barsEl.value)||1, 1, 64); this._applyPlaybackRate(); });
    quantEl.addEventListener('change', () => this._quant = quantEl.value);
    warpEl.addEventListener('change', () => { this._warp = !!warpEl.checked; this._applyPlaybackRate(); });
    modeEl.addEventListener('change', () => this._mode = modeEl.value);
    lstartEl.addEventListener('input', () => { this._loopStart = Math.max(0, Number(lstartEl.value)||0); this._drawWave(); this._applyLoopRegion(); });
    lendEl.addEventListener('input',   () => { this._loopEnd = Math.max(0, Number(lendEl.value)||0); this._drawWave(); this._applyLoopRegion(); });
    gainEl.addEventListener('input', () => this._out.gain.setTargetAtTime(Number(gainEl.value), this.audioCtx.currentTime, 0.01));

    // Waveform interactions
    const pick = (x) => {
      if (!this.buffer) return null;
      const rect = canvas.getBoundingClientRect();
      const t = (x - rect.left) / rect.width * this.buffer.duration;
      return clamp(t, 0, this.buffer.duration);
    };
    let drag = null; // 'start' | 'end'
    canvas.addEventListener('mousedown', (e) => {
      const t = pick(e.clientX); if (t == null) return;
      const dStart = Math.abs(t - this._loopStart);
      const dEnd = Math.abs((this._loopEnd||this.buffer?.duration||0) - t);
      drag = dStart < dEnd ? 'start' : 'end';
      const onMove = (ev) => {
        const tt = pick(ev.clientX); if (tt == null) return;
        if (drag === 'start') { this._loopStart = tt; lstartEl.value = String(tt.toFixed(2)); }
        else { this._loopEnd = tt; lendEl.value = String(tt.toFixed(2)); }
        this._drawWave(); this._applyLoopRegion();
      };
      const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); drag = null; };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp, { once: true });
    });

    container.appendChild(fileCtl);
    container.appendChild(syncCtl);
    container.appendChild(loopCtl);

    this._ui = { meta, barsEl, quantEl, warpEl, modeEl, lstartEl, lendEl, gainEl, canvas };
    this._drawWave();
  }

  async _loadFile(file, metaEl) {
    this._fileName = file.name;
    const arr = await file.arrayBuffer();
    this.buffer = await this.audioCtx.decodeAudioData(arr);
    this._duration = this.buffer.duration;
    if (!this._loopEnd || this._loopEnd > this._duration) this._loopEnd = this._duration;
    this._drawWave();
    if (metaEl) metaEl.textContent = `${this._fileName} — ${this._duration.toFixed(2)}s`;
  }

  _applyLoopRegion() {
    if (!this._src || !this.buffer) return;
    const end = this._loopEnd > 0 ? this._loopEnd : this.buffer.duration;
    this._src.loop = true;
    this._src.loopStart = clamp(Math.min(this._loopStart, end - 0.001), 0, this.buffer.duration);
    this._src.loopEnd = clamp(Math.max(end, this._src.loopStart + 0.001), 0.001, this.buffer.duration);
  }

  _applyPlaybackRate() {
    if (!this._src || !this.buffer) return;
    if (!this._warp || !this._transportRef) { this._src.playbackRate.value = 1; return; }
    const bpm = this._transportRef.bpm || 120;
    const beats = this._bars * 4; // 4/4
    const desired = (60 / bpm) * beats; // seconds per loop at tempo
    const start = this._loopStart || 0;
    const end = (this._loopEnd && this._loopEnd > start) ? this._loopEnd : this.buffer.duration;
    const seg = Math.max(0.001, end - start);
    const rate = seg / desired; // rate >1 speeds up, <1 slows down
    this._src.playbackRate.setTargetAtTime(rate, this.audioCtx.currentTime, 0.02);
  }

  _makeSource() {
    if (!this.buffer) return null;
    const src = this.audioCtx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this._vca);
    src.loop = true;
    const end = this._loopEnd > 0 ? this._loopEnd : this.buffer.duration;
    src.loopStart = clamp(Math.min(this._loopStart, end - 0.001), 0, this.buffer.duration);
    src.loopEnd = clamp(Math.max(end, src.loopStart + 0.001), 0.001, this.buffer.duration);
    this._src = src;
    this._applyPlaybackRate();
    return src;
  }

  start(quantize = true) {
    if (!this.buffer) return;
    if (this._src) { try { this._src.stop(); } catch {} this._src.disconnect(); this._src = null; }
    if (quantize && this._transportRef) { this._armed = true; return; }
    const src = this._makeSource();
    if (!src) return;
    try { src.start(0, this._loopStart || 0); } catch {}
  }

  stop() {
    this._armed = false;
    if (!this._src) return;
    try { this._src.stop(); } catch {}
    this._src.disconnect();
    this._src = null;
  }

  // Quantize helper: steps per grid using Transport.ppqn (16th)
  _stepsPerGrid() {
    switch (this._quant) {
      case '1/16': return 1;
      case '1/8': return 2;
      case '1/4': return 4;
      case '1/2': return 8;
      case '1 bar': return 16;
      default: return 4;
    }
  }

  onParamConnected(portName, fromModuleId, fromPortName) {
    const src = this.getModuleById?.(fromModuleId);
    if (portName === 'clock' && fromPortName === 'clock' && src?.subscribeClock) {
      src.subscribeClock(this.id, () => {
        // update bpm ref and rate each tick
        this._transportRef = src;
        this._applyPlaybackRate();
        // Quantized start
        if (this._armed) {
          this._clockCount = (this._clockCount + 1) % 16384; // prevent overflow
          const div = this._stepsPerGrid();
          if (this._clockCount % div === 0) {
            this._armed = false;
            this.start(false);
          }
        }
      });
      this._transportRef = src;
    }
    if (portName === 'bpm') {
      // We can't read AudioParam directly; keep ref for bpm number
      if (typeof src?.bpm === 'number') this._transportRef = src;
    }
    if (portName === 'gate' && src?.subscribeGate) {
      src.subscribeGate(this.id, (state) => {
        if (state === 'on') this.start(true);
        else if (this._mode === 'gate') this.stop();
      });
    }
  }

  onParamDisconnected(portName, fromModuleId, fromPortName) {
    const src = this.getModuleById?.(fromModuleId);
    if (portName === 'clock' && fromPortName === 'clock' && src?.unsubscribeClock) src.unsubscribeClock(this.id);
    if (portName === 'gate' && src?.unsubscribeGate) src.unsubscribeGate(this.id);
  }

  _drawWave() {
    const c = this._wave.canvas; if (!c) return;
    const g = c.getContext('2d');
    g.clearRect(0,0,c.width,c.height);
    g.fillStyle = '#0d1330'; g.fillRect(0,0,c.width,c.height);
    if (!this.buffer) return;
    const ch = this.buffer.getChannelData(0);
    const step = Math.ceil(ch.length / c.width);
    const mid = c.height/2;
    g.strokeStyle = '#3a4a9a'; g.beginPath();
    for (let x=0; x<c.width; x++) {
      const i = x*step; let min=1e9, max=-1e9;
      for (let j=0; j<step && i+j<ch.length; j++) { const v = ch[i+j]; if (v<min) min=v; if (v>max) max=v; }
      g.moveTo(x, mid + min*mid); g.lineTo(x, mid + max*mid);
    }
    g.stroke();
    // Loop region overlay
    const dur = this.buffer.duration || 1;
    const s = (this._loopStart/dur) * c.width;
    const e = ((this._loopEnd>0?this._loopEnd:dur)/dur) * c.width;
    g.fillStyle = 'rgba(122,162,255,0.12)';
    g.fillRect(Math.min(s,e), 0, Math.max(2, Math.abs(e-s)), c.height);
    g.fillStyle = '#7aa2ff';
    g.fillRect(s-1, 0, 2, c.height);
    g.fillRect(e-1, 0, 2, c.height);
  }

  toJSON() {
    return {
      bars: this._bars,
      quant: this._quant,
      warp: this._warp,
      mode: this._mode,
      loopStart: this._loopStart,
      loopEnd: this._loopEnd,
      fileName: this._fileName,
    };
  }
  fromJSON(state) {
    if (!state) return;
    if (typeof state.bars === 'number') this._bars = clamp(state.bars, 1, 64);
    if (typeof state.quant === 'string') this._quant = state.quant;
    this._warp = !!state.warp;
    if (typeof state.mode === 'string') this._mode = state.mode;
    if (typeof state.loopStart === 'number') this._loopStart = Math.max(0, state.loopStart);
    if (typeof state.loopEnd === 'number') this._loopEnd = Math.max(0, state.loopEnd);
    if (this._ui) {
      this._ui.barsEl.value = String(this._bars);
      this._ui.quantEl.value = this._quant;
      this._ui.warpEl.checked = this._warp;
      this._ui.modeEl.value = this._mode;
      this._ui.lstartEl.value = String(this._loopStart);
      this._ui.lendEl.value = String(this._loopEnd);
    }
    this._drawWave();
    this._applyLoopRegion();
    this._applyPlaybackRate();
  }
}
