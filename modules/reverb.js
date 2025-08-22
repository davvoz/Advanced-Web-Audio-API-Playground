import { Module } from './module.js';

export class ReverbModule extends Module {
  get title() { return 'Reverb'; }

  buildAudio() {
    const ctx = this.audioCtx;
    // IO and mix buses
    this.inputGain = ctx.createGain();
    this.preDelay = ctx.createDelay(1.0); // up to 1s
    this.convolver = ctx.createConvolver();
    this.wet = ctx.createGain(); this.wet.gain.value = 0.3;
    this.dry = ctx.createGain(); this.dry.gain.value = 0.7;
    this.out = ctx.createGain(); this.out.gain.value = 1;

    // Topology: in -> split(dry, verb)
    // in -> dry -> out
    // in -> preDelay -> convolver -> wet -> out
    this.inputGain.connect(this.dry);
    this.dry.connect(this.out);
    this.inputGain.connect(this.preDelay);
    this.preDelay.connect(this.convolver);
    this.convolver.connect(this.wet);
    this.wet.connect(this.out);

    // Default IR
    this._size = 2.5; // seconds
    this._decay = 2.0; // power decay factor
    this._reverse = false;
    this._buildIR();

    this.inputs = {
      in: { node: this.inputGain },
      dry: { param: this.dry.gain },
      wet: { param: this.wet.gain },
      predelay: { param: this.preDelay.delayTime },
    };
    this.outputs = { out: { node: this.out } };
  }

  _buildIR() {
    const ctx = this.audioCtx;
    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(rate * Math.max(0.05, Math.min(10, this._size))))
    const impulse = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const n = this._reverse ? (length - i - 1) : i;
        const t = n / length;
        // Exponential decay noise
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, this._decay);
      }
    }
    this.convolver.buffer = impulse;
  }

  buildControls(container) {
    // Size (s)
    const sizeCtl = document.createElement('div');
    sizeCtl.className = 'control';
    sizeCtl.innerHTML = `
      <label>Size (s)</label>
      <input type="range" min="0.1" max="10" step="0.1" value="2.5" />
    `;
    const sizeEl = sizeCtl.querySelector('input');
    sizeEl.addEventListener('input', () => {
      this._size = Number(sizeEl.value);
      this._buildIR();
    });

    // Decay
    const decayCtl = document.createElement('div');
    decayCtl.className = 'control';
    decayCtl.innerHTML = `
      <label>Decay</label>
      <input type="range" min="0.1" max="10" step="0.1" value="2.0" />
    `;
    const decayEl = decayCtl.querySelector('input');
    decayEl.addEventListener('input', () => {
      this._decay = Number(decayEl.value);
      this._buildIR();
    });

    // Pre-delay (ms)
    const pdCtl = document.createElement('div');
    pdCtl.className = 'control';
    pdCtl.innerHTML = `
      <label>Pre-delay (ms)</label>
      <input type="range" min="0" max="200" step="1" value="0" />
    `;
    const pdEl = pdCtl.querySelector('input');
    pdEl.addEventListener('input', () => {
      this.preDelay.delayTime.setTargetAtTime(Number(pdEl.value)/1000, this.audioCtx.currentTime, 0.01);
    });

    // Mix controls
    const wetCtl = document.createElement('div');
    wetCtl.className = 'control';
    wetCtl.innerHTML = `
      <label>Wet</label>
      <input type="range" min="0" max="1" step="0.01" value="0.3" />
    `;
    const wetEl = wetCtl.querySelector('input');
    wetEl.addEventListener('input', () => this.wet.gain.setTargetAtTime(Number(wetEl.value), this.audioCtx.currentTime, 0.01));

    const dryCtl = document.createElement('div');
    dryCtl.className = 'control';
    dryCtl.innerHTML = `
      <label>Dry</label>
      <input type="range" min="0" max="1" step="0.01" value="0.7" />
    `;
    const dryEl = dryCtl.querySelector('input');
    dryEl.addEventListener('input', () => this.dry.gain.setTargetAtTime(Number(dryEl.value), this.audioCtx.currentTime, 0.01));

    container.appendChild(sizeCtl);
    container.appendChild(decayCtl);
    container.appendChild(pdCtl);
    container.appendChild(wetCtl);
    container.appendChild(dryCtl);

    // Save refs for state
    this._ui = { sizeEl, decayEl, pdEl, wetEl, dryEl };
  }

  toJSON() {
    return {
      size: this._size,
      decay: this._decay,
      predelay: this.preDelay.delayTime.value,
      wet: this.wet.gain.value,
      dry: this.dry.gain.value,
    };
  }
  fromJSON(state) {
    if (!state) return;
    if (typeof state.size === 'number') { this._size = state.size; this._ui?.sizeEl && (this._ui.sizeEl.value = String(state.size)); }
    if (typeof state.decay === 'number') { this._decay = state.decay; this._ui?.decayEl && (this._ui.decayEl.value = String(state.decay)); }
    this._buildIR();
    if (typeof state.predelay === 'number') { this.preDelay.delayTime.value = state.predelay; this._ui?.pdEl && (this._ui.pdEl.value = String(Math.round(state.predelay*1000))); }
    if (typeof state.wet === 'number') { this.wet.gain.value = state.wet; this._ui?.wetEl && (this._ui.wetEl.value = String(state.wet)); }
    if (typeof state.dry === 'number') { this.dry.gain.value = state.dry; this._ui?.dryEl && (this._ui.dryEl.value = String(state.dry)); }
  }

  dispose() {
    try {
      this.inputGain?.disconnect();
      this.preDelay?.disconnect();
      this.convolver?.disconnect();
      this.wet?.disconnect();
      this.dry?.disconnect();
      this.out?.disconnect();
    } catch {}
    super.dispose?.();
  }
}
