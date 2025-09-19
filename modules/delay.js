import { Module } from './module.js';

export class DelayModule extends Module {
    get title() { return 'Delay'; }

    buildAudio() {
        const ctx = this.audioCtx;
        // Core nodes
        this._in = ctx.createGain();
        this._out = ctx.createGain();
        this.delay = ctx.createDelay(5.0);
        this.delay.delayTime.value = 0.25;
        this.feedback = ctx.createGain(); this.feedback.gain.value = 0.3;
        this.dry = ctx.createGain(); this.dry.gain.value = 0.7;
        this.wet = ctx.createGain(); this.wet.gain.value = 0.3;

        // Routing: in -> dry -> out; in -> delay -> wet -> out; with feedback loop
        this._in.connect(this.dry).connect(this._out);
        this._in.connect(this.delay);
        this.delay.connect(this.feedback);
        this.feedback.connect(this.delay);
        this.delay.connect(this.wet).connect(this._out);

        // Ports
        this.inputs = {
            in: { node: this._in },
            time: { param: this.delay.delayTime },
            feedback: { param: this.feedback.gain },
            wet: { param: this.wet.gain },
            clock: { param: ctx.createGain().gain }, // for Transport clock connection
        };
        this.outputs = { out: { node: this._out } };

        // Sync state
        this._sync = true;
        this._division = '1/4';
        this._dotted = false;
        this._triplet = false;
        this._bpm = 120;
    }

    buildControls(container) {
        // Time (manual when sync off)
        const timeCtl = document.createElement('div');
        timeCtl.className = 'control';
        timeCtl.innerHTML = `
      <label>Time</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:center;">
        <label style="display:flex;align-items:center;gap:6px;"><input data-role="sync" type="checkbox" checked/> Sync</label>
        <select data-role="div">
          <option value="1/1">1/1</option>
          <option value="1/2">1/2</option>
          <option value="1/4" selected>1/4</option>
          <option value="1/8">1/8</option>
          <option value="1/16">1/16</option>
          <option value="1/32">1/32</option>
        </select>
        <label style="display:flex;align-items:center;gap:6px;"><input data-role="dot" type="checkbox"/> Dotted</label>
        <label style="display:flex;align-items:center;gap:6px;"><input data-role="trip" type="checkbox"/> Triplet</label>
        <div style="grid-column: span 2;">
          <small>Manual (s)</small>
          <input data-role="time" type="range" min="0" max="2" value="0.25" step="0.001" />
        </div>
      </div>
    `;
        const syncEl = timeCtl.querySelector('[data-role=sync]');
        const divEl = timeCtl.querySelector('[data-role=div]');
        const dotEl = timeCtl.querySelector('[data-role=dot]');
        const tripEl = timeCtl.querySelector('[data-role=trip]');
        const tEl = timeCtl.querySelector('[data-role=time]');
        const updateTime = () => {
            const now = this.audioCtx.currentTime;
            if (this._sync) {
                const sec = this._computeSyncedTime(this._bpm);
                this.delay.delayTime.setTargetAtTime(Math.min(5, sec), now, 0.01);
            } else {
                this.delay.delayTime.setTargetAtTime(Number(tEl.value), now, 0.01);
            }
            // reflect actual value in slider when syncing
            if (this._sync) tEl.value = this.delay.delayTime.value.toFixed(3);
            tEl.disabled = !!this._sync;
        };
        syncEl.addEventListener('change', () => { this._sync = !!syncEl.checked; updateTime(); });
        divEl.addEventListener('change', () => { this._division = divEl.value; updateTime(); });
        dotEl.addEventListener('change', () => { this._dotted = !!dotEl.checked; if (this._dotted) { this._triplet = false; tripEl.checked = false; } updateTime(); });
        tripEl.addEventListener('change', () => { this._triplet = !!tripEl.checked; if (this._triplet) { this._dotted = false; dotEl.checked = false; } updateTime(); });
        tEl.addEventListener('input', () => { if (!this._sync) this.delay.delayTime.setTargetAtTime(Number(tEl.value), this.audioCtx.currentTime, 0.01); });

        // Feedback
        const fbCtl = document.createElement('div');
        fbCtl.className = 'control';
        fbCtl.innerHTML = `
      <label>Feedback</label>
      <input data-role="fb" type="range" min="0" max="0.95" value="0.3" step="0.01" />
    `;
        const fb = fbCtl.querySelector('[data-role=fb]');
        fb.addEventListener('input', () => this.feedback.gain.setTargetAtTime(Number(fb.value), this.audioCtx.currentTime, 0.01));

        // Wet
        const wetCtl = document.createElement('div');
        wetCtl.className = 'control';
        wetCtl.innerHTML = `
      <label>Wet</label>
      <input data-role="wet" type="range" min="0" max="1" value="0.3" step="0.01" />
    `;
        const wet = wetCtl.querySelector('[data-role=wet]');
        wet.addEventListener('input', () => this.wet.gain.setTargetAtTime(Number(wet.value), this.audioCtx.currentTime, 0.01));

        container.appendChild(timeCtl);
        container.appendChild(fbCtl);
        container.appendChild(wetCtl);

        // initialize UI state
        updateTime();
    }

    onParamConnected(portName, fromModuleId, fromPortName) {
        const src = this.getModuleById?.(fromModuleId);
        if (portName === 'clock' && fromPortName === 'clock' && src?.subscribeClock) {
            src.subscribeClock(this.id, (evt) => {
                if (typeof evt?.bpm === 'number') this._bpm = evt.bpm;
                if (this._sync) {
                    const now = this.audioCtx.currentTime;
                    const sec = this._computeSyncedTime(this._bpm);
                    this.delay.delayTime.setTargetAtTime(Math.min(5, sec), now, 0.01);
                }
            });
            this._clockSrc = src;
        }
    }
    onParamDisconnected(portName, fromModuleId) {
        if (portName === 'clock' && this._clockSrc) {
            try { this._clockSrc.unsubscribeClock?.(this.id); } catch {}
            this._clockSrc = null;
        }
    }

    _computeSyncedTime(bpm) {
        const denom = Number(this._division?.split('/')[1] || 4);
        const beats = 4 / Math.max(1, denom); // whole note = 4 beats
        let sec = (60 / Math.max(1, bpm)) * beats;
        if (this._dotted) sec *= 1.5;
        if (this._triplet) sec *= 2 / 3;
        return sec;
    }

    toJSON() {
        return {
            time: this.delay.delayTime.value,
            feedback: this.feedback.gain.value,
            wet: this.wet.gain.value,
            sync: !!this._sync,
            division: this._division,
            dotted: !!this._dotted,
            triplet: !!this._triplet,
        };
    }
    fromJSON(state) {
        if (!state) return;
        const now = this.audioCtx.currentTime;
        if (typeof state.time === 'number') this.delay.delayTime.setValueAtTime(state.time, now);
        if (typeof state.feedback === 'number') this.feedback.gain.setValueAtTime(state.feedback, now);
        if (typeof state.wet === 'number') this.wet.gain.setValueAtTime(state.wet, now);
        if (typeof state.sync === 'boolean') this._sync = state.sync;
        if (typeof state.division === 'string') this._division = state.division;
        if (typeof state.dotted === 'boolean') this._dotted = state.dotted;
        if (typeof state.triplet === 'boolean') this._triplet = state.triplet;
        // Apply sync time with last known bpm
        if (this._sync) {
            const sec = this._computeSyncedTime(this._bpm);
            this.delay.delayTime.setTargetAtTime(Math.min(5, sec), now, 0.01);
        }
    }
}
