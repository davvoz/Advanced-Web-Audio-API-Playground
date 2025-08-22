import { Module } from './module.js';

export class DelayModule extends Module {
    get title() { return 'Delay'; }

    buildAudio() {
        const ctx = this.audioCtx;
        this.delay = ctx.createDelay(5.0);
        this.delay.delayTime.value = 0.25;
        this.feedback = ctx.createGain();
        this.feedback.gain.value = 0.3;
        // feedback loop
        this.delay.connect(this.feedback);
        this.feedback.connect(this.delay);

        // IO wrapper to allow dry/wet later if needed
        this.inputs = { in: { node: this.delay }, time: { param: this.delay.delayTime } };
        this.outputs = { out: { node: this.delay } };
    }

    buildControls(container) {
        const timeCtl = document.createElement('div');
        timeCtl.className = 'control';
        timeCtl.innerHTML = `
      <label>Time (s)</label>
      <input type="range" min="0" max="2" value="0.25" step="0.01" />
    `;
        const t = timeCtl.querySelector('input');
        t.addEventListener('input', () => this.delay.delayTime.setTargetAtTime(Number(t.value), this.audioCtx.currentTime, 0.01));

        const fbCtl = document.createElement('div');
        fbCtl.className = 'control';
        fbCtl.innerHTML = `
      <label>Feedback</label>
      <input type="range" min="0" max="0.95" value="0.3" step="0.01" />
    `;
        const fb = fbCtl.querySelector('input');
        fb.addEventListener('input', () => this.feedback.gain.setTargetAtTime(Number(fb.value), this.audioCtx.currentTime, 0.01));

        container.appendChild(timeCtl);
        container.appendChild(fbCtl);
    }

    toJSON() { return { time: this.delay.delayTime.value, feedback: this.feedback.gain.value }; }
    fromJSON(state) {
        if (!state) return;
        if (typeof state.time === 'number') this.delay.delayTime.value = state.time;
        if (typeof state.feedback === 'number') this.feedback.gain.value = state.feedback;
    }
}
