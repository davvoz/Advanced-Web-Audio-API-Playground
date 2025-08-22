import { Module } from './module.js';

export class ADSRModule extends Module {
    get title() { return 'ADSR'; }

    buildAudio() {
        const ctx = this.audioCtx;
        // Use ConstantSource as envelope carrier
        this.env = ctx.createConstantSource();
        this.env.offset.value = 0;
        this.env.start();
        // Scaled output for large-range params (e.g., filter cutoff)
        this.amountGain = ctx.createGain();
        this.amountGain.gain.value = 1;
        this.env.connect(this.amountGain);
        this.outputs = { out: { node: this.env }, amt: { node: this.amountGain } };
        // Optional: allow gate input to trigger envelope when value > 0.5
        // For simplicity, expose a gate parameter to be modulated by others
        this._inGate = ctx.createGain();
        this._inGate.gain.value = 0;
        this.inputs = {
            gate: { param: this._inGate.gain }, // dummy param; used only to allow connection and trigger subscription
        };
    }

    buildControls(container) {
        // Exponential mapping helpers for time sliders to provide finer control near 0
        // x in [0,1] -> time in [min,max] using an exponential curve with gamma bias
        this._timeMin = { A: 0.001, D: 0.001, R: 0.001 };
        this._timeMax = { A: 5, D: 5, R: 5 };
        this._timeGamma = { A: 3.0, D: 2.0, R: 2.0 }; // stronger bias for Attack
        const map01ToRangeExp = (x, min, max, gamma) => {
            const xx = Math.max(0, Math.min(1, x)) ** gamma;
            return min * Math.pow(max / min, xx);
        };
        const mapRangeTo01Exp = (v, min, max, gamma) => {
            const clamped = Math.max(min, Math.min(max, v));
            const r = Math.log(clamped / min) / Math.log(max / min);
            return Math.pow(Math.max(0, Math.min(1, r)), 1 / gamma);
        };

        const mk = (label, min, max, step, val) => {
            const c = document.createElement('div');
            c.className = 'control';
            c.innerHTML = `
        <label>${label}</label>
        <input type="range" min="${min}" max="${max}" step="${step}" value="${val}" />
      `;
            return c;
        };
        // Attack uses normalized 0..1 slider mapped exponentially to [min,max]
        const aCtl = mk('Attack (s): <span class="readout">0.00</span>', 0, 1, 0.001, 0);
        const dCtl = mk('Decay (s)', 0.001, 5, 0.001, 0.1);
        const sCtl = mk('Sustain (0-1)', 0, 1, 0.01, 0.7);
        const rCtl = mk('Release (s)', 0.001, 5, 0.001, 0.2);
        // Store slider refs
        this._aEl = aCtl.querySelector('input');
        this._dEl = dCtl.querySelector('input');
        this._sEl = sCtl.querySelector('input');
        this._rEl = rCtl.querySelector('input');
        this._aReadout = aCtl.querySelector('.readout');
        // Initialize Attack slider to default 0.02s (or preset), mapped to 0..1
        const initASec = (this._defaults && typeof this._defaults.A === 'number') ? this._defaults.A : 0.02;
        const initA01 = mapRangeTo01Exp(initASec, this._timeMin.A, this._timeMax.A, this._timeGamma.A);
        this._aEl.value = String(initA01);
        if (this._aReadout) this._aReadout.textContent = initASec.toFixed(3);

        // Apply other defaults from preset if present
        if (this._defaults) {
            if (typeof this._defaults.D === 'number') this._dEl.value = String(this._defaults.D);
            if (typeof this._defaults.S === 'number') this._sEl.value = String(this._defaults.S);
            if (typeof this._defaults.R === 'number') this._rEl.value = String(this._defaults.R);
        }
        // Keep Attack readout in sync
        const updateAReadout = () => {
            const aSec = map01ToRangeExp(Number(this._aEl.value), this._timeMin.A, this._timeMax.A, this._timeGamma.A);
            if (this._aReadout) this._aReadout.textContent = aSec.toFixed(3);
        };
        this._aEl.addEventListener('input', updateAReadout);
        updateAReadout();
        const depthCtl = document.createElement('div');
        depthCtl.className = 'control';
        depthCtl.innerHTML = `
      <label>Depth (scaled out)</label>
      <input type="range" min="0" max="5000" step="1" value="1" />
    `;
        this._depthEl = depthCtl.querySelector('input');
        this._depthEl.addEventListener('input', () => {
            this.amountGain.gain.setValueAtTime(Number(this._depthEl.value), this.audioCtx.currentTime);
        });

        container.appendChild(depthCtl);
        container.appendChild(aCtl);
        container.appendChild(dCtl);
        container.appendChild(sCtl);
        container.appendChild(rCtl);
    }

    toJSON() {
        return {
            // Save Attack in seconds, converting from normalized slider
            A: (() => {
                if (!this._aEl) return Number(this._defaults?.A ?? 0.02);
                const x = Math.max(0, Math.min(1, Number(this._aEl.value)));
                const xx = x ** this._timeGamma.A;
                return this._timeMin.A * Math.pow(this._timeMax.A / this._timeMin.A, xx);
            })(),
            D: Number(this._dEl?.value ?? this._defaults?.D ?? 0.1),
            S: Number(this._sEl?.value ?? this._defaults?.S ?? 0.7),
            R: Number(this._rEl?.value ?? this._defaults?.R ?? 0.2),
            depth: Number(this._depthEl?.value ?? this.amountGain?.gain?.value ?? 1),
        };
    }
    fromJSON(state) {
        if (!state) return;
        // store and apply if sliders exist already
        this._defaults = { ...state };
        if (this._aEl && typeof state.A === 'number') {
            // Convert seconds to normalized slider
            const a01 = (v => {
                const clamped = Math.max(this._timeMin.A, Math.min(this._timeMax.A, v));
                const r = Math.log(clamped / this._timeMin.A) / Math.log(this._timeMax.A / this._timeMin.A);
                return Math.pow(Math.max(0, Math.min(1, r)), 1 / this._timeGamma.A);
            })(state.A);
            this._aEl.value = String(a01);
            if (this._aReadout) this._aReadout.textContent = Number(state.A).toFixed(3);
        }
        if (this._dEl) this._dEl.value = String(state.D ?? this._dEl.value);
        if (this._sEl) this._sEl.value = String(state.S ?? this._sEl.value);
        if (this._rEl) this._rEl.value = String(state.R ?? this._rEl.value);
        if (this._depthEl && typeof state.depth === 'number') {
            this._depthEl.value = String(state.depth);
            this.amountGain.gain.value = state.depth;
        }
    }
    onParamConnected(portName, fromModuleId, fromPortName) {
        if (portName === 'gate' && fromPortName === 'gate') {
            const src = this.getModuleById?.(fromModuleId);
            if (src?.subscribeGate) {
                this._gateUnsubId = this.id;
                src.subscribeGate(this._gateUnsubId, (state) => {
                    if (state === 'on') this._gateOn(); else if (state === 'off') this._gateOff();
                });
            }
        }
    }
    onParamDisconnected(portName, fromModuleId, fromPortName) {
        if (portName === 'gate' && fromPortName === 'gate') {
            const src = this.getModuleById?.(fromModuleId);
            if (src?.unsubscribeGate && this._gateUnsubId) src.unsubscribeGate(this._gateUnsubId);
            this._gateUnsubId = null;
        }
    }

    _gateOn() {
        const now = this.audioCtx.currentTime;
        // Map normalized Attack slider to seconds for finer control near 0
        const A = (() => {
            if (!this._aEl) return Number(this._defaults?.A ?? 0.02);
            const x = Number(this._aEl.value);
            const xx = Math.max(0, Math.min(1, x)) ** this._timeGamma.A;
            return this._timeMin.A * Math.pow(this._timeMax.A / this._timeMin.A, xx);
        })();
        const D = Number(this._dEl?.value ?? this._defaults?.D ?? 0.1);
        const S = Number(this._sEl?.value ?? this._defaults?.S ?? 0.7);
        const p = this.env.offset;
        p.cancelScheduledValues(now);
        p.setValueAtTime(0, now);
        p.linearRampToValueAtTime(1, now + A);
        p.linearRampToValueAtTime(S, now + A + D);
    }
    _gateOff() {
        const now = this.audioCtx.currentTime;
        const R = Number(this._rEl?.value ?? this._defaults?.R ?? 0.2);
        const p = this.env.offset;
        p.cancelScheduledValues(now);
        p.setTargetAtTime(0, now, Math.max(0.001, R / 3));
    }

    dispose() {
        try { this.env?.disconnect(); this.amountGain?.disconnect(); this._inGate?.disconnect(); } catch { }
        super.dispose?.();
    }
}
