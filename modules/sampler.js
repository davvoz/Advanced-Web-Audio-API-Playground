import { Module } from './module.js';

export class SamplerModule extends Module {
  get title() { return 'Sampler'; }

  buildAudio() {
    const ctx = this.audioCtx;
  this._out = ctx.createGain();
  this._out.gain.value = 1;
  // VCA for envelope
  this._vca = ctx.createGain();
  this._vca.gain.value = 1;
  this._vca.connect(this._out);
  this.outputs = { out: { node: this._out } };
    // Param inputs
    this._inGate = ctx.createGain(); this._inGate.gain.value = 0; // dummy for connection
    this.inputs = {
      gate: { param: this._inGate.gain },
      gain: { param: this._out.gain },
      // pitch input (dummy param for connection detection)
      pitch: { param: (this._inPitch = ctx.createGain()).gain },
    };

    // Runtime state
    this.buffer = null;
    this._src = null;
    this._fileName = '';
    this._duration = 0;
  this._rate = 1; // base linear rate
  this._tune = 0; // semitones
  this._fine = 0; // cents
    this._loop = false;
    this._loopStart = 0;
    this._loopEnd = 0;
  this._mode = 'oneshot'; // 'oneshot' | 'gate'
  this._rootMidi = 60; // C4 by default
  this._pitchHz = null; // last external pitch in Hz
  // Envelope (ADSR)
  this._envEnable = true;
  this._A = 0.01; this._D = 0.08; this._S = 0.8; this._R = 0.2;
  this._startOffset = 0;
  // Waveform UI
  this._wave = { canvas: null, dragging: null };
  }

  buildControls(container) {
    this.root.classList.add('module-sampler');

    // File loader + drop zone
    const fileCtl = document.createElement('div');
    fileCtl.className = 'control';
    fileCtl.innerHTML = `
      <label>Sample</label>
      <div style="display:flex;gap:6px;align-items:center;">
        <input data-role="file" type="file" accept="audio/*" />
        <button data-role="trigger" class="btn" title="Play sample">Trig</button>
      </div>
      <div data-role="drop" style="margin-top:6px;padding:8px;border:1px dashed #2a3468;border-radius:6px;text-align:center;font-size:12px;color:#8a92b2;">
        Drop audio file here
      </div>
      <div data-role="meta" style="margin-top:6px;font-size:12px;color:#8a92b2;">No file</div>
    `;
    const fileIn = fileCtl.querySelector('[data-role=file]');
    const drop = fileCtl.querySelector('[data-role=drop]');
    const meta = fileCtl.querySelector('[data-role=meta]');
    const trigBtn = fileCtl.querySelector('[data-role=trigger]');
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files?.[0];
      if (f) await this._loadFile(f, meta);
    });
    ;['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.style.filter = 'brightness(1.1)'; }));
    ;['dragleave','drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.style.filter = ''; }));
    drop.addEventListener('drop', async (e) => {
      const f = e.dataTransfer?.files?.[0];
      if (f) await this._loadFile(f, meta);
    });
    trigBtn.addEventListener('click', () => this.trigger());

    // Playback controls
    const playCtl = document.createElement('div');
    playCtl.className = 'control';
  playCtl.innerHTML = `
      <label>Playback</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;align-items:center;">
        <div>
          <small>Rate</small>
          <input data-role="rate" type="range" min="0.25" max="4" step="0.01" value="1" />
        </div>
        <div>
          <small>Mode</small>
          <select data-role="mode">
            <option value="oneshot">One-shot</option>
            <option value="gate">Gate</option>
          </select>
        </div>
        <div>
          <label style="display:flex;align-items:center;gap:6px;margin:0"><input data-role="loop" type="checkbox"/> Loop</label>
        </div>
        <div>
          <small>Gain</small>
          <input data-role="gain" type="range" min="0" max="2" step="0.01" value="1" />
        </div>
        <div>
          <small>Tune (st)</small>
          <input data-role="tune" type="range" min="-24" max="24" step="1" value="0" />
        </div>
        <div>
          <small>Fine (ct)</small>
          <input data-role="fine" type="range" min="-100" max="100" step="1" value="0" />
        </div>
        <div>
          <small>Root MIDI</small>
          <input data-role="root" type="number" min="0" max="127" step="1" value="60" />
        </div>
        <div>
          <small>Start Offset (s)</small>
          <input data-role="start" type="number" min="0" step="0.01" value="0" />
        </div>
        <div>
          <small>Loop Start (s)</small>
          <input data-role="lstart" type="number" min="0" step="0.01" value="0" />
        </div>
        <div>
          <small>Loop End (s)</small>
          <input data-role="lend" type="number" min="0" step="0.01" value="0" />
        </div>
      </div>
    `;
    const rateEl = playCtl.querySelector('[data-role=rate]');
    const loopEl = playCtl.querySelector('[data-role=loop]');
    const gainEl = playCtl.querySelector('[data-role=gain]');
    const modeEl = playCtl.querySelector('[data-role=mode]');
  const tuneEl = playCtl.querySelector('[data-role=tune]');
    const fineEl = playCtl.querySelector('[data-role=fine]');
  const rootEl = playCtl.querySelector('[data-role=root]');
    const startEl = playCtl.querySelector('[data-role=start]');
    const lstartEl = playCtl.querySelector('[data-role=lstart]');
    const lendEl = playCtl.querySelector('[data-role=lend]');
    rateEl.addEventListener('input', () => this._rate = Number(rateEl.value));
    loopEl.addEventListener('change', () => this._loop = !!loopEl.checked);
    gainEl.addEventListener('input', () => this._out.gain.setTargetAtTime(Number(gainEl.value), this.audioCtx.currentTime, 0.01));
    modeEl.addEventListener('change', () => this._mode = modeEl.value);
    tuneEl.addEventListener('input', () => this._tune = Number(tuneEl.value));
    fineEl.addEventListener('input', () => this._fine = Number(fineEl.value));
  rootEl.addEventListener('input', () => this._rootMidi = Math.max(0, Math.min(127, Number(rootEl.value)||0)));
    startEl.addEventListener('input', () => this._startOffset = Math.max(0, Number(startEl.value)||0));
    lstartEl.addEventListener('input', () => this._loopStart = Math.max(0, Number(lstartEl.value)||0));
    lendEl.addEventListener('input', () => this._loopEnd = Math.max(0, Number(lendEl.value)||0));

    container.appendChild(fileCtl);
    container.appendChild(playCtl);

    // Envelope controls
    const envCtl = document.createElement('div');
    envCtl.className = 'control';
    envCtl.innerHTML = `
      <label>Envelope (ADSR)</label>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;align-items:center;">
        <div><small>A</small><input data-role="A" type="range" min="0" max="2" step="0.001" value="0.01"/></div>
        <div><small>D</small><input data-role="D" type="range" min="0" max="2" step="0.001" value="0.08"/></div>
        <div><small>S</small><input data-role="S" type="range" min="0" max="1" step="0.01" value="0.8"/></div>
        <div><small>R</small><input data-role="R" type="range" min="0" max="3" step="0.01" value="0.2"/></div>
      </div>
      <label style="display:flex;align-items:center;gap:6px;margin-top:6px"><input data-role="envOn" type="checkbox" checked/> Enable Envelope</label>
    `;
    const AEl = envCtl.querySelector('[data-role=A]');
    const DEl = envCtl.querySelector('[data-role=D]');
    const SEl = envCtl.querySelector('[data-role=S]');
    const REl = envCtl.querySelector('[data-role=R]');
    const envOnEl = envCtl.querySelector('[data-role=envOn]');
    AEl.addEventListener('input', () => this._A = Number(AEl.value));
    DEl.addEventListener('input', () => this._D = Number(DEl.value));
    SEl.addEventListener('input', () => this._S = Number(SEl.value));
    REl.addEventListener('input', () => this._R = Number(REl.value));
    envOnEl.addEventListener('change', () => this._envEnable = !!envOnEl.checked);
    container.appendChild(envCtl);

    // Waveform view
    const waveCtl = document.createElement('div');
    waveCtl.className = 'control';
    waveCtl.innerHTML = `
      <label>Waveform</label>
      <canvas data-role="wave" width="420" height="80" style="width:100%;height:80px;background:#0a0f2a;border:1px solid #26305a;border-radius:4px"></canvas>
    `;
    const canvas = waveCtl.querySelector('[data-role=wave]');
    this._wave.canvas = canvas;
    const pick = (x) => {
      if (!this.buffer) return null;
      const rect = canvas.getBoundingClientRect();
      const t = (x - rect.left) / rect.width * this.buffer.duration;
      return Math.max(0, Math.min(this.buffer.duration, t));
    };
    let drag = null; // 'start' | 'end'
    canvas.addEventListener('mousedown', (e) => {
      const t = pick(e.clientX);
      if (t == null) return;
      // choose closest handle
      const dStart = Math.abs(t - this._loopStart);
      const dEnd = Math.abs(t - this._loopEnd);
      drag = dStart <= dEnd ? 'start' : 'end';
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const t = pick(e.clientX); if (t == null) return;
      if (drag === 'start') {
        this._loopStart = Math.min(Math.max(0, t), this._loopEnd);
        if (this._ui?.lstartEl) this._ui.lstartEl.value = this._loopStart.toFixed(2);
      } else {
        this._loopEnd = Math.max(Math.min(this.buffer?.duration || 0, t), this._loopStart);
        if (this._ui?.lendEl) this._ui.lendEl.value = this._loopEnd.toFixed(2);
      }
      this._drawWave();
    });
    window.addEventListener('mouseup', () => { drag = null; });
    container.appendChild(waveCtl);

  this._ui = { meta, rateEl, loopEl, gainEl, modeEl, tuneEl, fineEl, rootEl, startEl, lstartEl, lendEl, AEl, DEl, SEl, REl, envOnEl, canvas };
    this._drawWave();
  }

  async _loadFile(file, metaEl) {
    try {
      const buf = await file.arrayBuffer();
      const audioBuf = await this.audioCtx.decodeAudioData(buf);
      this.buffer = audioBuf;
      this._fileName = file.name;
      this._duration = audioBuf.duration;
      this._loopStart = 0;
      this._loopEnd = Math.max(0.001, audioBuf.duration);
      if (metaEl) metaEl.textContent = `${file.name} — ${audioBuf.duration.toFixed(2)}s, ${audioBuf.numberOfChannels}ch`;
      if (this._ui?.lstartEl) this._ui.lstartEl.value = this._loopStart.toFixed(2);
      if (this._ui?.lendEl) this._ui.lendEl.value = this._loopEnd.toFixed(2);
  this._drawWave();
    } catch (e) {
      if (metaEl) metaEl.textContent = 'Failed to load file';
      console.error('Decode error', e);
    }
  }

  _makeSource() {
    if (!this.buffer) return null;
    const src = this.audioCtx.createBufferSource();
    src.buffer = this.buffer;
  // external pitch in Hz to semitone offset relative to root
  const pitchSemi = (hz) => 12 * (Math.log(hz / 440) / Math.log(2)) + 69;
  const rootHz = 440 * Math.pow(2, (this._rootMidi - 69) / 12);
  const extSemi = this._pitchHz ? 12 * (Math.log(this._pitchHz / rootHz) / Math.log(2)) : 0;
  const factor = Math.pow(2, ( (this._tune + extSemi) / 12)) * Math.pow(2, (this._fine / 1200));
    src.playbackRate.value = Math.max(0.01, this._rate * factor);
    src.loop = !!this._loop;
    src.loopStart = Math.min(this._loopStart, Math.max(0, this.buffer.duration - 0.001));
    src.loopEnd = Math.min(this._loopEnd || this.buffer.duration, this.buffer.duration);
    src.connect(this._vca);
    src.onended = () => { if (this._src === src) this._src = null; };
    return src;
  }

  trigger(offsetSec = 0) {
    if (!this.buffer) return;
    try { this.stop(); } catch {}
    const src = this._makeSource();
    if (!src) return;
    const baseOff = this._startOffset || 0;
    const off = Math.max(0, Math.min(this.buffer.duration - 0.001, baseOff + offsetSec));
    const now = this.audioCtx.currentTime;
    // Envelope attack/decay scheduling
    if (this._envEnable) {
      this._vca.gain.cancelScheduledValues(now);
      this._vca.gain.setValueAtTime(0, now);
      this._vca.gain.linearRampToValueAtTime(1, now + Math.max(0.001, this._A));
      const peakT = now + Math.max(0.001, this._A);
      this._vca.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, this._S)), peakT + Math.max(0, this._D));
    }
    src.start(now, off);
    this._src = src;
  }

  stop() {
    const now = this.audioCtx.currentTime;
    if (this._envEnable) {
      // release then stop
      const endT = now + Math.max(0, this._R);
      try {
        const cur = this._vca.gain.value;
        this._vca.gain.cancelScheduledValues(now);
        this._vca.gain.setValueAtTime(cur, now);
        this._vca.gain.linearRampToValueAtTime(0, endT);
      } catch {}
      const srcRef = this._src;
      if (srcRef) {
        try { srcRef.stop(endT + 0.01); } catch {}
      }
      this._src = null;
    } else {
      try { this._src?.stop?.(); } catch {}
      this._src = null;
    }
  }

  onParamConnected(portName, fromModuleId, fromPortName) {
    if (portName === 'gate') {
      const src = this.getModuleById?.(fromModuleId);
      if (src?.subscribeGate) {
        src.subscribeGate(this.id, (state) => {
          if (state === 'on') {
            this.trigger();
          } else if (state === 'off' && this._mode === 'gate') {
            this.stop();
          }
        });
        this._gateSrc = src;
      }
    }
    if (portName === 'pitch') {
      const src = this.getModuleById?.(fromModuleId);
      if (src?.subscribePitch) {
        src.subscribePitch(this.id, (hz, active) => {
          this._pitchHz = typeof hz === 'number' && hz > 0 ? hz : null;
        });
        this._pitchSrc = src;
      }
    }
  }
  onParamDisconnected(portName, fromModuleId, fromPortName) {
    if (portName === 'gate' && this._gateSrc) {
      try { this._gateSrc.unsubscribeGate?.(this.id); } catch {}
      this._gateSrc = null;
    }
    if (portName === 'pitch' && this._pitchSrc) {
      try { this._pitchSrc.unsubscribePitch?.(this.id); } catch {}
      this._pitchSrc = null;
      this._pitchHz = null;
    }
  }

  toJSON() {
    return {
      fileName: this._fileName,
      duration: this._duration,
      rate: this._rate,
      tune: this._tune,
      fine: this._fine,
  rootMidi: this._rootMidi,
      loop: this._loop,
      loopStart: this._loopStart,
      loopEnd: this._loopEnd,
      gain: this._out.gain.value,
      mode: this._mode,
      env: { A: this._A, D: this._D, S: this._S, R: this._R, on: this._envEnable },
      startOffset: this._startOffset,
    };
  }
  fromJSON(state) {
    if (!state) return;
    if (typeof state.rate === 'number') { this._rate = state.rate; this._ui?.rateEl && (this._ui.rateEl.value = String(state.rate)); }
    if (typeof state.tune === 'number') { this._tune = state.tune; this._ui?.tuneEl && (this._ui.tuneEl.value = String(state.tune)); }
    if (typeof state.fine === 'number') { this._fine = state.fine; this._ui?.fineEl && (this._ui.fineEl.value = String(state.fine)); }
    if (typeof state.loop === 'boolean') { this._loop = state.loop; this._ui?.loopEl && (this._ui.loopEl.checked = state.loop); }
    if (typeof state.mode === 'string') { this._mode = state.mode; this._ui?.modeEl && (this._ui.modeEl.value = state.mode); }
  if (typeof state.rootMidi === 'number') { this._rootMidi = Math.max(0, Math.min(127, state.rootMidi)); this._ui?.rootEl && (this._ui.rootEl.value = String(this._rootMidi)); }
    if (typeof state.loopStart === 'number') { this._loopStart = state.loopStart; this._ui?.lstartEl && (this._ui.lstartEl.value = String(state.loopStart)); }
    if (typeof state.loopEnd === 'number') { this._loopEnd = state.loopEnd; this._ui?.lendEl && (this._ui.lendEl.value = String(state.loopEnd)); }
    if (typeof state.gain === 'number') { this._out.gain.value = state.gain; this._ui?.gainEl && (this._ui.gainEl.value = String(state.gain)); }
    if (typeof state.startOffset === 'number') { this._startOffset = Math.max(0, state.startOffset); this._ui?.startEl && (this._ui.startEl.value = String(this._startOffset)); }
    if (state.env) {
      if (typeof state.env.A === 'number') { this._A = state.env.A; this._ui?.AEl && (this._ui.AEl.value = String(state.env.A)); }
      if (typeof state.env.D === 'number') { this._D = state.env.D; this._ui?.DEl && (this._ui.DEl.value = String(state.env.D)); }
      if (typeof state.env.S === 'number') { this._S = state.env.S; this._ui?.SEl && (this._ui.SEl.value = String(state.env.S)); }
      if (typeof state.env.R === 'number') { this._R = state.env.R; this._ui?.REl && (this._ui.REl.value = String(state.env.R)); }
      if (typeof state.env.on === 'boolean') { this._envEnable = state.env.on; this._ui?.envOnEl && (this._ui.envOnEl.checked = state.env.on); }
    }
    // Note: sample audio data is not embedded in presets; please reload the file.
    if (typeof state.fileName === 'string' && this._ui?.meta) {
      this._ui.meta.textContent = `${state.fileName} — ${state.duration?.toFixed ? state.duration.toFixed(2) : state.duration || ''}s (not loaded)`;
    }
    this._drawWave();
  }

  _drawWave() {
    const c = this._wave.canvas; if (!c) return;
    const g = c.getContext('2d');
    const w = c.width, h = c.height;
    g.clearRect(0,0,w,h);
    // background
    g.fillStyle = '#0a0f2a'; g.fillRect(0,0,w,h);
    g.strokeStyle = '#26305a'; g.strokeRect(0.5,0.5,w-1,h-1);
    if (!this.buffer) return;
    // draw waveform (mono mix)
    const ch0 = this.buffer.getChannelData(0);
    const step = Math.ceil(ch0.length / w);
    g.strokeStyle = '#7aa2ff'; g.beginPath();
    for (let x = 0; x < w; x++) {
      const i0 = x * step;
      let min = 1, max = -1;
      for (let i = 0; i < step; i++) {
        const s = ch0[i0 + i] || 0;
        if (s < min) min = s; if (s > max) max = s;
      }
      const y1 = (1 - (max * 0.5 + 0.5)) * h;
      const y2 = (1 - (min * 0.5 + 0.5)) * h;
      g.moveTo(x+0.5, y1); g.lineTo(x+0.5, y2);
    }
    g.stroke();
    // loop region
    const tToX = (t) => (t / (this.buffer.duration || 1)) * w;
    g.fillStyle = 'rgba(75,213,167,0.15)';
    const xs = tToX(this._loopStart), xe = tToX(this._loopEnd || this.buffer.duration);
    g.fillRect(Math.min(xs,xe), 0, Math.abs(xe - xs), h);
    // handles
    g.fillStyle = '#4bd5a7';
    g.fillRect(xs-1, 0, 2, h);
    g.fillRect(xe-1, 0, 2, h);
  }
}
