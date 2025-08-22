import { Module } from './module.js';

export class DestinationModule extends Module {
    get title() { return 'Destination'; }

    buildAudio() {
        const ctx = this.audioCtx;
        this.inGain = ctx.createGain();
        this.inGain.gain.value = 0.9;
        this.inGain.connect(ctx.destination);
        this.inputs = { in: { node: this.inGain }, level: { param: this.inGain.gain } };
        this.outputs = {}; // none
    }

    buildControls(container) {
        const levelCtl = document.createElement('div');
        levelCtl.className = 'control';
        levelCtl.innerHTML = `
      <label>Master Volume</label>
      <input type="range" min="0" max="1" value="0.9" step="0.01" />
    `;
        const r = levelCtl.querySelector('input');
        r.addEventListener('input', () => this.inGain.gain.setTargetAtTime(Number(r.value), this.audioCtx.currentTime, 0.01));
        container.appendChild(levelCtl);
    }

    toJSON() { return { level: this.inGain.gain.value }; }
    fromJSON(state) { if (state && typeof state.level === 'number') this.inGain.gain.value = state.level; }
}
