import { Module } from './module.js';

export class FMModule extends Module {
  get title() { return 'FM Synth'; }

  buildAudio() {
    const ctx = this.audioCtx;

    // Carrier and modulator
    this.carrier = ctx.createOscillator();
    this.carrier.type = 'sine';
    this.carrier.frequency.value = 220;
    this.carrier.detune.value = 0; // cents

    this.mod = ctx.createOscillator();
    this.mod.type = 'sine';
    this.mod.frequency.value = 220; // default same as carrier
    this.mod.detune.value = 0; // cents

    // Index controls frequency deviation in Hz (audio-rate into AudioParam)
    this.modGain = ctx.createGain();
    this.modGain.gain.value = 0; // Hz deviation

    // Mod feedback: mod signal fed back into its own frequency (Hz)
    this.modFb = ctx.createGain();
    this.modFb.gain.value = 0; // Hz
    this.mod.connect(this.modFb);
    this.modFb.connect(this.mod.frequency);

    // Shaper path for fun drive
    this.preGain = ctx.createGain();
    this.preGain.gain.value = 1; // drive pre-gain
    this.shaper = ctx.createWaveShaper();
    this._setDrive(0); // init curve

    // Output gain (post)
    this.outGain = ctx.createGain();
    this.outGain.gain.value = 0.5;

    // Wire: mod -> modGain -> carrier.frequency; carrier -> preGain -> shaper -> outGain
    this.mod.connect(this.modGain);
    this.modGain.connect(this.carrier.frequency);
    this.carrier.connect(this.preGain);
    this.preGain.connect(this.shaper);
    this.shaper.connect(this.outGain);

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

    // Ratio mode state
    this._modFreqMode = 'hz'; // 'hz' | 'ratio'
    this._modRatio = 1.0;

    // Keep mod freq synced to carrier when in ratio mode (lightweight polling)
    this._ratioTimer = setInterval(() => {
      if (this._modFreqMode !== 'ratio') return;
      const base = Math.max(1, this.carrier.frequency.value);
      const f = base * this._modRatio;
      const clamped = Math.max(0.1, Math.min(20000, f));
      if (Math.abs(this.mod.frequency.value - clamped) > 0.01) {
        this.mod.frequency.setTargetAtTime(clamped, this.audioCtx.currentTime, 0.01);
      }
    }, 50);
  }

  buildControls(container) {
    this.root.classList.add('module-fm');

    // Carrier controls
    const carCtl = document.createElement('div');
    carCtl.className = 'control';
    carCtl.innerHTML = `
      <label>Carrier</label>
      <div style="display:grid;grid-template-columns:repeat(4, minmax(0,1fr));gap:8px;align-items:center;">
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
          <small>Detune (cents)</small>
          <input data-role="car-detune" type="number" min="-1200" max="1200" step="1" value="0" />
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
      <div style="display:grid;grid-template-columns:repeat(5, minmax(0,1fr));gap:8px;align-items:center;">
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
          <small>Mode</small>
          <select data-role="mod-mode">
            <option value="hz" selected>Hz</option>
            <option value="ratio">Ratio</option>
          </select>
        </div>
        <div>
          <small data-role="mod-freq-label">Mod Freq (Hz)</small>
          <input data-role="mod-freq" type="number" min="0.1" max="20000" step="0.1" value="220" />
        </div>
        <div>
          <small>Detune (cents)</small>
          <input data-role="mod-detune" type="number" min="-1200" max="1200" step="1" value="0" />
        </div>
        <div>
          <small>Index (Hz dev)</small>
          <input data-role="index" type="range" min="0" max="3000" step="1" value="0" />
        </div>
        <div>
          <small>Feedback (Hz)</small>
          <input data-role="feedback" type="range" min="0" max="2000" step="1" value="0" />
        </div>
      </div>
    `;

    // Drive controls
    const drvCtl = document.createElement('div');
    drvCtl.className = 'control';
    drvCtl.innerHTML = `
      <label>Drive / Shaper</label>
      <div style="display:grid;grid-template-columns:repeat(2, minmax(0,1fr));gap:8px;align-items:center;">
        <div>
          <small>Drive</small>
          <input data-role="drive" type="range" min="0" max="1" step="0.01" value="0" />
        </div>
        <div>
          <small>Output</small>
          <input data-role="level-post" type="range" min="0" max="1.5" step="0.01" value="0.5" />
        </div>
      </div>
      <div style="margin-top:6px;">
        <button class="btn" data-role="random">Randomize</button>
      </div>
    `;

    container.appendChild(carCtl);
    container.appendChild(modCtl);
    container.appendChild(drvCtl);

    // Bind controls
    const carWave = carCtl.querySelector('[data-role=car-wave]');
    const carFreq = carCtl.querySelector('[data-role=car-freq]');
    const carDet = carCtl.querySelector('[data-role=car-detune]');
    const level = carCtl.querySelector('[data-role=level]');
    const modWave = modCtl.querySelector('[data-role=mod-wave]');
    const modMode = modCtl.querySelector('[data-role=mod-mode]');
    const modFreq = modCtl.querySelector('[data-role=mod-freq]');
    const modFreqLabel = modCtl.querySelector('[data-role=mod-freq-label]');
    const modDet = modCtl.querySelector('[data-role=mod-detune]');
    const index = modCtl.querySelector('[data-role=index]');
    const feedback = modCtl.querySelector('[data-role=feedback]');
    const drive = drvCtl.querySelector('[data-role=drive]');
    const levelPost = drvCtl.querySelector('[data-role=level-post]');
    const rndBtn = drvCtl.querySelector('[data-role=random]');

    carWave.addEventListener('input', () => this.carrier.type = carWave.value);
    carFreq.addEventListener('input', () => this.carrier.frequency.setTargetAtTime(Number(carFreq.value), this.audioCtx.currentTime, 0.01));
    carDet.addEventListener('input', () => this.carrier.detune.setTargetAtTime(Number(carDet.value), this.audioCtx.currentTime, 0.01));
    level.addEventListener('input', () => this.outGain.gain.setTargetAtTime(Number(level.value), this.audioCtx.currentTime, 0.01));
    modWave.addEventListener('input', () => this.mod.type = modWave.value);
    const updateModeUi = () => {
      if (this._modFreqMode === 'ratio') {
        modFreqLabel.textContent = 'Ratio (×)';
        modFreq.min = '0.1'; modFreq.max = '16'; modFreq.step = '0.01';
      } else {
        modFreqLabel.textContent = 'Mod Freq (Hz)';
        modFreq.min = '0.1'; modFreq.max = '20000'; modFreq.step = '0.1';
      }
    };
    modMode.addEventListener('input', () => {
      this._modFreqMode = modMode.value;
      updateModeUi();
      if (this._modFreqMode === 'ratio') {
        this._modRatio = Number(modFreq.value) || 1;
      } else {
        this.mod.frequency.setTargetAtTime(Number(modFreq.value)||220, this.audioCtx.currentTime, 0.01);
      }
    });
    modFreq.addEventListener('input', () => {
      if (this._modFreqMode === 'ratio') {
        this._modRatio = Number(modFreq.value) || 1;
      } else {
        this.mod.frequency.setTargetAtTime(Number(modFreq.value), this.audioCtx.currentTime, 0.01);
      }
    });
    modDet.addEventListener('input', () => this.mod.detune.setTargetAtTime(Number(modDet.value), this.audioCtx.currentTime, 0.01));
    index.addEventListener('input', () => this.modGain.gain.setTargetAtTime(Number(index.value), this.audioCtx.currentTime, 0.01));
    feedback.addEventListener('input', () => this.modFb.gain.setTargetAtTime(Number(feedback.value), this.audioCtx.currentTime, 0.01));
    drive.addEventListener('input', () => this._setDrive(Number(drive.value)));
    levelPost.addEventListener('input', () => this.outGain.gain.setTargetAtTime(Number(levelPost.value), this.audioCtx.currentTime, 0.01));
    rndBtn.addEventListener('click', () => this._randomizeUi({ carWave, modWave, modMode, modFreq, index, feedback, drive, carDet, modDet }));

    // Keep references for fromJSON
    this._carFreqEl = carFreq;
    this._levelEl = level;
    this._modFreqEl = modFreq;
    this._indexEl = index;
    this._carWaveEl = carWave;
    this._modWaveEl = modWave;
    this._carDetEl = carDet;
    this._modDetEl = modDet;
    this._modModeEl = modMode;
    this._modFreqLabelEl = modFreqLabel;
    this._fbEl = feedback;
    this._driveEl = drive;
    this._levelPostEl = levelPost;

    // Initialize mode UI
    updateModeUi();
  }

  toJSON() {
    return {
      car: { type: this.carrier.type, freq: this.carrier.frequency.value, detune: this.carrier.detune.value },
      mod: { type: this.mod.type, mode: this._modFreqMode, value: (this._modFreqMode==='ratio'? this._modRatio : this.mod.frequency.value), detune: this.mod.detune.value },
      index: this.modGain.gain.value,
      feedback: this.modFb.gain.value,
      drive: this._drive || 0,
      level: this.outGain.gain.value,
    };
  }
  fromJSON(state) {
    if (!state) return;
    if (state.car) {
      if (state.car.type) this.carrier.type = state.car.type;
      if (typeof state.car.freq === 'number') this.carrier.frequency.value = state.car.freq;
      if (typeof state.car.detune === 'number') this.carrier.detune.value = state.car.detune;
    }
    if (state.mod) {
      if (state.mod.type) this.mod.type = state.mod.type;
      if (state.mod.mode === 'ratio') {
        this._modFreqMode = 'ratio';
        this._modRatio = Number(state.mod.value) || 1;
      } else {
        this._modFreqMode = 'hz';
        if (typeof state.mod.value === 'number') this.mod.frequency.value = state.mod.value;
      }
      if (typeof state.mod.detune === 'number') this.mod.detune.value = state.mod.detune;
    }
    if (typeof state.index === 'number') this.modGain.gain.value = state.index;
    if (typeof state.feedback === 'number') this.modFb.gain.value = state.feedback;
    if (typeof state.drive === 'number') this._setDrive(state.drive);
    if (typeof state.level === 'number') this.outGain.gain.value = state.level;
    // sync UI
    if (this._carFreqEl) this._carFreqEl.value = String(this.carrier.frequency.value);
    if (this._modFreqEl) this._modFreqEl.value = String(this.mod.frequency.value);
    if (this._indexEl) this._indexEl.value = String(this.modGain.gain.value);
    if (this._levelEl) this._levelEl.value = String(this.outGain.gain.value);
    if (this._carWaveEl) this._carWaveEl.value = this.carrier.type;
    if (this._modWaveEl) this._modWaveEl.value = this.mod.type;
    if (this._carDetEl) this._carDetEl.value = String(this.carrier.detune.value);
    if (this._modDetEl) this._modDetEl.value = String(this.mod.detune.value);
    if (this._modModeEl) this._modModeEl.value = this._modFreqMode;
    if (this._modFreqLabelEl) this._modFreqLabelEl.textContent = this._modFreqMode==='ratio' ? 'Ratio (×)' : 'Mod Freq (Hz)';
    if (this._fbEl) this._fbEl.value = String(this.modFb.gain.value);
    if (this._driveEl) this._driveEl.value = String(this._drive || 0);
    if (this._levelPostEl) this._levelPostEl.value = String(this.outGain.gain.value);
  }

  dispose() {
    try { this.carrier?.disconnect(); this.mod?.disconnect(); this.modGain?.disconnect(); this.outGain?.disconnect(); } catch {}
    try { this.modFb?.disconnect(); this.preGain?.disconnect(); this.shaper?.disconnect(); } catch {}
    try { clearInterval(this._ratioTimer); } catch {}
    super.dispose?.();
  }

  _setDrive(amount) {
    // amount 0..1 -> set preGain and shaper curve (tanh)
    this._drive = Math.max(0, Math.min(1, amount));
    const pre = 1 + this._drive * 20; // boost before shaping
    if (this.preGain) this.preGain.gain.setValueAtTime(pre, this.audioCtx?.currentTime || 0);
    const curve = new Float32Array(1024);
    const k = this._drive * 2.5 + 0.0001; // shape factor
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1; // -1..1
      curve[i] = Math.tanh(x * (1 + k * 10));
    }
    if (this.shaper) this.shaper.curve = curve;
  }

  _randomizeUi(refs) {
    const waves = ['sine','triangle','sawtooth','square'];
    const pick = (arr) => arr[Math.floor(Math.random()*arr.length)];
    refs.carWave.value = pick(waves); this.carrier.type = refs.carWave.value;
    refs.modWave.value = pick(waves); this.mod.type = refs.modWave.value;
    refs.modMode.value = Math.random() < 0.6 ? 'ratio' : 'hz'; this._modFreqMode = refs.modMode.value;
    if (this._modFreqMode === 'ratio') {
      const r = +(Math.pow(2, (Math.random()*8 - 3))).toFixed(2); // ~0.125..8
      refs.modFreq.value = String(r);
      this._modRatio = r;
    } else {
      const f = +(50 + Math.random()*1000).toFixed(1);
      refs.modFreq.value = String(f);
      this.mod.frequency.setTargetAtTime(f, this.audioCtx.currentTime, 0.01);
    }
    const idx = Math.floor(Math.random()*1500);
    refs.index.value = String(idx); this.modGain.gain.setTargetAtTime(idx, this.audioCtx.currentTime, 0.01);
    const fb = Math.floor(Math.random()*600);
    refs.feedback.value = String(fb); this.modFb.gain.setTargetAtTime(fb, this.audioCtx.currentTime, 0.01);
    const drv = +(Math.random()).toFixed(2);
    refs.drive.value = String(drv); this._setDrive(drv);
    const cd = Math.floor((Math.random()*200) - 100);
    const md = Math.floor((Math.random()*200) - 100);
    refs.carDet.value = String(cd); this.carrier.detune.setTargetAtTime(cd, this.audioCtx.currentTime, 0.01);
    refs.modDet.value = String(md); this.mod.detune.setTargetAtTime(md, this.audioCtx.currentTime, 0.01);
  }
}
