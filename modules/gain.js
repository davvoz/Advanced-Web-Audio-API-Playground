import { Module } from './module.js';

export class GainModule extends Module {
    get title() { return 'Gain'; }

    buildAudio() {
        const ctx = this.audioCtx;
        this.gainNode = ctx.createGain();
        this.gainNode.gain.value = 0.5;
        this.inputs = { in: { node: this.gainNode }, gain: { param: this.gainNode.gain } };
        this.outputs = { out: { node: this.gainNode } };
    }

    buildControls(container) {
        const levelCtl = document.createElement('div');
        levelCtl.className = 'control';
        levelCtl.innerHTML = `
      <label>Gain</label>
      <input type="range" min="0" max="2" value="0.5" step="0.01" />
    `;
        const r = levelCtl.querySelector('input');
        r.addEventListener('input', () => this.gainNode.gain.setTargetAtTime(Number(r.value), this.audioCtx.currentTime, 0.01));
        container.appendChild(levelCtl);
    }

    toJSON() { return { gain: this.gainNode.gain.value }; }
    fromJSON(state) { if (state && typeof state.gain === 'number') this.gainNode.gain.value = state.gain; }

    onParamConnected(portName) {
        if (portName === 'gain') {
            // store user level and set base to 0 to let external control act as absolute
            this._gainBase = this.gainNode.gain.value;
            this.gainNode.gain.setValueAtTime(0, this.audioCtx.currentTime);
        }
    }
    onParamDisconnected(portName) {
        if (portName === 'gain') {
            const v = typeof this._gainBase === 'number' ? this._gainBase : 0.5;
            this.gainNode.gain.setValueAtTime(v, this.audioCtx.currentTime);
        }
    }
}
