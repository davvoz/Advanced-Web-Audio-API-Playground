import { Module } from './module.js';

const DEFAULT_BANDS = [60, 120, 240, 480, 1000, 2000, 4000, 8000];

export class EQ8Module extends Module {
  get title() { return 'EQ-8'; }

  buildAudio() {
    const ctx = this.audioCtx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.bands = DEFAULT_BANDS.map((freq) => {
      const biq = ctx.createBiquadFilter();
      biq.type = 'peaking';
      biq.frequency.value = freq;
      biq.Q.value = 1.0;
      biq.gain.value = 0.0; // dB
      return biq;
    });
    // Chain: input -> b0 -> b1 -> ... -> b7 -> output
    let node = this.input;
    this.bands.forEach(b => { node.connect(b); node = b; });
    node.connect(this.output);

    // Ports
    this.inputs = { in: { node: this.input } };
    // Expose per-band gain AudioParams for modulation
    this.bands.forEach((b, i) => {
      this.inputs[`b${i + 1}`] = { param: b.gain };
    });
    this.outputs = { out: { node: this.output } };

    this._bypass = false;
  }

  buildControls(container) {
    this.root.classList.add('module-eq8');

    // Header controls
    const hdr = document.createElement('div');
    hdr.className = 'control';
    hdr.innerHTML = `
      <label>EQ-8</label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;"><input type="checkbox" data-role="bypass"/> Bypass</label>
        <button class="btn" data-role="reset">Reset</button>
      </div>
    `;
    container.appendChild(hdr);
    const bypassEl = hdr.querySelector('[data-role=bypass]');
    const resetBtn = hdr.querySelector('[data-role=reset]');
    bypassEl.addEventListener('input', () => { this._bypass = bypassEl.checked; this._applyBypass(); });
    resetBtn.addEventListener('click', () => {
      this.bands.forEach((b, i) => { b.gain.value = 0; b.Q.value = 1; b.frequency.value = DEFAULT_BANDS[i]; });
      this._renderBandsGrid(grid);
    });

    // Bands grid
    const grid = document.createElement('div');
    grid.className = 'control';
    grid.innerHTML = `<label>Bands</label><div data-role="grid" style="display:grid;grid-template-columns: repeat(4, minmax(0, 1fr)); gap:8px;"></div>`;
    container.appendChild(grid);
    this._grid = grid.querySelector('[data-role=grid]');
    this._renderBandsGrid(grid);
  }

  _renderBandsGrid(gridWrap) {
    const grid = this._grid;
    if (!grid) return;
    grid.innerHTML = '';
    this.bands.forEach((b, i) => {
      const card = document.createElement('div');
      card.className = 'control';
      card.innerHTML = `
        <label>Band ${i + 1} — ${Math.round(b.frequency.value)} Hz</label>
        <div style="display:grid;grid-template-columns: 1fr 1fr; gap:6px; align-items:center;">
          <div style="grid-column: span 2;">
            <small>Gain (dB)</small>
            <input data-k="gain" type="range" min="-12" max="12" step="0.1" value="${b.gain.value}"/>
          </div>
          <div>
            <small>Freq (Hz)</small>
            <input data-k="freq" type="number" min="20" max="20000" step="1" value="${Math.round(b.frequency.value)}"/>
          </div>
          <div>
            <small>Q</small>
            <input data-k="q" type="number" min="0.1" max="18" step="0.1" value="${b.Q.value}"/>
          </div>
        </div>
      `;
      const gainEl = card.querySelector('input[data-k=gain]');
      const freqEl = card.querySelector('input[data-k=freq]');
      const qEl = card.querySelector('input[data-k=q]');
      const syncLabel = () => { const lab = card.querySelector('label'); if (lab) lab.textContent = `Band ${i + 1} — ${Math.round(b.frequency.value)} Hz`; };
      gainEl.addEventListener('input', () => { b.gain.setTargetAtTime(Number(gainEl.value), this.audioCtx.currentTime, 0.01); });
      freqEl.addEventListener('input', () => { b.frequency.setTargetAtTime(Number(freqEl.value), this.audioCtx.currentTime, 0.01); syncLabel(); });
      qEl.addEventListener('input', () => { b.Q.setTargetAtTime(Number(qEl.value), this.audioCtx.currentTime, 0.01); });
      grid.appendChild(card);
    });
  }

  _applyBypass() {
    try {
      this.input.disconnect();
      this.bands.forEach(b => b.disconnect());
      this.output.disconnect();
    } catch {}
    if (this._bypass) {
      // input -> output direct
      this.input.connect(this.output);
    } else {
      // input -> chain -> output
      let node = this.input;
      this.bands.forEach(b => { node.connect(b); node = b; });
      node.connect(this.output);
    }
  }

  toJSON() {
    return {
      bypass: !!this._bypass,
      bands: this.bands.map(b => ({ f: b.frequency.value, q: b.Q.value, g: b.gain.value }))
    };
  }
  fromJSON(state) {
    if (!state) return;
    if (typeof state.bypass === 'boolean') { this._bypass = state.bypass; this._applyBypass(); }
    if (Array.isArray(state.bands)) {
      for (let i = 0; i < Math.min(this.bands.length, state.bands.length); i++) {
        const s = state.bands[i];
        if (!s) continue;
        if (typeof s.f === 'number') this.bands[i].frequency.value = s.f;
        if (typeof s.q === 'number') this.bands[i].Q.value = s.q;
        if (typeof s.g === 'number') this.bands[i].gain.value = s.g;
      }
    }
  }
}
