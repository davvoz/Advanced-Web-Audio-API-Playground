import { Module } from './module.js';

export class FMModule extends Module {
  get title() { return 'FM Synth'; }

  buildAudio() {
    const ctx = this.audioCtx;

    // Carrier and modulator
    this.carrier = ctx.createOscillator();
    this.carrier.type = 'sine';
    this.carrier.frequency.value = 220;

    this.mod = ctx.createOscillator();
    this.mod.type = 'sine';
    this.mod.frequency.value = 220; // default same as carrier

    // Index controls frequency deviation in Hz (audio-rate into AudioParam)
    this.modGain = ctx.createGain();
    this.modGain.gain.value = 0; // Hz deviation

    // Output gain
    this.outGain = ctx.createGain();
    this.outGain.gain.value = 0.5;

    // Wire: mod -> modGain -> carrier.frequency; carrier -> outGain
    this.mod.connect(this.modGain);
    this.modGain.connect(this.carrier.frequency);
    this.carrier.connect(this.outGain);

    // Expose ports
    this.inputs = {
      freq: { param: this.carrier.frequency },
      modFreq: { param: this.mod.frequency },
      index: { param: this.modGain.gain },
      amp: { param: this.outGain.gain },
    };
    this.outputs = { out: { node: this.outGain } };

    this.carrier.start();
    this.mod.start();
  }

  buildControls(container) {
    this.root.classList.add('module-fm');

    // Carrier controls
    const carCtl = document.createElement('div');
    carCtl.className = 'control';
    carCtl.innerHTML = `
      <label>Carrier</label>
      <div style="display:grid;grid-template-columns:repeat(3, minmax(0,1fr));gap:8px;align-items:center;">
        <div>
          <small>Wave</small>
          <select data-role="car-wave">
            <option value="sine" selected>Sine</option>
            <option value="triangle">Triangle</option>
            <option value="sawtooth">Saw</option>
            <option value="square">Square</option>
          </select>
        </div>
        <div>
          <small>Freq (Hz)</small>
          <input data-role="car-freq" type="number" min="10" max="20000" step="1" value="220" />
        </div>
        <div>
          <small>Level</small>
          <input data-role="level" type="range" min="0" max="1.5" step="0.01" value="0.5" />
        </div>
      </div>
    `;

    // Modulator controls
    const modCtl = document.createElement('div');
    modCtl.className = 'control';
    modCtl.innerHTML = `
      <label>Modulator</label>
      <div style="display:grid;grid-template-columns:repeat(3, minmax(0,1fr));gap:8px;align-items:center;">
        <div>
          <small>Wave</small>
          <select data-role="mod-wave">
            <option value="sine" selected>Sine</option>
            <option value="triangle">Triangle</option>
            <option value="sawtooth">Saw</option>
            <option value="square">Square</option>
          </select>
        </div>
        <div>
          <small>Mod Freq (Hz)</small>
          <input data-role="mod-freq" type="number" min="0.1" max="20000" step="0.1" value="220" />
        </div>
        <div>
          <small>Index (Hz dev)</small>
          <input data-role="index" type="range" min="0" max="3000" step="1" value="0" />
        </div>
      </div>
    `;

    container.appendChild(carCtl);
    container.appendChild(modCtl);

    // Bind controls
    const carWave = carCtl.querySelector('[data-role=car-wave]');
    const carFreq = carCtl.querySelector('[data-role=car-freq]');
    const level = carCtl.querySelector('[data-role=level]');
    const modWave = modCtl.querySelector('[data-role=mod-wave]');
    const modFreq = modCtl.querySelector('[data-role=mod-freq]');
    const index = modCtl.querySelector('[data-role=index]');

    carWave.addEventListener('input', () => this.carrier.type = carWave.value);
    carFreq.addEventListener('input', () => this.carrier.frequency.setTargetAtTime(Number(carFreq.value), this.audioCtx.currentTime, 0.01));
    level.addEventListener('input', () => this.outGain.gain.setTargetAtTime(Number(level.value), this.audioCtx.currentTime, 0.01));
    modWave.addEventListener('input', () => this.mod.type = modWave.value);
    modFreq.addEventListener('input', () => this.mod.frequency.setTargetAtTime(Number(modFreq.value), this.audioCtx.currentTime, 0.01));
    index.addEventListener('input', () => this.modGain.gain.setTargetAtTime(Number(index.value), this.audioCtx.currentTime, 0.01));

    // Keep references for fromJSON
    this._carFreqEl = carFreq;
    this._levelEl = level;
    this._modFreqEl = modFreq;
    this._indexEl = index;
    this._carWaveEl = carWave;
    this._modWaveEl = modWave;
  }

  toJSON() {
    return {
      car: { type: this.carrier.type, freq: this.carrier.frequency.value },
      mod: { type: this.mod.type, freq: this.mod.frequency.value },
      index: this.modGain.gain.value,
      level: this.outGain.gain.value,
    };
  }
  fromJSON(state) {
    if (!state) return;
    if (state.car) {
      if (state.car.type) this.carrier.type = state.car.type;
      if (typeof state.car.freq === 'number') this.carrier.frequency.value = state.car.freq;
    }
    if (state.mod) {
      if (state.mod.type) this.mod.type = state.mod.type;
      if (typeof state.mod.freq === 'number') this.mod.frequency.value = state.mod.freq;
    }
    if (typeof state.index === 'number') this.modGain.gain.value = state.index;
    if (typeof state.level === 'number') this.outGain.gain.value = state.level;
    // sync UI
    if (this._carFreqEl) this._carFreqEl.value = String(this.carrier.frequency.value);
    if (this._modFreqEl) this._modFreqEl.value = String(this.mod.frequency.value);
    if (this._indexEl) this._indexEl.value = String(this.modGain.gain.value);
    if (this._levelEl) this._levelEl.value = String(this.outGain.gain.value);
    if (this._carWaveEl) this._carWaveEl.value = this.carrier.type;
    if (this._modWaveEl) this._modWaveEl.value = this.mod.type;
  }

  dispose() {
    try { this.carrier?.disconnect(); this.mod?.disconnect(); this.modGain?.disconnect(); this.outGain?.disconnect(); } catch {}
    super.dispose?.();
  }
}
