import { Module } from './module.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const midiToName = (m) => {
  const idx = ((m % 12) + 12) % 12;
  const oct = Math.floor(m / 12) - 1;
  return `${NOTE_NAMES[idx]}${oct}`;
};
function buildNoteOptions(fromOct = -1, toOct = 6) {
  const opts = [];
  for (let o = fromOct; o <= toOct; o++) {
    for (let i = 0; i < 12; i++) {
      const name = `${NOTE_NAMES[i]}${o}`;
      const midi = (o + 1) * 12 + i;
      opts.push({ name, midi });
    }
  }
  return opts;
}

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
      clock: { param: ctx.createGain().gain },
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

    // Internal sequencer
    this._seq = {
      steps: 16,
      rootMidi: 48,
      gatePct: 55,
      pattern: Array.from({ length: 16 }, () => ({ note: 0, octave: 1, gate: true, accent: false, slide: false })),
      pos: 0,
      transport: null,
    };
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

    // Sequencer controls
    const seqCtl = mk(`
      <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <span>Sequencer</span>
        <button class="btn" data-role="seq-expand">Expand</button>
      </label>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;align-items:center;">
        <div><small>Steps</small><input data-role="seq-steps" type="number" min="1" max="64" step="1" value="${this._seq.steps}"/></div>
        <div><small>Root MIDI</small><input data-role="seq-root" type="number" min="0" max="96" step="1" value="${this._seq.rootMidi}"/></div>
        <div><small>Gate %</small><input data-role="seq-gate" type="number" min="5" max="100" step="1" value="${this._seq.gatePct}"/></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
          <button class="btn" data-role="seq-clear">Clear</button>
          <button class="btn" data-role="seq-shift-left" title="Shift left">◀</button>
          <button class="btn" data-role="seq-shift-right" title="Shift right">▶</button>
          <button class="btn" data-role="seq-tr-down" title="Transpose -1">−1</button>
          <button class="btn" data-role="seq-tr-up" title="Transpose +1">+1</button>
          <button class="btn" data-role="seq-oct-down" title="Octave -1">Oct−</button>
          <button class="btn" data-role="seq-oct-up" title="Octave +1">Oct+</button>
          <button class="btn" data-role="seq-random" title="Randomize">Rnd</button>
        </div>
      </div>
      <div data-role="seq-grid" style="overflow:auto; max-height: 240px; border:1px solid #26305a; border-radius:6px; padding:6px; background:#0a0f2a; margin-top:6px;"></div>
    `);
    container.appendChild(seqCtl);

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

    // Bind sequencer controls
    const seqSteps = seqCtl.querySelector('[data-role=seq-steps]');
    const seqRoot = seqCtl.querySelector('[data-role=seq-root]');
    const seqGate = seqCtl.querySelector('[data-role=seq-gate]');
  const seqClear = seqCtl.querySelector('[data-role=seq-clear]');
  const seqShiftL = seqCtl.querySelector('[data-role=seq-shift-left]');
  const seqShiftR = seqCtl.querySelector('[data-role=seq-shift-right]');
  const seqTrDown = seqCtl.querySelector('[data-role=seq-tr-down]');
  const seqTrUp = seqCtl.querySelector('[data-role=seq-tr-up]');
  const seqOctDown = seqCtl.querySelector('[data-role=seq-oct-down]');
  const seqOctUp = seqCtl.querySelector('[data-role=seq-oct-up]');
  const seqRandom = seqCtl.querySelector('[data-role=seq-random]');
    const seqExpand = seqCtl.querySelector('[data-role=seq-expand]');
    this._seqGridEl = seqCtl.querySelector('[data-role=seq-grid]');
    const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
    seqSteps.addEventListener('input', () => { this._seq.steps = clamp(Number(seqSteps.value)||16,1,64); while (this._seq.pattern.length < this._seq.steps) this._seq.pattern.push({ note:0, octave:1, gate:true, accent:false, slide:false }); this._seq.pattern.length = this._seq.steps; this._renderSeqGrid(); });
  seqRoot.addEventListener('input', () => { this._seq.rootMidi = clamp(Number(seqRoot.value)||48, 0, 96); this._renderSeqGrid(); });
    seqGate.addEventListener('input', () => { this._seq.gatePct = clamp(Number(seqGate.value)||55, 5, 100); });
  seqClear.addEventListener('click', () => { this._seq.pattern.forEach(s => { s.gate=false; s.accent=false; s.slide=false; }); this._renderSeqGrid(); });
  seqShiftL?.addEventListener('click', () => { if (this._seq.pattern.length) this._seq.pattern.push(this._seq.pattern.shift()); this._renderSeqGrid(); });
  seqShiftR?.addEventListener('click', () => { if (this._seq.pattern.length) this._seq.pattern.unshift(this._seq.pattern.pop()); this._renderSeqGrid(); });
  const tr_ = (d) => { this._seq.pattern.forEach(s => { s.note = Math.max(-12, Math.min(12, (s.note||0)+d)); }); };
  const oc_ = (d) => { this._seq.pattern.forEach(s => { s.octave = Math.max(-3, Math.min(4, (s.octave||0)+d)); }); };
  seqTrDown?.addEventListener('click', () => { tr_(-1); this._renderSeqGrid(); });
  seqTrUp?.addEventListener('click', () => { tr_(+1); this._renderSeqGrid(); });
  seqOctDown?.addEventListener('click', () => { oc_(-1); this._renderSeqGrid(); });
  seqOctUp?.addEventListener('click', () => { oc_(+1); this._renderSeqGrid(); });
  seqRandom?.addEventListener('click', () => { this._seq.pattern.forEach(s => { s.gate = Math.random()<0.7; s.accent = Math.random()<0.25; s.slide = Math.random()<0.2; s.note = Math.max(-7, Math.min(7, (s.note||0) + Math.floor((Math.random()*3)-1))); s.octave = Math.max(0, Math.min(2, (s.octave||1) + (Math.random()<0.15 ? (Math.random()<0.5?-1:1) : 0))); }); this._renderSeqGrid(); });
    seqExpand.addEventListener('click', () => this._openSeqFullscreen());
    this._renderSeqGrid();
  }

  _renderSeqGrid() { this._renderSeqInline(this._seqGridEl); }

  _renderSeqInline(container) {
    if (!container) return;
    container.innerHTML = '';
    // Wrap and grid like normal Sequencer
    const wrap = document.createElement('div');
    wrap.className = 'seq-grid-wrap';
    const grid = document.createElement('div');
    grid.className = 'seq-grid';
    // layout width similar to normal sequencer
    grid.style.gridTemplateColumns = `repeat(${this._seq.steps}, 160px)`;
    wrap.appendChild(grid);
    container.appendChild(wrap);

  const opts = buildNoteOptions(-1, 6);
  const clampNote = (n) => Math.max(-7, Math.min(7, n|0));
  const clampOct = (o) => Math.max(0, Math.min(2, o|0));

    for (let i = 0; i < this._seq.steps; i++) {
      const st = this._seq.pattern[i];
      const cell = document.createElement('div');
      cell.className = 'seq-step';
      const absMidi = (this._seq.rootMidi|0) + (st.note||0) + (st.octave||0)*12;
      cell.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
          <small>Step ${i+1}</small>
          <div style="display:flex;gap:8px;align-items:center;font-size:11px;">
            <label style="display:flex;align-items:center;gap:4px;"><input data-role="gate" type="checkbox" ${st.gate?'checked':''}/> Gate</label>
          </div>
        </div>
        <select data-role="note" style="width:100%;margin-top:6px;background:#0d1330;color:#e6e8f0;border:1px solid #2a3468;border-radius:4px;padding:6px">
          ${opts.map(o => `<option value="${o.midi}" ${o.midi===absMidi?'selected':''}>${o.name}</option>`).join('')}
        </select>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap; margin-top:6px;">
          <label style="display:flex;align-items:center;gap:6px;"><input data-role="accent" type="checkbox" ${st.accent?'checked':''}><small>Acc</small></label>
          <label style="display:flex;align-items:center;gap:6px;"><input data-role="slide" type="checkbox" ${st.slide?'checked':''}><small>Slide</small></label>
        </div>
      `;
      const onGate = cell.querySelector('[data-role=gate]');
      const sel = cell.querySelector('[data-role=note]');
      const acc = cell.querySelector('[data-role=accent]');
      const sld = cell.querySelector('[data-role=slide]');
      onGate.addEventListener('input', () => { st.gate = onGate.checked; });
      acc.addEventListener('input', () => { st.accent = acc.checked; });
      sld.addEventListener('input', () => { st.slide = sld.checked; });
      sel.addEventListener('input', () => {
        const midi = Number(sel.value)||absMidi;
        const root = this._seq.rootMidi|0;
        const diff = midi - root;
        let best = { err: Infinity, oct: st.octave||1, note: st.note||0 };
        for (let oc = 0; oc <= 2; oc++) {
          let nt = diff - 12*oc;
          nt = clampNote(nt);
          const val = root + nt + 12*oc;
          const err = Math.abs(val - midi);
          if (err < best.err) best = { err, oct: oc, note: nt };
        }
        st.octave = best.oct;
        st.note = best.note;
      });
      grid.appendChild(cell);
    }
  }

  _renderSeqGridInto(container) {
    const g = container; if (!g) return; g.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:grid;grid-template-columns: 50px 70px 70px 70px 70px; gap:6px; align-items:center;';
    for (let i = 0; i < this._seq.steps; i++) {
      const st = this._seq.pattern[i];
      const row = document.createElement('div'); row.style.cssText = 'display:contents';
      row.innerHTML = `
        <div style="color:#8aa;">${String(i+1).padStart(2,'0')}</div>
        <div><small>Note</small><input data-k="note" type="number" min="-12" max="12" step="1" value="${st.note}"></div>
        <div><small>Oct</small><input data-k="octave" type="number" min="-3" max="4" step="1" value="${st.octave}"></div>
        <div style="display:flex;gap:8px;align-items:center;">
          <label style="display:flex;align-items:center;gap:4px;"><input data-k="gate" type="checkbox" ${st.gate?'checked':''}><small>Gate</small></label>
          <label style="display:flex;align-items:center;gap:4px;"><input data-k="accent" type="checkbox" ${st.accent?'checked':''}><small>Acc</small></label>
          <label style="display:flex;align-items:center;gap:4px;"><input data-k="slide" type="checkbox" ${st.slide?'checked':''}><small>Slide</small></label>
        </div>`;
      row.querySelectorAll('input').forEach(inp => { inp.addEventListener('input', () => { const k = inp.dataset.k; if (k==='note'||k==='octave') st[k]=Number(inp.value)||0; else st[k]=inp.checked; }); });
      wrap.appendChild(row);
    }
    g.appendChild(wrap);
  }

  _openSeqFullscreen() {
    // Create modal
    const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop';
    const panel = document.createElement('div'); panel.className = 'modal-panel';
    panel.innerHTML = `
      <div class="modal-header">
        <div class="title">TB-303 Sequencer – Fullscreen Editor</div>
        <button class="btn" data-role="close">Close</button>
      </div>
      <div class="modal-content"></div>
    `;
    backdrop.appendChild(panel);
    const content = panel.querySelector('.modal-content');
    const controls = document.createElement('div'); controls.className = 'control';
    controls.innerHTML = `
      <div style="display:grid;grid-template-columns: repeat(4, minmax(160px, 1fr)); gap:10px; align-items:center;">
        <div><small>Steps</small><input data-role="fs-steps" type="number" min="1" max="64" step="1" value="${this._seq.steps}" /></div>
        <div><small>Root MIDI</small><input data-role="fs-root" type="number" min="0" max="96" step="1" value="${this._seq.rootMidi}" /></div>
        <div><small>Gate %</small><input data-role="fs-gate" type="number" min="5" max="100" step="1" value="${this._seq.gatePct}" /></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn" data-role="fs-clear">Clear</button>
          <button class="btn" data-role="fs-shift-left" title="Shift left">Shift ◀</button>
          <button class="btn" data-role="fs-shift-right" title="Shift right">Shift ▶</button>
          <button class="btn" data-role="fs-transpose-down" title="Transpose -1">−1 st</button>
          <button class="btn" data-role="fs-transpose-up" title="Transpose +1">+1 st</button>
          <button class="btn" data-role="fs-oct-down" title="Octave -1">Oct −</button>
          <button class="btn" data-role="fs-oct-up" title="Octave +1">Oct +</button>
          <button class="btn" data-role="fs-random" title="Randomize">Random</button>
        </div>
      </div>
    `;
    const gridWrap = document.createElement('div'); gridWrap.className = 'control';
    gridWrap.innerHTML = `<div class="seq-grid-wrap" style="max-height:none;"><div data-role="fs-grid" style="overflow:auto; max-height: 100%; border:1px solid #26305a; border-radius:6px; padding:6px; background:#0a0f2a"></div></div>`;
    const fsGrid = gridWrap.querySelector('[data-role=fs-grid]');
    content.appendChild(controls);
    content.appendChild(gridWrap);
    document.body.appendChild(backdrop);

  const fsSteps = controls.querySelector('[data-role=fs-steps]');
  const fsRoot = controls.querySelector('[data-role=fs-root]');
  const fsGate = controls.querySelector('[data-role=fs-gate]');
  const fsClear = controls.querySelector('[data-role=fs-clear]');
  const fsShiftL = controls.querySelector('[data-role=fs-shift-left]');
  const fsShiftR = controls.querySelector('[data-role=fs-shift-right]');
  const fsTrDown = controls.querySelector('[data-role=fs-transpose-down]');
  const fsTrUp = controls.querySelector('[data-role=fs-transpose-up]');
  const fsOctDown = controls.querySelector('[data-role=fs-oct-down]');
  const fsOctUp = controls.querySelector('[data-role=fs-oct-up]');
  const fsRandom = controls.querySelector('[data-role=fs-random]');
  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  // Temporary placeholder; will be overwritten by render once view buttons are created
  let refresh = () => {};
  fsSteps.addEventListener('input', () => { this._seq.steps = clamp(Number(fsSteps.value)||16,1,64); while (this._seq.pattern.length < this._seq.steps) this._seq.pattern.push({ note:0, octave:1, gate:true, accent:false, slide:false }); this._seq.pattern.length = this._seq.steps; refresh(); });
  fsRoot.addEventListener('input', () => { this._seq.rootMidi = clamp(Number(fsRoot.value)||48, 0, 96); });
  fsGate.addEventListener('input', () => { this._seq.gatePct = clamp(Number(fsGate.value)||55, 5, 100); });
  fsClear.addEventListener('click', () => { this._seq.pattern.forEach(s => { s.gate=false; s.accent=false; s.slide=false; }); refresh(); });
  fsShiftL.addEventListener('click', () => { if (this._seq.pattern.length) this._seq.pattern.push(this._seq.pattern.shift()); refresh(); });
  fsShiftR.addEventListener('click', () => { if (this._seq.pattern.length) this._seq.pattern.unshift(this._seq.pattern.pop()); refresh(); });
    const tr = (d) => { this._seq.pattern.forEach(s => { s.note = Math.max(-12, Math.min(12, (s.note||0) + d)); }); };
    const oc = (d) => { this._seq.pattern.forEach(s => { s.octave = Math.max(-3, Math.min(4, (s.octave||0) + d)); }); };
  fsTrDown.addEventListener('click', () => { tr(-1); refresh(); });
  fsTrUp.addEventListener('click', () => { tr(+1); refresh(); });
  fsOctDown.addEventListener('click', () => { oc(-1); refresh(); });
  fsOctUp.addEventListener('click', () => { oc(+1); refresh(); });
    fsRandom.addEventListener('click', () => {
      this._seq.pattern.forEach((s,i) => {
        s.gate = Math.random() < 0.7;
        s.accent = Math.random() < 0.25;
        s.slide = Math.random() < 0.2;
        s.note = Math.max(-7, Math.min(7, (s.note||0) + Math.floor((Math.random()*3)-1)));
        s.octave = Math.max(0, Math.min(2, (s.octave||1) + (Math.random()<0.15 ? (Math.random()<0.5?-1:1) : 0)));
      });
  refresh();
    });

    // Close handlers
    const close = () => { backdrop.remove(); this._renderSeqGrid(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    panel.querySelector('[data-role=close]')?.addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey);

    // View toggle and renderers
    this._fsMode = this._fsMode || 'classic';
    const viewToggle = document.createElement('div'); viewToggle.className = 'control';
    viewToggle.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;">
        <small>View:</small>
        <button class="btn ${this._fsMode==='classic'?'active':''}" data-role="view-classic">Classic</button>
        <button class="btn ${this._fsMode==='quick'?'active':''}" data-role="view-quick">Quick Edit</button>
      </div>`;
    content.insertBefore(viewToggle, gridWrap);
    const btnClassic = viewToggle.querySelector('[data-role=view-classic]');
    const btnQuick = viewToggle.querySelector('[data-role=view-quick]');
  const render = () => {
      fsGrid.innerHTML = '';
      if (this._fsMode === 'classic') this._renderSeqClassic(fsGrid); else this._renderSeqQuick(fsGrid);
    };
  refresh = render;
    const setMode = (m) => { this._fsMode = m; btnClassic.classList.toggle('active', m==='classic'); btnQuick.classList.toggle('active', m==='quick'); render(); };
    btnClassic.addEventListener('click', () => setMode('classic'));
    btnQuick.addEventListener('click', () => setMode('quick'));

    // Initial render
    render();
  }

  _auditionHz(hz, accent=false) {
    const t = this.audioCtx.currentTime + 0.01;
    this._setPitchAt(t, hz, false);
    this._triggerEnvelopeAt(t, !!accent);
    this._setGateAt(t, true);
    this._setGateAt(t + 0.18, false);
  }

  _renderSeqClassic(container) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:grid;grid-template-columns: 44px 90px 100px 1fr; gap:8px; align-items:center;';
    for (let i = 0; i < this._seq.steps; i++) {
      const st = this._seq.pattern[i];
      const row = document.createElement('div'); row.style.cssText = 'display:contents';
      const playBtn = `<button class="btn" data-k="play" title="Audition">▶</button>`;
      row.innerHTML = `
        <div style="color:#8aa;">${String(i+1).padStart(2,'0')}</div>
        <div style="display:flex;gap:4px;align-items:center;">
          <button class="btn" data-k="note-dec" title="−1 st">−</button>
          <div style="min-width:2ch;text-align:center;">${st.note|0}</div>
          <button class="btn" data-k="note-inc" title="+1 st">+</button>
        </div>
        <div style="display:flex;gap:4px;align-items:center;">
          <button class="btn" data-k="oct-dec" title="Oct −">−</button>
          <div style="min-width:2ch;text-align:center;">${st.octave|0}</div>
          <button class="btn" data-k="oct-inc" title="Oct +">+</button>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:6px;"><input data-k="gate" type="checkbox" ${st.gate?'checked':''}><small>Gate</small></label>
          <label style="display:flex;align-items:center;gap:6px;"><input data-k="accent" type="checkbox" ${st.accent?'checked':''}><small>Acc</small></label>
          <label style="display:flex;align-items:center;gap:6px;"><input data-k="slide" type="checkbox" ${st.slide?'checked':''}><small>Slide</small></label>
          ${playBtn}
        </div>`;
      row.querySelector('[data-k=note-dec]')?.addEventListener('click', () => { st.note = Math.max(-12,(st.note||0)-1); row.children[1].children[1].textContent = st.note|0; });
      row.querySelector('[data-k=note-inc]')?.addEventListener('click', () => { st.note = Math.min(12,(st.note||0)+1); row.children[1].children[1].textContent = st.note|0; });
      row.querySelector('[data-k=oct-dec]')?.addEventListener('click', () => { st.octave = Math.max(-3,(st.octave||0)-1); row.children[2].children[1].textContent = st.octave|0; });
      row.querySelector('[data-k=oct-inc]')?.addEventListener('click', () => { st.octave = Math.min(4,(st.octave||0)+1); row.children[2].children[1].textContent = st.octave|0; });
        row.querySelector('[data-k=play]')?.addEventListener('click', () => {
          const midiNow = (this._seq.rootMidi|0) + (st.note||0) + (st.octave||0)*12;
          this._auditionHz(midiToHz(midiNow), !!st.accent);
        });
      row.querySelectorAll('input').forEach(inp => { inp.addEventListener('input', () => { const k = inp.dataset.k; st[k] = inp.checked; }); });
      wrap.appendChild(row);
    }
    container.appendChild(wrap);
  }

  _renderSeqQuick(container) {
    // Simple quick view: compact cards per step with toggles and small note/oct labels editable by wheel
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap:10px;';
    const mkCard = (i, st) => {
      const c = document.createElement('div');
      c.style.cssText = 'border:1px solid #26305a;border-radius:8px;padding:8px;background:#0c1233;display:grid;gap:6px;';
      c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;color:#8aa;"><span>#${String(i+1).padStart(2,'0')}</span><button class="btn" data-k="play">▶</button></div>
        <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;">
          <div><small>Note</small><div data-k="note" style="padding:2px 6px;border:1px solid #334; border-radius:4px; min-width:2ch; text-align:center;">${st.note|0}</div></div>
          <div><small>Oct</small><div data-k="oct" style="padding:2px 6px;border:1px solid #334; border-radius:4px; min-width:2ch; text-align:center;">${st.octave|0}</div></div>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:6px;"><input data-k="gate" type="checkbox" ${st.gate?'checked':''}><small>Gate</small></label>
          <label style="display:flex;align-items:center;gap:6px;"><input data-k="accent" type="checkbox" ${st.accent?'checked':''}><small>Acc</small></label>
          <label style="display:flex;align-items:center;gap:6px;"><input data-k="slide" type="checkbox" ${st.slide?'checked':''}><small>Slide</small></label>
        </div>`;
      c.querySelector('[data-k=play]')?.addEventListener('click', () => {
        const midiNow = (this._seq.rootMidi|0) + (st.note||0) + (st.octave||0)*12;
        this._auditionHz(midiToHz(midiNow), !!st.accent);
      });
      const noteEl = c.querySelector('[data-k=note]');
      const octEl = c.querySelector('[data-k=oct]');
      const wheel = (e, key, el, min, max) => { e.preventDefault(); const d = e.deltaY < 0 ? 1 : -1; st[key] = Math.max(min, Math.min(max, (st[key]||0) + d)); el.textContent = st[key]|0; };
      noteEl.addEventListener('wheel', (e) => wheel(e, 'note', noteEl, -12, 12), { passive: false });
      octEl.addEventListener('wheel', (e) => wheel(e, 'octave', octEl, -3, 4), { passive: false });
      c.querySelectorAll('input').forEach(inp => { inp.addEventListener('input', () => { const k = inp.dataset.k; st[k] = inp.checked; }); });
      return c;
    };
    for (let i = 0; i < this._seq.steps; i++) grid.appendChild(mkCard(i, this._seq.pattern[i]));
    container.appendChild(grid);
  }

  onParamConnected(portName, fromModuleId, fromPortName) {
    const src = this.getModuleById?.(fromModuleId);
    if (portName === 'clock' && fromPortName === 'clock' && src?.subscribeClock) {
      src.subscribeClock(this.id, (evt) => this._onTick(evt));
      this._seq.transport = src;
      return;
    }
    if (src?.subscribePitch) this._extPitchSub = src.subscribePitch(this.id, (hz, active) => { if (typeof hz === 'number') this._setPitch(hz, false); if (typeof active === 'boolean') this._setGate(active); });
    if (src?.subscribeGate) this._extGateSub = src.subscribeGate(this.id, (state) => this._setGate(state === 'on'));
  }
  onParamDisconnected(portName, fromModuleId) {
    const src = this.getModuleById?.(fromModuleId);
    if (portName === 'clock' && src?.unsubscribeClock) { src.unsubscribeClock(this.id); if (this._seq.transport===src) this._seq.transport=null; }
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

  _triggerEnvelopeAt(time, accent) {
    const t = time;
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

  _setGateAt(time, on) {
    const t = time;
    if (on) {
      if (this._vca.gain.value < 0.0001) this._vca.gain.setValueAtTime(0.0001, t);
    } else {
      this._vca.gain.cancelScheduledValues(t);
      this._vca.gain.setTargetAtTime(0.0001, t, 0.02);
    }
  }

  _setPitchAt(time, hz, slide) {
    const t = time;
    const target = Math.max(1, hz);
    const f = this._osc.frequency;
    f.cancelScheduledValues(t);
    if (slide) f.setTargetAtTime(target, t, Math.max(0.001, clamp(this._base.slideTime, 0, 0.5) / 3));
    else f.setValueAtTime(target, t);
  }

  _onTick(evt) {
    const step = this._seq.pos % Math.max(1, this._seq.steps);
    const st = this._seq.pattern[step];
    const midi = (this._seq.rootMidi|0) + (st.note||0) + (st.octave||0)*12;
    const hz = midiToHz(midi);
    const bpm = evt?.bpm || this._seq.transport?.bpm || 120;
    const t = evt?.time ?? this.audioCtx.currentTime;
    const secPer16 = 60 / bpm / 4;
    const gatePct = Math.max(0.05, Math.min(1, (this._seq.gatePct||55)/100));

    // schedule
    this._setPitchAt(t, hz, !!st.slide);
    if (st.gate) {
      const retrig = !(this._lastSlide && st.slide);
      if (retrig) this._triggerEnvelopeAt(t, !!st.accent);
      this._setGateAt(t, true);
      this._setGateAt(t + secPer16 * gatePct, false);
    } else {
      this._setGateAt(t, false);
    }
    this._lastSlide = !!st.slide;
    this._seq.pos = (this._seq.pos + 1) % Math.max(1, this._seq.steps);
  }

  toJSON() {
    return { ...this._base, sequencer: { steps: this._seq.steps, rootMidi: this._seq.rootMidi, gatePct: this._seq.gatePct, pattern: this._seq.pattern } };
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
    if (state.sequencer) {
      const s = state.sequencer;
      if (typeof s.steps==='number') this._seq.steps = Math.max(1, Math.min(64, s.steps|0));
      if (typeof s.rootMidi==='number') this._seq.rootMidi = Math.max(0, Math.min(96, s.rootMidi|0));
      if (typeof s.gatePct==='number') this._seq.gatePct = Math.max(5, Math.min(100, s.gatePct|0));
      if (Array.isArray(s.pattern)) this._seq.pattern = s.pattern.slice(0, this._seq.steps);
      this._renderSeqGrid?.();
    }
  }
}
