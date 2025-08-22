import { Module } from './module.js';

export class FilterModule extends Module {
    get title() { return 'Filter'; }

    buildAudio() {
        const ctx = this.audioCtx;
        this.filter = ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 800;
        this.filter.Q.value = 1;
        this.inputs = { in: { node: this.filter }, cutoff: { param: this.filter.frequency }, q: { param: this.filter.Q } };
        this.outputs = { out: { node: this.filter } };
    }

    buildControls(container) {
        const typeCtl = document.createElement('div');
        typeCtl.className = 'control';
        typeCtl.innerHTML = `
      <label>Type</label>
      <select>
        <option value="lowpass" selected>Low-pass</option>
        <option value="highpass">High-pass</option>
        <option value="bandpass">Band-pass</option>
        <option value="notch">Notch</option>
        <option value="lowshelf">Low-shelf</option>
        <option value="highshelf">High-shelf</option>
        <option value="peaking">Peaking</option>
        <option value="allpass">All-pass</option>
      </select>
    `;
        const sel = typeCtl.querySelector('select');
        sel.addEventListener('input', () => this.filter.type = sel.value);

        const cutoffCtl = document.createElement('div');
        cutoffCtl.className = 'control';
        cutoffCtl.innerHTML = `
      <label>Cutoff (Hz)</label>
      <input type="range" min="40" max="12000" value="800" step="1" />
      <input type="number" min="40" max="20000" value="800" step="1" />
    `;
        const cutRange = cutoffCtl.querySelector('input[type=range]');
        const cutNum = cutoffCtl.querySelector('input[type=number]');
        const syncCut = (v) => { this.filter.frequency.setTargetAtTime(Number(v), this.audioCtx.currentTime, 0.01); cutRange.value = v; cutNum.value = v; };
        cutRange.addEventListener('input', () => syncCut(cutRange.value));
        cutNum.addEventListener('input', () => syncCut(cutNum.value));

        const qCtl = document.createElement('div');
        qCtl.className = 'control';
        qCtl.innerHTML = `
      <label>Resonance (Q)</label>
      <input type="range" min="0.001" max="30" value="1" step="0.001" />
    `;
        const qRange = qCtl.querySelector('input[type=range]');
        qRange.addEventListener('input', () => this.filter.Q.setTargetAtTime(Number(qRange.value), this.audioCtx.currentTime, 0.01));

        container.appendChild(typeCtl);
        container.appendChild(cutoffCtl);
        container.appendChild(qCtl);
    }

    toJSON() {
        return { type: this.filter.type, cutoff: this.filter.frequency.value, q: this.filter.Q.value };
    }
    fromJSON(state) {
        if (!state) return;
        if (state.type) this.filter.type = state.type;
        if (typeof state.cutoff === 'number') this.filter.frequency.value = state.cutoff;
        if (typeof state.q === 'number') this.filter.Q.value = state.q;
    }
}
