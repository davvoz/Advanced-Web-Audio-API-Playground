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
  this._timerId = null;
  this._nextTickTime = 0;
  this._tickIndex = 0;
  this._lookaheadMs = 25;        // how often to check
  this._scheduleAheadSec = 0.1;  // how far ahead to schedule
  }

  buildControls(container) {
    const transport = document.createElement('div');
    transport.className = 'control';
    transport.innerHTML = `
      <label>Transport</label>
      <div style="display:flex;gap:6px;align-items:center;">
        <button class="btn" data-role="start">Start</button>
        <button class="btn" data-role="stop">Stop</button>
      </div>
    `;
    const startBtn = transport.querySelector('[data-role=start]');
    const stopBtn = transport.querySelector('[data-role=stop]');
    startBtn.addEventListener('click', () => this.start());
    stopBtn.addEventListener('click', () => this.stop());

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
  }

  start() {
  if (this.running) return;
  this.running = true;
  const now = this.audioCtx.currentTime;
  this._tickIndex = 0;
  this._nextTickTime = now + 0.05; // slight offset to start
  if (this._timerId) clearInterval(this._timerId);
  this._timerId = setInterval(() => this._scheduler(), this._lookaheadMs);
  }

  stop() {
  this.running = false;
  if (this._timerId) clearInterval(this._timerId);
  this._timerId = null;
    const now = this.audioCtx.currentTime;
    this.clock.offset.setTargetAtTime(0, now, 0.01);
    this.beat.offset.setTargetAtTime(0, now, 0.01);
  }

  subscribeClock(id, cb) { this._subs.set(id, cb); }
  unsubscribeClock(id) { this._subs.delete(id); }

  toJSON() { return { bpm: this.bpm, running: this.running }; }
  fromJSON(state) {
    if (!state) return;
    if (typeof state.bpm === 'number') { this.bpm = state.bpm; this.bpmOut.offset.value = this.bpm; }
    if (state.running) this.start();
  }
}
