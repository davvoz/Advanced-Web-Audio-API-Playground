import { Module } from './module.js';
import { syncWorkerTime } from './lib/syncWorkerTime.js';

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

  // Worker-based clock
  this._clockW = null;
  this._onWMsg = null;
  this._tickIndex = 0;
  this._nextTickTime = 0; // for visuals
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

  // Worker message handler will dispatch tick batches and set visuals
  _attachWorker() {
    if (this._clockW) return;
    try {
      this._clockW = new Worker(new URL('./workers/clockWorker.js', import.meta.url), { type: 'module' });
    } catch (e) {
      console.error('Failed to start clock worker', e);
      this._clockW = null;
      return;
    }
    this._onWMsg = (e) => {
      const msg = e.data || {};
      if (msg.type === 'batch') {
        // Forward ticks to subscribers and schedule visual pulses
        const ticks = msg.ticks || [];
        for (const t of ticks) {
          const time = t.time;
          // Visual clock pulses
          this.clock.offset.setValueAtTime(1, time);
          this.clock.offset.setValueAtTime(0, time + 0.002);
          if (t.index % this.ppqn === 0) {
            this.beat.offset.setValueAtTime(1, time);
            this.beat.offset.setValueAtTime(0, time + 0.005);
          }
          const evt = { time, bpm: this.bpm, ppqn: this.ppqn, tick: t.index };
          this._subs.forEach(cb => { try { cb(evt); } catch {} });
        }
        if (ticks.length) {
          const last = ticks[ticks.length - 1];
          this._tickIndex = last.index + 1;
          this._nextTickTime = last.time + (60 / this.bpm / this.ppqn);
        }
      }
    };
    this._clockW.addEventListener('message', this._onWMsg);
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this._attachWorker();
    if (!this._clockW) { this.running = false; return; }
    // Sync mapping and configure worker
    await syncWorkerTime(this._clockW, this.audioCtx);
    this._clockW.postMessage({ type: 'config', bpm: this.bpm, ppqn: this.ppqn, lookAheadSec: 0.35, batchEveryMs: 25 });
    const startAt = this.audioCtx.currentTime + 0.1;
    this._tickIndex = Math.ceil(startAt / (60 / this.bpm / this.ppqn));
    this._nextTickTime = this._tickIndex * (60 / this.bpm / this.ppqn);
    this._clockW.postMessage({ type: 'play', audioStartSec: startAt });
  }

  stop() {
    this.running = false;
    const now = this.audioCtx.currentTime;
    try { this._clockW?.postMessage({ type: 'stop' }); } catch {}
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
    try { this._clockW?.postMessage({ type: 'seek', audioAtSec: now }); } catch {}
  }

  subscribeClock(id, cb) { this._subs.set(id, cb); }
  unsubscribeClock(id) { this._subs.delete(id); }

  // Public method kept for compatibility (no-op with worker clock)
  setUIBusy(busy) { /* no-op: worker-based clock */ }

  toJSON() { return { bpm: this.bpm, running: this.running }; }
  fromJSON(state) {
    if (!state) return;
    if (typeof state.bpm === 'number') { this.bpm = state.bpm; this.bpmOut.offset.value = this.bpm; }
    if (state.running) this.start();
  }

  dispose() {
    super.dispose?.();
    try {
      if (this._clockW) {
        if (this._onWMsg) this._clockW.removeEventListener('message', this._onWMsg);
        this._clockW.terminate();
      }
    } catch {}
    this._clockW = null;
    this._onWMsg = null;
  }
}
