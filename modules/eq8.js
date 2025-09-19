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
  // Make EQ controls use a single full-width column
  try { container.style.gridTemplateColumns = '1fr'; } catch {}

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
  hdr.style.gridColumn = '1 / -1';
    container.appendChild(hdr);
    const bypassEl = hdr.querySelector('[data-role=bypass]');
    const resetBtn = hdr.querySelector('[data-role=reset]');
    bypassEl.addEventListener('input', () => { this._bypass = bypassEl.checked; this._applyBypass(); this._drawResponse(); });
    resetBtn.addEventListener('click', () => {
      this.bands.forEach((b, i) => { b.gain.value = 0; b.Q.value = 1; b.frequency.value = DEFAULT_BANDS[i]; });
      this._renderBandsGrid(grid);
      this._drawResponse();
    });

    // Response visualization
    const viz = document.createElement('div'); viz.className = 'control';
    viz.innerHTML = `
      <label>Response</label>
      <canvas data-role="viz" width="600" height="180" style="width:100%;height:180px;background:#0a0f2a;border:1px solid #26305a;border-radius:6px"></canvas>
    `;
    viz.style.gridColumn = '1 / -1';
    container.appendChild(viz);
    this._viz = viz.querySelector('canvas');
    // Resize observer to keep canvas crisp and full-width
    const resizeViz = () => {
      const cv = this._viz; if (!cv) return;
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const parent = cv.parentElement; if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const cssW = Math.max(300, Math.floor(rect.width));
      const cssH = Math.max(140, Math.floor(parseFloat(getComputedStyle(cv).height)) || 180);
      cv.width = Math.floor(cssW * dpr);
      cv.height = Math.floor(cssH * dpr);
      const g = cv.getContext('2d'); if (g) g.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._drawResponse();
    };
    try {
      this._eqVizRO?.disconnect?.();
      this._eqVizRO = new ResizeObserver(() => resizeViz());
      this._eqVizRO.observe(this.root);
      window.addEventListener('resize', resizeViz);
      setTimeout(resizeViz, 0);
    } catch {}

    // Bands grid
  const grid = document.createElement('div');
    grid.className = 'control';
  // Ensure enough width per band to avoid overlap between vertical slider and controls
  grid.innerHTML = `<label>Bands</label><div data-role="grid" style="display:grid;grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:10px; align-items:end;"></div>`;
  grid.style.gridColumn = '1 / -1';
    container.appendChild(grid);
    this._grid = grid.querySelector('[data-role=grid]');
    this._renderBandsGrid(grid);
    // Initial draw
    this._drawResponse();
  }

  _renderBandsGrid(gridWrap) {
    const grid = this._grid;
    if (!grid) return;
    grid.innerHTML = '';
    this.bands.forEach((b, i) => {
      const col = document.createElement('div');
      col.style.cssText = 'display:grid; grid-template-rows: auto 200px auto auto; gap:8px; justify-items:center; align-items:end; padding:8px; border:1px solid #26305a; border-radius:6px; background:#0a0f2a; min-width:180px;';
      col.innerHTML = `
        <div style="font-size:12px;color:#9ab;">B${i+1} • ${Math.round(b.frequency.value)} Hz</div>
        <div style="height:200px; display:flex; align-items:flex-end; justify-content:center; overflow:visible;">
          <input data-k="gain" type="range" min="-12" max="12" step="0.1" value="${b.gain.value}"
                 style="transform: rotate(-90deg); transform-origin:center; width: 200px; height: 24px;"/>
        </div>
         <div style="display:grid; grid-template-columns: 1fr; gap:6px; width:100%; margin-top:4px;">
          <label style="display:flex;align-items:center;gap:6px;justify-content:space-between;">
            <small>Freq</small>
            <input data-k="freq" type="number" min="20" max="20000" step="1" value="${Math.round(b.frequency.value)}" style="width:90px;"/>
          </label>
          <label style="display:flex;align-items:center;gap:6px;justify-content:space-between;">
            <small>Q</small>
            <input data-k="q" type="number" min="0.1" max="18" step="0.1" value="${b.Q.value}" style="width:90px;"/>
          </label>
        </div>
      `;
      const gainEl = col.querySelector('input[data-k=gain]');
      const freqEl = col.querySelector('input[data-k=freq]');
      const qEl = col.querySelector('input[data-k=q]');
      const syncLabel = () => { const lab = col.querySelector('div'); if (lab) lab.textContent = `B${i+1} • ${Math.round(b.frequency.value)} Hz`; };
      gainEl.addEventListener('input', () => { b.gain.setTargetAtTime(Number(gainEl.value), this.audioCtx.currentTime, 0.01); this._drawResponse(); });
      freqEl.addEventListener('input', () => { b.frequency.setTargetAtTime(Number(freqEl.value), this.audioCtx.currentTime, 0.01); syncLabel(); this._drawResponse(); });
      qEl.addEventListener('input', () => { b.Q.setTargetAtTime(Number(qEl.value), this.audioCtx.currentTime, 0.01); this._drawResponse(); });
      grid.appendChild(col);
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

  _drawResponse() {
    const cv = this._viz; if (!cv) return;
    const g = cv.getContext('2d'); if (!g) return;
    const w = cv.width, h = cv.height;
    g.clearRect(0,0,w,h);
    // background
    g.fillStyle = '#0a0f2a'; g.fillRect(0,0,w,h);
    g.strokeStyle = '#26305a'; g.strokeRect(0.5,0.5,w-1,h-1);
    const fMin = 20, fMax = 20000;
    const N = 256;
    const freqs = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const f = fMin * Math.pow(fMax / fMin, t);
      freqs[i] = f;
    }
    // total magnitude = product of band magnitudes
    const total = new Float32Array(N); total.fill(1);
    const mag = new Float32Array(N);
    const pha = new Float32Array(N);
    this.bands.forEach(b => {
      b.getFrequencyResponse(freqs, mag, pha);
      for (let i = 0; i < N; i++) total[i] *= mag[i];
    });
    // Convert to dB in range [-18, +18]
    const toX = (f) => {
      const t = Math.log(f / fMin) / Math.log(fMax / fMin);
      return Math.max(0, Math.min(w - 1, t * (w - 1)));
    };
    const dbMin = -18, dbMax = 18;
    const toY = (db) => {
      const t = (db - dbMin) / (dbMax - dbMin);
      return Math.max(0, Math.min(h - 1, (1 - t) * (h - 1)));
    };
    // 0 dB line
    g.strokeStyle = '#334a'; g.beginPath(); const y0 = toY(0); g.moveTo(0, y0); g.lineTo(w, y0); g.stroke();
    // draw curve
    g.strokeStyle = this._bypass ? '#888a' : '#7aa2ff';
    g.beginPath();
    for (let i = 0; i < N; i++) {
      const db = 20 * Math.log10(Math.max(1e-6, total[i]));
      const x = (i / (N - 1)) * (w - 1);
      const y = toY(Math.max(dbMin, Math.min(dbMax, db)));
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    // band markers
    this.bands.forEach((b, i) => {
      const x = toX(b.frequency.value);
      const y = toY(Math.max(dbMin, Math.min(dbMax, b.gain.value)));
      g.fillStyle = '#4bd5a7';
      g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
    });
    // frequency grid lines
    g.strokeStyle = '#2a3468';
    [20,50,100,200,500,1000,2000,5000,10000,20000].forEach((f) => {
      const x = toX(f); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    });
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
