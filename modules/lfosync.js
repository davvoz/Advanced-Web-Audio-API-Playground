import { Module } from './module.js';

// LFO synchronized to Transport: connect Transport.clock to 'clock' input to phase-reset and follow BPM
export class LFOSyncModule extends Module {
  get title() { return 'LFO Sync'; }

  buildAudio() {
    const ctx = this.audioCtx;
    // Core LFO chain: oscillator -> scale -> offset (ConstantSource offset)
    this.osc = ctx.createOscillator();
    this.osc.type = 'sine';
    this.scale = ctx.createGain();
    this.scale.gain.value = 50; // depth
    this.offset = ctx.createConstantSource();
    this.offset.offset.value = 0; // DC offset
    this.osc.connect(this.scale);
    this.scale.connect(this.offset.offset);
    this.offset.start();
    try { this.osc.start(); } catch {}

    this.outputs = { out: { node: this.offset } };
    // Inputs: depth, offset like LFO; 'clock' is dummy to latch transport reference
    this._clockIn = ctx.createGain(); this._clockIn.gain.value = 0;
    this.inputs = {
      clock: { param: this._clockIn.gain },
      depth: { param: this.scale.gain },
      offset: { param: this.offset.offset },
    };

    // Sync state
    this._transport = null;
    this._subId = null;
    this._tickCount = 0; // 16th ticks
    this._beatsPerCycle = 1; // default 1 cycle per beat
    this._resetMode = 'cycle'; // 'off' | 'beat' | 'cycle'
    this._division = '1/4'; // musical division label
    this._updateDivision(this._division);
    this._updateFrequency();
  }

  // Map musical division to cyclesPerBeat
  _divisionMap(label) {
    switch(label) {
      case '4 bars': return 1/16; // one cycle every 16 beats
      case '2 bars': return 1/8;
      case '1 bar': return 1/4;
      case '1/2': return 1/2;
      case '1/4': return 1; // one cycle per beat
      case '1/8': return 2;
      case '1/16': return 4;
      default: return 1; // fall back to 1/4 note
    }
  }

  _updateDivision(label) {
    this._division = label;
    const cpb = this._divisionMap(label);
    this._cyclesPerBeat = cpb;
    this._beatsPerCycle = 1 / cpb;
    this._updateFrequency();
  }

  _currentBpm() {
    // Use connected transport BPM if available; else default 120
    return this._transport?.bpm ?? 120;
  }

  _updateFrequency() {
    const bpm = this._currentBpm();
    const freq = (bpm / 60) * (this._cyclesPerBeat || 1);
    this.osc.frequency.setTargetAtTime(freq, this.audioCtx.currentTime, 0.01);
  }

  _resetOscillator() {
    // Recreate oscillator to reset phase cleanly
    const ctx = this.audioCtx;
    const old = this.osc;
    const type = old.type;
    const freq = old.frequency.value;
    try { old.disconnect(); } catch {}
    try { old.stop(); } catch {}
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(this.scale);
    try { osc.start(); } catch {}
    this.osc = osc;
  }

  onParamConnected(portName, fromModuleId, fromPortName) {
    if (portName === 'clock' && fromPortName === 'clock') {
      const src = this.getModuleById?.(fromModuleId);
      if (src?.subscribeClock) {
        this._transport = src;
        this._subId = this.id + ':lfo-sync';
        // Reset counters and phase on next beat
        this._tickCount = 0; this._beatAcc = 0; this._resetOscillator(); this._updateFrequency();
        src.subscribeClock(this._subId, () => {
          // Called every 16th
          this._tickCount = (this._tickCount + 1) % (src.ppqn || 4);
          // every 4 ticks is a beat (with ppqn=4)
          if (this._tickCount === 0) {
            // beat boundary
            this._beatAcc = (this._beatAcc || 0) + 1;
            this._updateFrequency(); // follow live BPM changes
            if (this._resetMode === 'beat') {
              this._resetOscillator();
            } else if (this._resetMode === 'cycle') {
              if (this._beatAcc >= (this._beatsPerCycle || 1)) {
                this._beatAcc = 0;
                this._resetOscillator();
              }
            }
          }
        });
      }
    }
  }

  onParamDisconnected(portName, fromModuleId, fromPortName) {
    if (portName === 'clock' && fromPortName === 'clock') {
      const src = this.getModuleById?.(fromModuleId);
      if (src?.unsubscribeClock && this._subId) src.unsubscribeClock(this._subId);
      this._subId = null; this._transport = null; this._tickCount = 0;
    }
  }

  buildControls(container) {
    // Waveform
    const waveCtl = document.createElement('div');
    waveCtl.className = 'control';
    waveCtl.innerHTML = `
      <label>Waveform</label>
      <select>
        <option value="sine">Sine</option>
        <option value="triangle">Triangle</option>
        <option value="sawtooth">Sawtooth</option>
        <option value="square">Square</option>
      </select>
    `;
    const waveSel = waveCtl.querySelector('select');
    waveSel.value = this.osc.type || 'sine';
    waveSel.addEventListener('change', () => { this.osc.type = waveSel.value; });

    // Division
    const divCtl = document.createElement('div');
    divCtl.className = 'control';
    divCtl.innerHTML = `
      <label>Division</label>
      <select>
        <option>4 bars</option>
        <option>2 bars</option>
        <option>1 bar</option>
        <option>1/2</option>
        <option selected>1/4</option>
        <option>1/8</option>
        <option>1/16</option>
      </select>
    `;
    const divSel = divCtl.querySelector('select');
    divSel.addEventListener('change', () => { this._updateDivision(divSel.value); });

    // Reset mode
    const resetCtl = document.createElement('div');
    resetCtl.className = 'control';
    resetCtl.innerHTML = `
      <label>Reset</label>
      <select>
        <option value="off">Off</option>
        <option value="beat">Beat</option>
        <option value="cycle" selected>Cycle</option>
      </select>
    `;
    const resetSel = resetCtl.querySelector('select');
    resetSel.addEventListener('change', () => { this._resetMode = resetSel.value; });

    // Depth/Offset controls
    const depthCtl = document.createElement('div');
    depthCtl.className = 'control';
    depthCtl.innerHTML = `
      <label>Depth</label>
      <input type="range" min="0" max="2000" step="1" value="50" />
    `;
    const depth = depthCtl.querySelector('input');
    depth.addEventListener('input', () => this.scale.gain.setTargetAtTime(Number(depth.value), this.audioCtx.currentTime, 0.01));

    const offsetCtl = document.createElement('div');
    offsetCtl.className = 'control';
    offsetCtl.innerHTML = `
      <label>Offset</label>
      <input type="range" min="-1000" max="1000" step="1" value="0" />
    `;
    const offs = offsetCtl.querySelector('input');
    offs.addEventListener('input', () => this.offset.offset.setTargetAtTime(Number(offs.value), this.audioCtx.currentTime, 0.01));

    container.appendChild(waveCtl);
    container.appendChild(divCtl);
    container.appendChild(resetCtl);
    container.appendChild(depthCtl);
    container.appendChild(offsetCtl);

    this._ui = { waveSel, divSel, resetSel, depth, offs };
  }

  toJSON() {
    return {
      type: this.osc.type,
      division: this._division,
      reset: this._resetMode,
      depth: this.scale.gain.value,
      offset: this.offset.offset.value,
    };
  }
  fromJSON(state) {
    if (!state) return;
    if (typeof state.type === 'string') { this.osc.type = state.type; this._ui?.waveSel && (this._ui.waveSel.value = state.type); }
    if (typeof state.division === 'string') { this._updateDivision(state.division); this._ui?.divSel && (this._ui.divSel.value = state.division); }
    if (typeof state.reset === 'string') { this._resetMode = state.reset; this._ui?.resetSel && (this._ui.resetSel.value = state.reset); }
    if (typeof state.depth === 'number') { this.scale.gain.value = state.depth; this._ui?.depth && (this._ui.depth.value = String(state.depth)); }
    if (typeof state.offset === 'number') { this.offset.offset.value = state.offset; this._ui?.offs && (this._ui.offs.value = String(state.offset)); }
    this._updateFrequency();
  }

  dispose() {
    try { this.osc?.disconnect(); this.scale?.disconnect(); this.offset?.disconnect(); } catch {}
    super.dispose?.();
  }
}
