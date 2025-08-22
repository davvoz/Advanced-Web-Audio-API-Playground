import { Module } from './module.js';

export class DistortionModule extends Module {
    get title() { return 'Distortion'; }

    buildAudio() {
        const ctx = this.audioCtx;
        // Graph: in -> split(dry, preGain->shaper->tone->wet) -> out
        this.input = ctx.createGain();
        this.preGain = ctx.createGain(); this.preGain.gain.value = 7.0; // stronger default drive
        this.shaper = ctx.createWaveShaper(); this.shaper.oversample = '4x';
        this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 2500;
        this.wet = ctx.createGain(); this.wet.gain.value = 0.9;
        this.dry = ctx.createGain(); this.dry.gain.value = 0.1;
        this.out = ctx.createGain(); this.out.gain.value = 1.0;

        this.input.connect(this.dry);
        this.dry.connect(this.out);

        this.input.connect(this.preGain);
        this.preGain.connect(this.shaper);
        this.shaper.connect(this.tone);
        this.tone.connect(this.wet);
        this.wet.connect(this.out);

        // initial curve based on drive and type
        this._drive = 6.0;
        this._type = 'hard'; // 'soft' | 'hard' | 'classic' | 'fold' | 'asym'
        this._updateCurve();

        this.inputs = {
            in: { node: this.input },
            drive: { param: this.preGain.gain },
            tone: { param: this.tone.frequency },
            wet: { param: this.wet.gain },
            dry: { param: this.dry.gain },
            level: { param: this.out.gain },
        };
        this.outputs = { out: { node: this.out } };
    }

    _makeCurveSoft(k = 3.0, n = 2048) {
        // Symmetric soft clip (tanh)
        const curve = new Float32Array(n);
        const norm = Math.tanh(k);
        for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * 2 - 1;
            curve[i] = Math.tanh(k * x) / norm;
        }
        return curve;
    }
    _makeCurveHard(th = 0.3, n = 2048) {
        // Hard clip at +/- th with linear gain up to threshold
        const curve = new Float32Array(n);
        const gain = 1 / th;
        for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * 2 - 1;
            let y = x * gain;
            if (y > 1) y = 1; else if (y < -1) y = -1;
            curve[i] = y;
        }
        return curve;
    }
    _makeCurveClassic(amount = 50, n = 2048) {
        // Classic saturation curve with more upper harmonics
        const curve = new Float32Array(n);
        const a = Math.max(0, amount);
        for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * 2 - 1;
            curve[i] = ((3 + a) * x) / (3 + a * Math.abs(x));
        }
        return curve;
    }
    _makeCurveAsym(k = 4.0, bias = 0.2, n = 2048) {
        // Asymmetric soft clip: different slopes for + and -
        const curve = new Float32Array(n);
        const kp = k * (1 + bias);
        const kn = k * (1 - bias);
        const np = Math.tanh(kp);
        const nn = Math.tanh(kn);
        for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * 2 - 1;
            curve[i] = x >= 0 ? Math.tanh(kp * x) / np : Math.tanh(kn * x) / nn;
        }
        return curve;
    }
    _makeCurveFold(th = 0.6, n = 2048) {
        // Foldback distortion around +/-th
        const curve = new Float32Array(n);
        const T = Math.max(0.001, th);
        const fold = (x) => {
            x = Math.abs(x);
            if (x <= T) return x;
            const m = Math.floor(x / T);
            const r = x - m * T;
            const y = (m % 2 === 0) ? (T - r) : r;
            return y;
        };
        for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * 2 - 1;
            const s = Math.sign(x) || 1;
            curve[i] = s * (fold(x) / T);
        }
        return curve;
    }

    _updateCurve() {
        const d = this._drive;
        let curve;
        switch (this._type) {
            case 'soft': {
                const k = 1 + d * 2;
                curve = this._makeCurveSoft(k);
                break;
            }
            case 'classic': {
                const amt = 20 + d * 8;
                curve = this._makeCurveClassic(amt);
                break;
            }
            case 'fold': {
                const th = 1 / Math.max(0.1, Math.min(10, d));
                curve = this._makeCurveFold(th);
                break;
            }
            case 'asym': {
                const k = 2 + d * 2;
                const bias = Math.min(0.9, d / 20);
                curve = this._makeCurveAsym(k, bias);
                break;
            }
            case 'hard':
            default: {
                const th = 1 / (1 + d); // more drive -> lower threshold
                curve = this._makeCurveHard(th);
                break;
            }
        }
        this.shaper.curve = curve;
    }

    buildControls(container) {
        // Type selector
        const typeCtl = document.createElement('div');
        typeCtl.className = 'control';
        typeCtl.innerHTML = `
      <label>Type</label>
      <select>
        <option value="hard">Hard Clip</option>
        <option value="classic">Classic</option>
        <option value="soft">Soft</option>
        <option value="fold">Foldback</option>
        <option value="asym">Asym</option>
      </select>
    `;
        const typeSel = typeCtl.querySelector('select');
        typeSel.value = this._type;
        typeSel.addEventListener('change', () => { this._type = typeSel.value; this._updateCurve(); });

        // Drive
        const driveCtl = document.createElement('div');
        driveCtl.className = 'control';
        driveCtl.innerHTML = `
      <label>Drive</label>
      <input type="range" min="0" max="20" step="0.1" value="6" />
    `;
        const dEl = driveCtl.querySelector('input');
        dEl.addEventListener('input', () => {
            const v = Number(dEl.value);
            this.preGain.gain.setTargetAtTime(1 + v, this.audioCtx.currentTime, 0.01);
            this._drive = v;
            this._updateCurve();
        });

        // Tone (LPF cutoff)
        const toneCtl = document.createElement('div');
        toneCtl.className = 'control';
        toneCtl.innerHTML = `
      <label>Tone (Hz)</label>
      <input type="range" min="300" max="8000" step="1" value="2500" />
    `;
        const tEl = toneCtl.querySelector('input');
        tEl.addEventListener('input', () => this.tone.frequency.setTargetAtTime(Number(tEl.value), this.audioCtx.currentTime, 0.01));

        // Wet/Dry
        const wetCtl = document.createElement('div');
        wetCtl.className = 'control';
        wetCtl.innerHTML = `
      <label>Wet</label>
      <input type="range" min="0" max="1" step="0.01" value="0.9" />
    `;
        const wEl = wetCtl.querySelector('input');
        wEl.addEventListener('input', () => this.wet.gain.setTargetAtTime(Number(wEl.value), this.audioCtx.currentTime, 0.01));

        const dryCtl = document.createElement('div');
        dryCtl.className = 'control';
        dryCtl.innerHTML = `
      <label>Dry</label>
      <input type="range" min="0" max="1" step="0.01" value="0.1" />
    `;
        const drEl = dryCtl.querySelector('input');
        drEl.addEventListener('input', () => this.dry.gain.setTargetAtTime(Number(drEl.value), this.audioCtx.currentTime, 0.01));

        // Output level
        const levelCtl = document.createElement('div');
        levelCtl.className = 'control';
        levelCtl.innerHTML = `
      <label>Level</label>
      <input type="range" min="0" max="2" step="0.01" value="1" />
    `;
        const lvEl = levelCtl.querySelector('input');
        lvEl.addEventListener('input', () => this.out.gain.setTargetAtTime(Number(lvEl.value), this.audioCtx.currentTime, 0.01));

        container.appendChild(typeCtl);
        container.appendChild(driveCtl);
        container.appendChild(toneCtl);
        container.appendChild(wetCtl);
        container.appendChild(dryCtl);
        container.appendChild(levelCtl);

        this._ui = { typeSel, dEl, tEl, wEl, drEl, lvEl };
    }

    toJSON() {
        return {
            type: this._type,
            drive: this._drive,
            tone: this.tone.frequency.value,
            wet: this.wet.gain.value,
            dry: this.dry.gain.value,
            level: this.out.gain.value,
        };
    }
    fromJSON(state) {
        if (!state) return;
        if (typeof state.type === 'string') { this._type = state.type; this._ui?.typeSel && (this._ui.typeSel.value = state.type); this._updateCurve(); }
        if (typeof state.drive === 'number') {
            this._drive = state.drive;
            this.preGain.gain.value = 1 + state.drive;
            this._ui?.dEl && (this._ui.dEl.value = String(state.drive));
            this._updateCurve();
        }
        if (typeof state.tone === 'number') { this.tone.frequency.value = state.tone; this._ui?.tEl && (this._ui.tEl.value = String(state.tone)); }
        if (typeof state.wet === 'number') { this.wet.gain.value = state.wet; this._ui?.wEl && (this._ui.wEl.value = String(state.wet)); }
        if (typeof state.dry === 'number') { this.dry.gain.value = state.dry; this._ui?.drEl && (this._ui.drEl.value = String(state.dry)); }
        if (typeof state.level === 'number') { this.out.gain.value = state.level; this._ui?.lvEl && (this._ui.lvEl.value = String(state.level)); }
    }

    dispose() {
        try { this.input?.disconnect(); this.preGain?.disconnect(); this.shaper?.disconnect(); this.tone?.disconnect(); this.wet?.disconnect(); this.dry?.disconnect(); this.out?.disconnect(); } catch { }
        super.dispose?.();
    }
}
