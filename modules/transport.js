import { Module } from './module.js';

export class TransportModule extends Module {
  get title() { return 'Transport'; }

  buildAudio() {
    const ctx = this.audioCtx;
    // Outputs as ConstantSource for easy connection to params
    this.bpm = 120;
    this.ppqn = 4; // 16th
    this.running = false;
    this.clock = ctx.createConstantSource(); // pulse 0/1
    this.clock.offset.value = 0;
    this.clock.start();
    this.beat = ctx.createConstantSource(); // 1 on beat, else 0
    this.beat.offset.value = 0;
    this.beat.start();
    this.bpmOut = ctx.createConstantSource(); // emits BPM as value
    this.bpmOut.offset.value = this.bpm;
    this.bpmOut.start();

    this.outputs = {
      clock: { node: this.clock },
      beat: { node: this.beat },
      bpm: { node: this.bpmOut },
    };
    this.inputs = {
      bpm: { param: this.bpmOut.offset },
      run: { param: null },
    };
  this._subs = new Map(); // id -> callback
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

  _tickOnce() {
    const now = this.audioCtx.currentTime;
    // clock short pulse
    this.clock.offset.setValueAtTime(1, now);
    this.clock.offset.setTargetAtTime(0, now + 0.005, 0.005);
    // beat every quarter note
    const spb = 60 / this.bpm; // seconds per beat
    const stepDur = spb / this.ppqn;
    const stepIdx = Math.floor(this._counter % this.ppqn);
    if (stepIdx === 0) {
      this.beat.offset.setValueAtTime(1, now);
      this.beat.offset.setTargetAtTime(0, now + 0.01, 0.01);
    }
    this._counter++;
    // notify subscribers
    this._subs.forEach(cb => {
      try { cb(); } catch {}
    });
    this._timer = setTimeout(() => this._tickOnce(), stepDur * 1000);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._counter = 0;
    this._tickOnce();
    // inform downstream sequencers via connections (optional: future)
  }

  stop() {
    this.running = false;
    if (this._timer) clearTimeout(this._timer);
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
