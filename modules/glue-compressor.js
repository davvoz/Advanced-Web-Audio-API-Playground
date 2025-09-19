import { Module } from './module.js';

// Simple "Glue" style bus compressor based on DynamicsCompressorNode
// Features: Threshold, Ratio, Attack, Release, Knee, Makeup Gain, Mix (dry/wet), Output, GR meter
export class GlueCompressorModule extends Module {
  get title() { return 'Glue Compressor'; }

  buildAudio() {
    const ctx = this.audioCtx;

    // IO
    this.inNode = ctx.createGain();
    this.outNode = ctx.createGain();
    this.outNode.gain.value = 1;

    // Dry/Wet paths
    this.dryGain = ctx.createGain();
    this.wetGain = ctx.createGain();
    this.dryGain.gain.value = 0.5; // default 50/50
    this.wetGain.gain.value = 0.5;

    // Compressor
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -24; // dB
    this.comp.knee.value = 6;        // dB
    this.comp.ratio.value = 4;       // :1
    this.comp.attack.value = 0.01;   // s
    this.comp.release.value = 0.25;  // s

    // Makeup and output gains
    this.makeup = ctx.createGain();
    this.makeup.gain.value = 1; // 0 dB

    // Mix control network: mixCtl [0..1] -> wet; dry = 1 - mix
    this.mixCtl = ctx.createConstantSource();
    this.mixCtl.offset.value = 0.5; // 50% wet
    this.mixCtl.start();
    // dry = 1 - mix: use invert (-1) and add +1 DC
    this._invert = ctx.createGain(); this._invert.gain.value = -1;
    this._one = ctx.createConstantSource(); this._one.offset.value = 1; this._one.start();
    // wire mix to wet/dry gains
    this.mixCtl.connect(this.wetGain.gain);
    this.mixCtl.connect(this._invert);
    this._invert.connect(this.dryGain.gain);
    this._one.connect(this.dryGain.gain);

    // Routing: in -> [dry path] + [wet path -> comp -> makeup] -> sum -> out
    this.inNode.connect(this.dryGain);
    this.inNode.connect(this.comp);
    this.comp.connect(this.makeup);
    this.makeup.connect(this.wetGain);
    // Sum dry+wet
    this.sum = ctx.createGain(); this.sum.gain.value = 1;
    this.dryGain.connect(this.sum);
    this.wetGain.connect(this.sum);
    this.sum.connect(this.outNode);

    // Expose ports
    this.inputs = {
      in: { node: this.inNode },
      threshold: { param: this.comp.threshold },
      ratio: { param: this.comp.ratio },
      attack: { param: this.comp.attack },
      release: { param: this.comp.release },
      knee: { param: this.comp.knee },
      makeup: { param: this.makeup.gain },
      mix: { param: this.mixCtl.offset },
      out: { param: this.outNode.gain },
    };
    this.outputs = { out: { node: this.outNode } };

    // Meter timer for gain reduction
    const interval = 1000 / 60;
    this._meterTimer = setInterval(() => {
      try {
        const gr = this.comp.reduction || 0; // negative dB
        if (this._grEl) {
          const v = Math.max(0, Math.min(24, -gr)); // display up to 24 dB GR
          const pct = v / 24;
          this._grEl.style.transform = `scaleX(${pct})`;
        }
        if (this._grText) {
          this._grText.textContent = `${(Math.max(0, -gr)).toFixed(1)} dB`;
        }
      } catch {}
    }, interval);
  }

  buildControls(container) {
    const db = (x) => Math.round(x * 10) / 10;
    const ctl = document.createElement('div');
    ctl.className = 'control';
    ctl.innerHTML = `
      <label>Glue Compressor</label>
      <div style="display:grid;grid-template-columns:repeat(3, minmax(0,1fr));gap:8px;align-items:center;">
        <div><small>Threshold (dB)</small><input data-role="th" type="range" min="-60" max="0" step="1" value="-24"/></div>
        <div><small>Ratio</small><input data-role="ra" type="range" min="1" max="20" step="0.1" value="4"/></div>
        <div><small>Knee (dB)</small><input data-role="kn" type="range" min="0" max="40" step="1" value="6"/></div>
        <div><small>Attack (ms)</small><input data-role="at" type="number" min="0.1" max="1000" step="0.1" value="10"/></div>
        <div><small>Release (ms)</small><input data-role="re" type="number" min="10" max="5000" step="1" value="250"/></div>
        <div><small>Mix (%)</small><input data-role="mx" type="range" min="0" max="100" step="1" value="50"/></div>
        <div><small>Makeup (dB)</small><input data-role="mk" type="range" min="-24" max="24" step="0.1" value="0"/></div>
        <div><small>Output (dB)</small><input data-role="og" type="range" min="-24" max="24" step="0.1" value="0"/></div>
        <div>
          <small>Gain Reduction</small>
          <div class="meter" style="height:8px;background:#1b2140;border:1px solid #283056;border-radius:4px;overflow:hidden;">
            <div data-role="gr" style="height:100%;width:100%;transform-origin:0 50%;transform:scaleX(0);background:linear-gradient(90deg,#7aa2ff,#4bd5a7);"></div>
          </div>
          <div data-role="grtxt" style="font-size:12px;color:#8a92b2;margin-top:4px">0.0 dB</div>
        </div>
      </div>
    `;
    container.appendChild(ctl);

    const th = ctl.querySelector('[data-role=th]');
    const ra = ctl.querySelector('[data-role=ra]');
    const kn = ctl.querySelector('[data-role=kn]');
    const at = ctl.querySelector('[data-role=at]');
    const re = ctl.querySelector('[data-role=re]');
    const mx = ctl.querySelector('[data-role=mx]');
    const mk = ctl.querySelector('[data-role=mk]');
    const og = ctl.querySelector('[data-role=og]');
    this._grEl = ctl.querySelector('[data-role=gr]');
    this._grText = ctl.querySelector('[data-role=grtxt]');

    const now = () => this.audioCtx.currentTime;
    const dbToGain = (dB) => Math.pow(10, dB / 20);

    th.addEventListener('input', () => this.comp.threshold.setTargetAtTime(Number(th.value), now(), 0.01));
    ra.addEventListener('input', () => this.comp.ratio.setTargetAtTime(Number(ra.value), now(), 0.01));
    kn.addEventListener('input', () => this.comp.knee.setTargetAtTime(Number(kn.value), now(), 0.01));
    at.addEventListener('input', () => this.comp.attack.setTargetAtTime(Math.max(0, Number(at.value) / 1000), now(), 0.01));
    re.addEventListener('input', () => this.comp.release.setTargetAtTime(Math.max(0, Number(re.value) / 1000), now(), 0.01));
    mx.addEventListener('input', () => this.mixCtl.offset.setTargetAtTime(Math.max(0, Math.min(1, Number(mx.value) / 100)), now(), 0.01));
    mk.addEventListener('input', () => this.makeup.gain.setTargetAtTime(dbToGain(Number(mk.value)), now(), 0.01));
    og.addEventListener('input', () => this.outNode.gain.setTargetAtTime(dbToGain(Number(og.value)), now(), 0.01));

    // keep refs for state
    this._ui = { th, ra, kn, at, re, mx, mk, og };
  }

  onParamConnected(portName) {
    // For absolute control behavior like Gain module
    if (portName === 'mix') {
      this._mixBase = this.mixCtl.offset.value;
      this.mixCtl.offset.setValueAtTime(0, this.audioCtx.currentTime);
    }
    if (portName === 'makeup') {
      this._mkBase = this.makeup.gain.value;
      this.makeup.gain.setValueAtTime(0, this.audioCtx.currentTime);
    }
    if (portName === 'out') {
      this._outBase = this.outNode.gain.value;
      this.outNode.gain.setValueAtTime(0, this.audioCtx.currentTime);
    }
  }
  onParamDisconnected(portName) {
    if (portName === 'mix') {
      const v = typeof this._mixBase === 'number' ? this._mixBase : 0.5;
      this.mixCtl.offset.setValueAtTime(v, this.audioCtx.currentTime);
    }
    if (portName === 'makeup') {
      const v = typeof this._mkBase === 'number' ? this._mkBase : 1;
      this.makeup.gain.setValueAtTime(v, this.audioCtx.currentTime);
    }
    if (portName === 'out') {
      const v = typeof this._outBase === 'number' ? this._outBase : 1;
      this.outNode.gain.setValueAtTime(v, this.audioCtx.currentTime);
    }
  }

  toJSON() {
    const gainToDb = (g) => 20 * Math.log10(Math.max(1e-6, g));
    return {
      threshold: this.comp.threshold.value,
      ratio: this.comp.ratio.value,
      knee: this.comp.knee.value,
      attack: this.comp.attack.value,
      release: this.comp.release.value,
      mix: this.mixCtl.offset.value,
      makeupDb: gainToDb(this.makeup.gain.value),
      outDb: gainToDb(this.outNode.gain.value),
    };
  }
  fromJSON(state) {
    if (!state) return;
    const dbToGain = (dB) => Math.pow(10, dB / 20);
    if (typeof state.threshold === 'number') { this.comp.threshold.value = state.threshold; this._ui?.th && (this._ui.th.value = String(state.threshold)); }
    if (typeof state.ratio === 'number') { this.comp.ratio.value = state.ratio; this._ui?.ra && (this._ui.ra.value = String(state.ratio)); }
    if (typeof state.knee === 'number') { this.comp.knee.value = state.knee; this._ui?.kn && (this._ui.kn.value = String(state.knee)); }
    if (typeof state.attack === 'number') { this.comp.attack.value = state.attack; this._ui?.at && (this._ui.at.value = String(Math.round(state.attack * 1000))); }
    if (typeof state.release === 'number') { this.comp.release.value = state.release; this._ui?.re && (this._ui.re.value = String(Math.round(state.release * 1000))); }
    if (typeof state.mix === 'number') { this.mixCtl.offset.value = Math.max(0, Math.min(1, state.mix)); this._ui?.mx && (this._ui.mx.value = String(Math.round(this.mixCtl.offset.value * 100))); }
    if (typeof state.makeupDb === 'number') { this.makeup.gain.value = dbToGain(state.makeupDb); this._ui?.mk && (this._ui.mk.value = String(state.makeupDb)); }
    if (typeof state.outDb === 'number') { this.outNode.gain.value = dbToGain(state.outDb); this._ui?.og && (this._ui.og.value = String(state.outDb)); }
  }

  dispose() {
    try { clearInterval(this._meterTimer); } catch {}
    try {
      this.mixCtl?.stop?.();
      this._one?.stop?.();
      this.inNode?.disconnect();
      this.dryGain?.disconnect();
      this.wetGain?.disconnect();
      this.sum?.disconnect();
      this.comp?.disconnect();
      this.makeup?.disconnect();
      this.outNode?.disconnect();
    } catch {}
    super.dispose?.();
  }
}
