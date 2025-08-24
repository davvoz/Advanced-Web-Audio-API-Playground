import { Module } from './module.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class TB303Module extends Module {
  get title() { return 'TB-303'; }

  buildAudio() {
    const ctx = this.audioCtx;
    // Core
    this._osc = ctx.createOscillator();
    this._osc.type = 'sawtooth';
    this._preGain = ctx.createGain(); this._preGain.gain.value = 1.0;
    this._filter = ctx.createBiquadFilter(); this._filter.type = 'lowpass';
    this._filter.frequency.value = 800; this._filter.Q.value = 10;
    this._vca = ctx.createGain(); this._vca.gain.value = 0.0001;
    this._out = ctx.createGain(); this._out.gain.value = 0.8;

    // Envelope routing
  this._envSrc = ctx.createConstantSource(); this._envSrc.offset.value = 1; // envelope source at 1, shaped by _envGain
    this._envGain = ctx.createGain(); this._envGain.gain.value = 0;
    this._envToVCF = ctx.createGain(); this._envToVCF.gain.value = 1500;
    this._envToVCA = ctx.createGain(); this._envToVCA.gain.value = 0.9;

    this._osc.connect(this._preGain);
    this._preGain.connect(this._filter);
    this._filter.connect(this._vca);
    this._vca.connect(this._out);
    this._envSrc.connect(this._envGain);
    this._envGain.connect(this._envToVCF);
    this._envGain.connect(this._envToVCA);
    this._envToVCF.connect(this._filter.frequency);
    this._envToVCA.connect(this._vca.gain);

    this._osc.start();
    this._envSrc.start();

    // Ports
    // Use dummy params for pitch/gate so onParamConnected hooks will fire
    const dummyPitch = ctx.createGain();
    const dummyGate = ctx.createGain();
    this.inputs = {
      // note/gate control
      pitch: { param: dummyPitch.gain },
      gate: { param: dummyGate.gain },
      // exposed parameters for external modulation
      cutoff: { param: this._filter.frequency },
      resonance: { param: this._filter.Q },
      env: { param: this._envToVCF.gain },
      envVCA: { param: this._envToVCA.gain },
      volume: { param: this._out.gain },
      drive: { param: this._preGain.gain },
    };
    this.outputs = { out: { node: this._out } };

    // State
    this._base = {
      wave: 'sawtooth', volume: 0.8,
      cutoff: 800, resonance: 10, envModHz: 1500, decay: 0.35,
      accentAmt: 0.6, slideTime: 0.07, tune: 0, fine: 0,
    };
    this._currentHz = 110;
    this._lastSlide = false;
  }

  buildControls(container) {
    this.root.classList.add('module-tb303');
  // Ensure ports re-render picks up new inputs
  this._renderPorts?.();
    const mk = (html) => { const d = document.createElement('div'); d.className='control'; d.innerHTML = html; return d; };
    const oscCtl = mk(`
      <label>Oscillator</label>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;">
        <div><small>Wave</small>
          <select data-role="wave"><option value="sawtooth" selected>Saw</option><option value="square">Square</option></select>
        </div>
        <div><small>Volume</small><input data-role="vol" type="range" min="0" max="1" step="0.01" value="${this._base.volume}"/></div>
        <div><small>Tune (st)</small><input data-role="tune" type="number" min="-24" max="24" step="1" value="${this._base.tune}"/></div>
        <div><small>Fine (ct)</small><input data-role="fine" type="number" min="-100" max="100" step="1" value="${this._base.fine}"/></div>
      </div>`);
    const vcfCtl = mk(`
      <label>Filter</label>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;">
        <div><small>Cutoff</small><input data-role="cutoff" type="range" min="50" max="6000" step="1" value="${this._base.cutoff}"/></div>
        <div><small>Resonance</small><input data-role="res" type="range" min="0.5" max="24" step="0.1" value="${this._base.resonance}"/></div>
        <div><small>Env Mod</small><input data-role="env" type="range" min="0" max="6000" step="1" value="${this._base.envModHz}"/></div>
        <div><small>Decay (s)</small><input data-role="decay" type="range" min="0.03" max="1.8" step="0.01" value="${this._base.decay}"/></div>
      </div>`);
    const accCtl = mk(`
      <label>Accent / Slide</label>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;">
        <div><small>Accent</small><input data-role="accent" type="range" min="0" max="1.5" step="0.01" value="${this._base.accentAmt}"/></div>
        <div><small>Slide (s)</small><input data-role="slide" type="range" min="0" max="0.35" step="0.005" value="${this._base.slideTime}"/></div>
      </div>`);
    container.appendChild(oscCtl); container.appendChild(vcfCtl); container.appendChild(accCtl);

    const waveEl = oscCtl.querySelector('[data-role=wave]');
    const volEl = oscCtl.querySelector('[data-role=vol]');
    const tuneEl = oscCtl.querySelector('[data-role=tune]');
    const fineEl = oscCtl.querySelector('[data-role=fine]');
    const cutoffEl = vcfCtl.querySelector('[data-role=cutoff]');
    const resEl = vcfCtl.querySelector('[data-role=res]');
    const envEl = vcfCtl.querySelector('[data-role=env]');
    const decayEl = vcfCtl.querySelector('[data-role=decay]');
    const accentEl = accCtl.querySelector('[data-role=accent]');
    const slideEl = accCtl.querySelector('[data-role=slide]');

    waveEl.addEventListener('change', () => { this._base.wave = waveEl.value; this._osc.type = this._base.wave; });
    volEl.addEventListener('input', () => { this._base.volume = Number(volEl.value); this._out.gain.setTargetAtTime(this._base.volume, this.audioCtx.currentTime, 0.01); });
    tuneEl.addEventListener('input', () => this._base.tune = Number(tuneEl.value));
    fineEl.addEventListener('input', () => this._base.fine = Number(fineEl.value));
    cutoffEl.addEventListener('input', () => { this._base.cutoff = Number(cutoffEl.value); this._filter.frequency.setTargetAtTime(this._base.cutoff, this.audioCtx.currentTime, 0.01); });
    resEl.addEventListener('input', () => { this._base.resonance = Number(resEl.value); this._filter.Q.setTargetAtTime(this._base.resonance, this.audioCtx.currentTime, 0.01); });
    envEl.addEventListener('input', () => { this._base.envModHz = Number(envEl.value); this._envToVCF.gain.setTargetAtTime(this._base.envModHz, this.audioCtx.currentTime, 0.01); });
    decayEl.addEventListener('input', () => this._base.decay = Number(decayEl.value));
    accentEl.addEventListener('input', () => this._base.accentAmt = Number(accentEl.value));
    slideEl.addEventListener('input', () => this._base.slideTime = Number(slideEl.value));
  }

  onParamConnected(portName, fromModuleId, fromPortName) {
    const src = this.getModuleById?.(fromModuleId);
    if (src?.subscribeTB303Note) {
      src.subscribeTB303Note(this.id, (msg) => {
        if (msg?.type === 'note') this._onNote(msg.midi, msg.hz, msg.accent, msg.slide, msg.gate);
        if (msg?.type === 'gate') this._setGate(msg.state === 'on');
      });
      return;
    }
    if (src?.subscribePitch) src.subscribePitch(this.id, (hz, active) => { if (typeof hz === 'number') this._setPitch(hz, false); if (typeof active === 'boolean') this._setGate(active); });
    if (src?.subscribeGate) src.subscribeGate(this.id, (state) => this._setGate(state === 'on'));
  }
  onParamDisconnected(portName, fromModuleId) {
    const src = this.getModuleById?.(fromModuleId);
    if (src?.unsubscribeTB303Note) src.unsubscribeTB303Note(this.id);
    if (src?.unsubscribePitch) src.unsubscribePitch(this.id);
    if (src?.unsubscribeGate) src.unsubscribeGate(this.id);
  }

  _targetHzFromMidi(midi) {
    const tuned = midi + (this._base.tune || 0) + (this._base.fine || 0) / 100;
    return midiToHz(tuned);
  }

  _onNote(midi, hzIn, accent = false, slide = false, gate = true) {
    const hz = hzIn || this._targetHzFromMidi(midi);
    this._setPitch(hz, !!slide);
    const retrig = !(this._lastSlide && slide);
    if (gate && retrig) this._triggerEnvelope(!!accent);
    this._setGate(gate);
    this._lastSlide = !!slide;
  }

  _setPitch(hz, slide) {
    const t = this.audioCtx.currentTime;
    const target = Math.max(1, hz);
    const f = this._osc.frequency;
    f.cancelScheduledValues(t);
    if (slide) f.setTargetAtTime(target, t, Math.max(0.001, clamp(this._base.slideTime, 0, 0.5) / 3));
    else f.setValueAtTime(target, t);
  }

  _triggerEnvelope(accent) {
    const t = this.audioCtx.currentTime;
    const g = this._envGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(1, t + 0.001);
    g.setTargetAtTime(0, t + 0.002, clamp(this._base.decay, 0.02, 2.0));
    const scale = 1 + (accent ? this._base.accentAmt : 0);
    this._envToVCF.gain.setTargetAtTime(this._base.envModHz * scale, t, 0.01);
    this._envToVCA.gain.setTargetAtTime(0.9 * scale, t, 0.01);
  }

  _setGate(on) {
    const t = this.audioCtx.currentTime;
    if (on) {
      if (this._vca.gain.value < 0.0001) this._vca.gain.setValueAtTime(0.0001, t);
    } else {
      this._vca.gain.cancelScheduledValues(t);
      this._vca.gain.setTargetAtTime(0.0001, t, 0.02);
    }
  }

  toJSON() {
    return { ...this._base };
  }
  fromJSON(state) {
    if (!state) return;
    const get = (k, d) => (typeof state[k] === 'number' ? state[k] : d);
    this._base.wave = state.wave || this._base.wave; this._osc.type = this._base.wave;
    this._base.volume = get('volume', this._base.volume); this._out.gain.value = this._base.volume;
    this._base.tune = get('tune', this._base.tune);
    this._base.fine = get('fine', this._base.fine);
    this._base.cutoff = get('cutoff', this._base.cutoff); this._filter.frequency.value = this._base.cutoff;
    this._base.resonance = get('resonance', this._base.resonance); this._filter.Q.value = this._base.resonance;
    this._base.envModHz = get('envModHz', this._base.envModHz); this._envToVCF.gain.value = this._base.envModHz;
    this._base.decay = get('decay', this._base.decay);
    this._base.accentAmt = get('accentAmt', this._base.accentAmt);
    this._base.slideTime = get('slideTime', this._base.slideTime);
  }
}
