import { Module } from './module.js';

export class OscillatorModule extends Module {
  get title() { return 'Oscillator'; }

  buildAudio() {
    const ctx = this.audioCtx;
    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.frequency.value = 110;
    this.out = ctx.createGain();
    this.out.gain.value = 0.3;
    this.osc.connect(this.out);
  // Start immediately (safe even if context is suspended; it will sound on resume)
  try { this.osc.start(); } catch {}
    this.outputs = { out: { node: this.out } };
    this.inputs = {
      freq: { param: this.osc.frequency },
    };
  }

  onAudioStateChange(state) {
    if (!this.osc) return;
    try {
      if (state === 'running' && this.osc && this.osc.context.state === 'running') {
        // ensure started
      }
    } catch {}
  }

  buildControls(container) {
    // Waveform
    const waveCtl = document.createElement('div');
    waveCtl.className = 'control';
    waveCtl.innerHTML = `
      <label>Waveform</label>
      <select>
        <option value="sine">Sine</option>
        <option value="square">Square</option>
        <option value="sawtooth" selected>Saw</option>
        <option value="triangle">Triangle</option>
      </select>
    `;
    const sel = waveCtl.querySelector('select');
  sel.addEventListener('input', () => this.osc.type = sel.value);

    // Frequency
    const freqCtl = document.createElement('div');
    freqCtl.className = 'control';
    freqCtl.innerHTML = `
      <label>Frequency (Hz)</label>
      <input type="range" min="40" max="2000" value="110" step="1" />
      <input type="number" min="40" max="2000" value="110" step="1" />
    `;
    const range = freqCtl.querySelector('input[type=range]');
    const num = freqCtl.querySelector('input[type=number]');
    const syncFreq = (v) => { this.osc.frequency.setTargetAtTime(Number(v), this.audioCtx.currentTime, 0.01); range.value = v; num.value = v; };
    range.addEventListener('input', () => syncFreq(range.value));
    num.addEventListener('input', () => syncFreq(num.value));

    // Level
    const levelCtl = document.createElement('div');
    levelCtl.className = 'control';
    levelCtl.innerHTML = `
      <label>Level</label>
      <input type="range" min="0" max="1" value="0.3" step="0.01" />
    `;
    const lvl = levelCtl.querySelector('input');
    lvl.addEventListener('input', () => this.out.gain.setTargetAtTime(Number(lvl.value), this.audioCtx.currentTime, 0.01));

  container.appendChild(waveCtl);
    container.appendChild(freqCtl);
    container.appendChild(levelCtl);
  }

  dispose() {
    super.dispose();
    try { this.osc?.disconnect(); this.out?.disconnect(); } catch {}
  }

  toJSON() {
    return { type: this.osc.type, freq: this.osc.frequency.value, level: this.out.gain.value };
  }
  fromJSON(state) {
    if (!state) return;
    if (state.type) this.osc.type = state.type;
    if (typeof state.freq === 'number') this.osc.frequency.value = state.freq;
    if (typeof state.level === 'number') this.out.gain.value = state.level;
    // sync UI if needed (skipped for brevity)
  }

  onParamConnected(portName) {
    if (portName === 'freq') {
      // when externally controlled, don't add DC offset; leave current value as is
      // nothing to change for absolute control
    }
  }
  onParamDisconnected(portName) {
    if (portName === 'freq') {
      // restore some safe default if needed
      if (!this._defaultFreq) this._defaultFreq = this.osc.frequency.value || 110;
      this.osc.frequency.setValueAtTime(this._defaultFreq, this.audioCtx.currentTime);
    }
  }
}
