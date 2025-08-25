import { Module } from './module.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class TB303SequencerModule extends Module {
  get title() { return 'TB-303 Seq'; }

  buildAudio() {
    const ctx = this.audioCtx;
    this._pitchOut = ctx.createConstantSource(); this._pitchOut.offset.value = 440; this._pitchOut.start();
    this._gateOut = ctx.createConstantSource(); this._gateOut.offset.value = 0; this._gateOut.start();
    this.outputs = { pitch: { node: this._pitchOut }, gate: { node: this._gateOut } };
    this.inputs = { clock: { param: ctx.createGain().gain }, bpm: { param: ctx.createGain().gain } };

    this._transport = null; this._tick = 0; this._pos = 0;
    this._steps = 16; this._rootMidi = 48; this._gatePct = 50;
    this._pattern = Array.from({ length: this._steps }, () => ({ note: 0, octave: 1, gate: true, accent: false, slide: false }));
    this._subs = new Map();
  }

  buildControls(container) {
    this.root.classList.add('module-tb303-seq');
    const head = document.createElement('div'); head.className = 'control';
  head.innerHTML = `
      <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <span>Pattern</span>
        <button class="btn" data-role="expand">Expand</button>
      </label>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;align-items:center;">
        <div><small>Steps</small><input data-role="steps" type="number" min="1" max="128" step="1" value="${this._steps}"/></div>
    <div><small>Root MIDI</small><input data-role="root" type="number" min="0" max="96" step="1" value="${this._rootMidi}"/></div>
        <div><small>Gate %</small><input data-role="gatepct" type="number" min="5" max="100" step="1" value="${this._gatePct}"/></div>
        <button class="btn" data-role="clear">Clear</button>
      </div>`;
    container.appendChild(head);
    const stepsEl = head.querySelector('[data-role=steps]');
    const rootEl = head.querySelector('[data-role=root]');
    this._gatePctEl = head.querySelector('[data-role=gatepct]');
    head.querySelector('[data-role=clear]').addEventListener('click', () => { this._pattern.forEach(s => { s.gate=false; s.accent=false; s.slide=false; }); this._renderGrid(); });
  stepsEl.addEventListener('input', () => { this._steps = clamp(Number(stepsEl.value)||1,1,128); while (this._pattern.length < this._steps) this._pattern.push({ note:0, octave:1, gate:true, accent:false, slide:false }); this._pattern.length = this._steps; this._renderGrid(); });
  rootEl.addEventListener('input', () => { this._rootMidi = clamp(Number(rootEl.value)||48, 0, 96); });

    const grid = document.createElement('div'); grid.className = 'control';
    grid.innerHTML = `<label>Steps</label><div data-role="grid" style="overflow:auto; max-height: 220px; border:1px solid #26305a; border-radius:6px; padding:6px; background:#0a0f2a"></div>`;
    container.appendChild(grid);
    this._gridEl = grid.querySelector('[data-role=grid]');
    this._renderGrid();

    head.querySelector('[data-role=expand]')?.addEventListener('click', () => this._openFullscreenEditor());
  }

  _openFullscreenEditor() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const panel = document.createElement('div');
    panel.className = 'modal-panel';
    panel.innerHTML = `
      <div class="modal-header">
        <div class="title">TB-303 Sequencer – Fullscreen Editor</div>
        <button class="btn" data-role="close">Close</button>
      </div>
      <div class="modal-content"></div>
    `;
    const content = panel.querySelector('.modal-content');
    const controls = document.createElement('div');
    controls.className = 'control';
    controls.innerHTML = `
      <div style="display:grid;grid-template-columns: repeat(4, minmax(160px, 1fr)); gap:10px; align-items:center;">
        <div><small>Steps</small><input data-role="fs-steps" type="number" min="1" max="128" step="1" value="${this._steps}" /></div>
        <div><small>Root MIDI</small><input data-role="fs-root" type="number" min="0" max="96" step="1" value="${this._rootMidi}" /></div>
        <div><small>Gate %</small><input data-role="fs-gatepct" type="number" min="5" max="100" step="1" value="${this._gatePct}" /></div>
        <div><button class="btn" data-role="fs-clear">Clear</button></div>
      </div>
    `;
    const gridWrap = document.createElement('div');
    gridWrap.className = 'control';
    gridWrap.innerHTML = `<div class="seq-grid-wrap" style="max-height:none;"><div data-role="fs-grid" style="overflow:auto; max-height: 100%; border:1px solid #26305a; border-radius:6px; padding:6px; background:#0a0f2a"></div></div>`;
    const fsGrid = gridWrap.querySelector('[data-role=fs-grid]');

    content.appendChild(controls);
    content.appendChild(gridWrap);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
  panel.querySelector('[data-role=close]')?.addEventListener('click', () => { backdrop.remove(); this._renderGrid(); });

    // Bind
    const fsSteps = controls.querySelector('[data-role=fs-steps]');
    const fsRoot = controls.querySelector('[data-role=fs-root]');
    const fsGate = controls.querySelector('[data-role=fs-gatepct]');
    const fsClear = controls.querySelector('[data-role=fs-clear]');
    fsSteps.addEventListener('input', () => { this._steps = clamp(Number(fsSteps.value)||1,1,128); while (this._pattern.length < this._steps) this._pattern.push({ note:0, octave:1, gate:true, accent:false, slide:false }); this._pattern.length = this._steps; this._renderGridInto(fsGrid); });
    fsRoot.addEventListener('input', () => { this._rootMidi = clamp(Number(fsRoot.value)||48,0,96); });
    fsGate.addEventListener('input', () => { this._gatePct = clamp(Number(fsGate.value)||50,5,100); if (this._gatePctEl) this._gatePctEl.value = String(this._gatePct); });
    fsClear.addEventListener('click', () => { this._pattern.forEach(s => { s.gate=false; s.accent=false; s.slide=false; }); this._renderGridInto(fsGrid); });

    this._renderGridInto(fsGrid);
  }

  _renderGridInto(container) {
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < this._steps; i++) {
      const st = this._pattern[i];
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns: 60px 100px 100px 1fr; gap:10px; align-items:center; margin-bottom:6px;';
      row.innerHTML = `
        <div style="color:#8aa;">${String(i+1).padStart(2,'0')}</div>
        <div><small>Note</small><input data-k="note" type="number" min="-12" max="12" step="1" value="${st.note}"></div>
        <div><small>Oct</small><input data-k="octave" type="number" min="-3" max="4" step="1" value="${st.octave}"></div>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:6px;"><input data-k="gate" type="checkbox" ${st.gate?'checked':''}><small>Gate</small></label>
          <label style="display:flex;align-items:center;gap:6px;"><input data-k="accent" type="checkbox" ${st.accent?'checked':''}><small>Acc</small></label>
          <label style="display:flex;align-items:center;gap:6px;"><input data-k="slide" type="checkbox" ${st.slide?'checked':''}><small>Slide</small></label>
        </div>`;
      row.querySelectorAll('input').forEach(inp => { inp.addEventListener('input', () => { const k = inp.dataset.k; if (k==='note'||k==='octave') st[k]=Number(inp.value)||0; else st[k]=inp.checked; }); });
      container.appendChild(row);
    }
  }

  _renderGrid() {
    if (!this._gridEl) return;
    this._gridEl.innerHTML = '';
    for (let i = 0; i < this._steps; i++) {
      const st = this._pattern[i];
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns: 50px 70px 70px 70px 70px; gap:6px; align-items:center; margin-bottom:4px;';
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
      this._gridEl.appendChild(row);
    }
  }

  onParamConnected(portName, fromModuleId, fromPortName) {
    const src = this.getModuleById?.(fromModuleId);
    if (portName === 'clock' && fromPortName === 'clock' && src?.subscribeClock) {
      // receive precise audio-time ticks
      src.subscribeClock(this.id, (evt) => this._onTick(evt));
      this._transport = src;
    }
  }
  onParamDisconnected(portName, fromModuleId, fromPortName) {
    const src = this.getModuleById?.(fromModuleId);
    if (portName === 'clock' && fromPortName === 'clock' && src?.unsubscribeClock) { src.unsubscribeClock(this.id); if (this._transport===src) this._transport=null; }
  }

  _onTick(evt) {
    this._tick = (this._tick + 1) % 4096;
    // 1 tick = 1/16th
    const st = this._pattern[this._pos % Math.max(1, this._steps)];
    const midi = this._rootMidi + (st.note||0) + (st.octave||0)*12;
    const hz = midiToHz(midi);
    const bpm = evt?.bpm || this._transport?.bpm || 120;
    const t = evt?.time ?? this.audioCtx.currentTime;
    const secPer16 = 60 / bpm / 4;
    const gatePct = clamp(Number(this._gatePctEl?.value)||50, 5, 100) / 100;

    // notify 303 listeners with precise time
    const msg = { type:'note', time: t, step:this._pos, midi, hz, accent:!!st.accent, slide:!!st.slide, gate:!!st.gate };
    this._subs.forEach(cb => { try{ cb(msg); } catch{} });

    // legacy outs (scheduled)
    this._pitchOut.offset.cancelScheduledValues(t);
    this._pitchOut.offset.setTargetAtTime(hz, t, 0.005);
    this._gateOut.offset.cancelScheduledValues(t);
    if (st.gate) {
      this._gateOut.offset.setValueAtTime(1, t);
      this._gateOut.offset.setValueAtTime(0, t + secPer16 * gatePct);
      this._subs.forEach(cb => { try{ cb({ type:'gate', time: t, state:'on' }); } catch{} });
      this._subs.forEach(cb => { try{ cb({ type:'gate', time: t + secPer16 * gatePct, state:'off' }); } catch{} });
    } else {
      this._gateOut.offset.setValueAtTime(0, t);
      this._subs.forEach(cb => { try{ cb({ type:'gate', time: t, state:'off' }); } catch{} });
    }
    this._pos = (this._pos + 1) % Math.max(1, this._steps);
  }

  subscribeTB303Note(id, cb) { this._subs.set(id, cb); }
  unsubscribeTB303Note(id) { this._subs.delete(id); }

  toJSON() { return { steps: this._steps, rootMidi: this._rootMidi, pattern: this._pattern, gatePct: Number(this._gatePctEl?.value)||50 }; }
  fromJSON(state) {
    if (!state) return;
    if (typeof state.steps==='number') this._steps = clamp(state.steps,1,128);
    // allow much lower roots now
    if (typeof state.rootMidi==='number') this._rootMidi = clamp(state.rootMidi,0,96);
    if (Array.isArray(state.pattern)) this._pattern = state.pattern.slice(0, this._steps);
    if (this._gatePctEl && typeof state.gatePct==='number') this._gatePctEl.value = String(clamp(state.gatePct,5,100));
    this._renderGrid();
  }
}
