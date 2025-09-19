import { Module } from './module.js';

export class TransportModule extends Module {
  get title() { return 'Transport'; }

  buildAudio() {
    const ctx = this.audioCtx;
  // State
  this.bpm = 120;
  this.ppqn = 4; // 16th
  this.running = false;

  // Outputs as ConstantSource for easy connection to params
  this.clock = ctx.createConstantSource(); // pulse 0/1 (for visuals)
  this.clock.offset.value = 0; this.clock.start();
  this.beat = ctx.createConstantSource(); // 1 on beat, else 0
  this.beat.offset.value = 0; this.beat.start();
  this.bpmOut = ctx.createConstantSource(); // emits BPM as value
  this.bpmOut.offset.value = this.bpm; this.bpmOut.start();

  this.outputs = { clock: { node: this.clock }, beat: { node: this.beat }, bpm: { node: this.bpmOut } };
  this.inputs = { bpm: { param: this.bpmOut.offset }, run: { param: null } };

  // Subscribers and scheduler
  this._subs = new Map(); // id -> (evt) => void
  this._animationId = null;
  this._nextTickTime = 0;
  this._tickIndex = 0;
  this._scheduleAheadSec = 0.1;  // how far ahead to schedule
  this._lastScheduleTime = 0;    // track last schedule to avoid excessive calls
  this._minScheduleInterval = 20; // minimum ms between schedule calls
  
  // UI throttling detection
  this._isUIBusy = false;
  this._uiBusyTimeout = null;
  }

  buildControls(container) {
    const transport = document.createElement('div');
    transport.className = 'control';
    transport.innerHTML = `
      <label>Transport</label>
      <div style="display:flex;gap:6px;align-items:center;">
        <button class="btn" data-role="start">Start</button>
        <button class="btn" data-role="stop">Stop</button>
    <button class="btn" data-role="reset" title="Reset time / resync">Reset</button>
      </div>
    `;
    const startBtn = transport.querySelector('[data-role=start]');
    const stopBtn = transport.querySelector('[data-role=stop]');
  const resetBtn = transport.querySelector('[data-role=reset]');
    startBtn.addEventListener('click', () => this.start());
    stopBtn.addEventListener('click', () => this.stop());
  resetBtn.addEventListener('click', () => this.reset());

    const tempoCtl = document.createElement('div');
    tempoCtl.className = 'control';
    tempoCtl.innerHTML = `
      <label>Tempo (BPM)</label>
      <input type="range" min="40" max="240" step="1" value="120" />
      <input type="number" min="40" max="240" step="1" value="120" />
    `;
    const r = tempoCtl.querySelector('input[type=range]');
    const n = tempoCtl.querySelector('input[type=number]');
    const syncTempo = (v) => { this.bpm = Number(v); r.value = v; n.value = v; this.bpmOut.offset.setValueAtTime(this.bpm, this.audioCtx.currentTime); };
    r.addEventListener('input', () => syncTempo(r.value));
    n.addEventListener('input', () => syncTempo(n.value));

    container.appendChild(transport);
    container.appendChild(tempoCtl);
  }

  _scheduler() {
    if (!this.running) return;
    
    const now = performance.now();
    const timeSinceLastSchedule = now - this._lastScheduleTime;
    
    // Throttle scheduling during intensive UI interactions
    if (this._isUIBusy && timeSinceLastSchedule < this._minScheduleInterval * 2) {
      this._scheduleNext();
      return;
    }
    
    // Only schedule if enough time has passed (avoid excessive scheduling)
    if (timeSinceLastSchedule < this._minScheduleInterval) {
      this._scheduleNext();
      return;
    }
    
    this._lastScheduleTime = now;
    
    const ctx = this.audioCtx;
    const spb = 60 / this.bpm;
    const secPerTick = spb / this.ppqn; // 16th
    const ahead = ctx.currentTime + this._scheduleAheadSec;

    while (this._nextTickTime < ahead) {
      // Schedule visual pulses (clock/beat) at the exact time
      const t = this._nextTickTime;
      this.clock.offset.setValueAtTime(1, t);
      this.clock.offset.setValueAtTime(0, t + 0.002);
      if (this._tickIndex % this.ppqn === 0) {
        this.beat.offset.setValueAtTime(1, t);
        this.beat.offset.setValueAtTime(0, t + 0.005);
      }
      // Notify subscribers with timing info
      const evt = { time: t, bpm: this.bpm, ppqn: this.ppqn, tick: this._tickIndex };
      this._subs.forEach(cb => { try { cb(evt); } catch {} });

      this._tickIndex += 1;
      this._nextTickTime += secPerTick;
    }
    
    this._scheduleNext();
  }

  _scheduleNext() {
    if (this.running) {
      this._animationId = requestAnimationFrame(() => this._scheduler());
    }
  }

  _setUIBusy(busy) {
    this._isUIBusy = busy;
    if (this._uiBusyTimeout) clearTimeout(this._uiBusyTimeout);
    if (busy) {
      // Auto-clear UI busy flag after a short delay
      this._uiBusyTimeout = setTimeout(() => {
        this._isUIBusy = false;
      }, 100);
    }
  }

  start() {
  if (this.running) return;
  this.running = true;
  const now = this.audioCtx.currentTime;
  this._tickIndex = 0;
  this._nextTickTime = now + 0.05; // slight offset to start
  this._lastScheduleTime = 0; // reset timing
  if (this._animationId) cancelAnimationFrame(this._animationId);
  this._scheduleNext();
  }

  stop() {
  this.running = false;
  if (this._animationId) cancelAnimationFrame(this._animationId);
  this._animationId = null;
    const now = this.audioCtx.currentTime;
    this.clock.offset.setTargetAtTime(0, now, 0.01);
    this.beat.offset.setTargetAtTime(0, now, 0.01);
  }

  reset() {
    const now = this.audioCtx.currentTime;
    // Reset internal counters
    this._tickIndex = 0;
    this._nextTickTime = this.running ? (now + 0.05) : now;
    // Visual outputs to 0
    this.clock.offset.setTargetAtTime(0, now, 0.005);
    this.beat.offset.setTargetAtTime(0, now, 0.005);
    // Notify subscribers immediately about reset
    const evt = { time: now, bpm: this.bpm, ppqn: this.ppqn, tick: 0, reset: true };
    this._subs.forEach(cb => { try { cb(evt); } catch {} });
  }

  subscribeClock(id, cb) { this._subs.set(id, cb); }
  unsubscribeClock(id) { this._subs.delete(id); }

  // Public method to allow external notification of UI activity
  setUIBusy(busy) { this._setUIBusy(busy); }

  toJSON() { return { bpm: this.bpm, running: this.running }; }
  fromJSON(state) {
    if (!state) return;
    if (typeof state.bpm === 'number') { this.bpm = state.bpm; this.bpmOut.offset.value = this.bpm; }
    if (state.running) this.start();
  }
}
