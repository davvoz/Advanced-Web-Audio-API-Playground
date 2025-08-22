import { Module } from './module.js';

export class LFOModule extends Module {
    get title() { return 'LFO'; }

    buildAudio() {
        const ctx = this.audioCtx;
        this.osc = ctx.createOscillator();
        this.osc.type = 'sine';
        this.osc.frequency.value = 2; // Hz
        this.scale = ctx.createGain();
        this.scale.gain.value = 50; // default modulation depth
        this.offset = ctx.createConstantSource();
        this.offset.offset.value = 0; // DC offset
        // LFO output = osc*scale + offset
        this.osc.connect(this.scale);
        this.scale.connect(this.offset.offset);
        this.offset.start();
        try { this.osc.start(); } catch { }
        this.outputs = { out: { node: this.offset } }; // using ConstantSource as output node
        this.inputs = {
            rate: { param: this.osc.frequency },
            depth: { param: this.scale.gain },
            offset: { param: this.offset.offset },
        };
    }

    buildControls(container) {
        // Waveform selector
        const waveCtl = document.createElement('div');
        waveCtl.className = 'control';
        waveCtl.innerHTML = `
      <label>Waveform</label>
      <select>
        <option value="sine">Sine</option>
        <option value="triangle">Triangle</option>
        <option value="sawtooth">Sawtooth</option>
        <option value="square">Square</option>
      </select>
    `;
        const waveSel = waveCtl.querySelector('select');
        waveSel.value = this.osc.type || 'sine';
    waveSel.addEventListener('change', () => {
      this.osc.type = waveSel.value;
    });
        this._typeEl = waveSel;

        const rateCtl = document.createElement('div');
        rateCtl.className = 'control';
        rateCtl.innerHTML = `
      <label>Rate (Hz)</label>
      <input type="range" min="0.1" max="20" step="0.1" value="2" />
    `;
        const rate = rateCtl.querySelector('input');
        rate.addEventListener('input', () => this.osc.frequency.setTargetAtTime(Number(rate.value), this.audioCtx.currentTime, 0.01));

        const depthCtl = document.createElement('div');
        depthCtl.className = 'control';
        depthCtl.innerHTML = `
      <label>Depth</label>
      <input type="range" min="0" max="2000" step="1" value="50" />
    `;
        const depth = depthCtl.querySelector('input');
        depth.addEventListener('input', () => this.scale.gain.setTargetAtTime(Number(depth.value), this.audioCtx.currentTime, 0.01));

        const offsetCtl = document.createElement('div');
        offsetCtl.className = 'control';
        offsetCtl.innerHTML = `
      <label>Offset</label>
      <input type="range" min="-1000" max="1000" step="1" value="0" />
    `;
        const offs = offsetCtl.querySelector('input');
        offs.addEventListener('input', () => this.offset.offset.setTargetAtTime(Number(offs.value), this.audioCtx.currentTime, 0.01));

        container.appendChild(waveCtl);
        container.appendChild(rateCtl);
        container.appendChild(depthCtl);
        container.appendChild(offsetCtl);
    }

    toJSON() {
        return { type: this.osc.type, rate: this.osc.frequency.value, depth: this.scale.gain.value, offset: this.offset.offset.value };
    }
    fromJSON(state) {
        if (!state) return;
        if (typeof state.type === 'string') {
            this.osc.type = state.type;
            if (this._typeEl) this._typeEl.value = state.type;
        }
        if (typeof state.rate === 'number') this.osc.frequency.value = state.rate;
        if (typeof state.depth === 'number') this.scale.gain.value = state.depth;
        if (typeof state.offset === 'number') this.offset.offset.value = state.offset;
    }
}
