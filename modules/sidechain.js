import { Module } from './module.js';

export class SidechainModule extends Module {
  get title() { return 'Sidechain'; }

  buildAudio() {
    const ctx = this.audioCtx;

    // Main path: in -> VCA -> out
    this.inNode = ctx.createGain();
    this.vca = ctx.createGain();
    this.vca.gain.value = 1;
    this.outGain = ctx.createGain();
    this.outGain.gain.value = 1;
    this.inNode.connect(this.vca);
    this.vca.connect(this.outGain);

    // Sidechain path: sidechain in -> analyser (for envelope follower)
    this.scIn = ctx.createGain();
    this.scIn.gain.value = 1;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.0; // we'll do custom smoothing
    this.scIn.connect(this.analyser);

    // Expose I/O
    this.inputs = {
      in: { node: this.inNode },
      sidechain: { node: this.scIn },
    };
    this.outputs = { out: { node: this.outGain } };

    // Follower state
    this._env = 0;
    this._threshold = 0.2; // 0..1
    this._amount = 0.7;    // 0..1
    this._attack = 0.01;   // seconds
    this._release = 0.2;   // seconds

    this._tdBuf = new Float32Array(this.analyser.fftSize);

    // Meter / follower loop (approx 60 fps)
    const interval = 1000 / 60;
    this._meterTimer = setInterval(() => {
      try {
        this.analyser.getFloatTimeDomainData(this._tdBuf);
        let sum = 0;
        for (let i = 0; i < this._tdBuf.length; i++) {
          const v = this._tdBuf[i];
          sum += v * v;
        }
        const rms = Math.sqrt(sum / this._tdBuf.length);
        const dt = interval / 1000;
        const target = rms;
        const rising = target > this._env;
        const tau = rising ? Math.max(0.001, this._attack) : Math.max(0.001, this._release);
        const alpha = Math.exp(-dt / tau);
        this._env = alpha * this._env + (1 - alpha) * target;
        // Compute ducking amount
        const over = Math.max(0, this._env - this._threshold) / Math.max(1e-6, 1 - this._threshold);
        const duck = Math.min(1, over) * this._amount;
        const gain = 1 - duck; // 1 -> no duck, 0 -> full duck
        const t = this.audioCtx.currentTime;
        this.vca.gain.setTargetAtTime(gain, t, 0.01);
        // Update meter UI
        if (this._meterFill) {
          this._meterFill.style.transform = `scaleX(${Math.max(0, Math.min(1, this._env))})`;
        }
      } catch {
        // ignore if context is closed/suspended
      }
    }, interval);
  }

  buildControls(container) {
    // Controls: Threshold, Amount, Attack, Release, Meter
    const ctl = document.createElement('div');
    ctl.className = 'control';
    ctl.innerHTML = `
      <label>Sidechain Ducking</label>
      <div style="display:grid;grid-template-columns:repeat(4, minmax(0,1fr));gap:8px;align-items:center;">
        <div>
          <small>Threshold</small>
          <input data-role="th" type="range" min="0" max="1" step="0.01" value="0.2" />
        </div>
        <div>
          <small>Amount</small>
          <input data-role="amt" type="range" min="0" max="1" step="0.01" value="0.7" />
        </div>
        <div>
          <small>Attack (ms)</small>
          <input data-role="atk" type="number" min="1" max="2000" step="1" value="10" />
        </div>
        <div>
          <small>Release (ms)</small>
          <input data-role="rel" type="number" min="10" max="3000" step="10" value="200" />
        </div>
      </div>
      <div style="margin-top:8px;">
        <small>Sidechain level</small>
        <div class="meter" style="height:8px;background:#1b2140;border:1px solid #283056;border-radius:4px;overflow:hidden;">
          <div data-role="meter-fill" style="height:100%;width:100%;transform-origin:0 50%;transform:scaleX(0);background:linear-gradient(90deg,#ff8a3a,#ff3a6b);"></div>
        </div>
      </div>
    `;
    container.appendChild(ctl);

    const th = ctl.querySelector('[data-role=th]');
    const amt = ctl.querySelector('[data-role=amt]');
    const atk = ctl.querySelector('[data-role=atk]');
    const rel = ctl.querySelector('[data-role=rel]');
    this._meterFill = ctl.querySelector('[data-role=meter-fill]');

    th.addEventListener('input', () => { this._threshold = Math.max(0, Math.min(1, Number(th.value))); });
    amt.addEventListener('input', () => { this._amount = Math.max(0, Math.min(1, Number(amt.value))); });
    atk.addEventListener('input', () => { this._attack = Math.max(0.001, Number(atk.value) / 1000); });
    rel.addEventListener('input', () => { this._release = Math.max(0.005, Number(rel.value) / 1000); });

    // Keep for state sync
    this._thEl = th; this._amtEl = amt; this._atkEl = atk; this._relEl = rel;
  }

  toJSON() {
    return { threshold: this._threshold, amount: this._amount, attack: this._attack, release: this._release };
  }
  fromJSON(state) {
    if (!state) return;
    if (typeof state.threshold === 'number') this._threshold = Math.max(0, Math.min(1, state.threshold));
    if (typeof state.amount === 'number') this._amount = Math.max(0, Math.min(1, state.amount));
    if (typeof state.attack === 'number') this._attack = Math.max(0.001, state.attack);
    if (typeof state.release === 'number') this._release = Math.max(0.005, state.release);
    // Sync UI
    if (this._thEl) this._thEl.value = String(this._threshold);
    if (this._amtEl) this._amtEl.value = String(this._amount);
    if (this._atkEl) this._atkEl.value = String(Math.round(this._attack * 1000));
    if (this._relEl) this._relEl.value = String(Math.round(this._release * 1000));
  }

  dispose() {
    try {
      clearInterval(this._meterTimer);
    } catch {}
    try { this.inNode?.disconnect(); this.vca?.disconnect(); this.scIn?.disconnect(); this.analyser?.disconnect(); this.outGain?.disconnect(); } catch {}
    super.dispose?.();
  }
}
