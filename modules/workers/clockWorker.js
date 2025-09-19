// Clock worker: schedules future ticks and posts them in batches using audio time mapping

let state = {
  bpm: 120,
  ppqn: 4, // 16th notes by default
  lookAheadSec: 0.35,
  batchEveryMs: 25,
  running: false,
  secPerTick: 60 / 120 / 4,
  // audio = audioBase + ((tw + offsetMs) - mainBaseMs)/1000
  sync: { audioBase: 0, mainBaseMs: 0, offsetMs: 0 },

  tickIndex: 0,
  nextTickTimeSec: 0
};

function recalcSpt() {
  state.secPerTick = 60 / state.bpm / state.ppqn;
}

function workerNowMs() { return performance.now(); }

function toAudioTimeSec(twMs) {
  const s = state.sync;
  return s.audioBase + ((twMs + s.offsetMs) - s.mainBaseMs) / 1000;
}

let loopId = 0;
function startLoop() {
  if (loopId) return;
  const step = () => {
    if (!state.running) { loopId = 0; return; }
    const nowAudio = toAudioTimeSec(workerNowMs());
    const endWin = nowAudio + state.lookAheadSec;
    const ticks = [];
    while (state.nextTickTimeSec <= endWin) {
      ticks.push({ index: state.tickIndex, time: state.nextTickTimeSec });
      state.tickIndex++;
      state.nextTickTimeSec += state.secPerTick;
    }
    if (ticks.length) {
      postMessage({ type: 'batch', ticks, nowAudio });
    }
    loopId = setTimeout(step, state.batchEveryMs);
  };
  state.running = true;
  loopId = setTimeout(step, 0);
}

function stopLoop() {
  state.running = false;
  if (loopId) clearTimeout(loopId);
  loopId = 0;
}

onmessage = (e) => {
  const msg = e.data || {};
  switch (msg.type) {
    case 'config':
      if (typeof msg.bpm === 'number') state.bpm = msg.bpm;
      if (typeof msg.ppqn === 'number') state.ppqn = msg.ppqn;
      if (typeof msg.lookAheadSec === 'number') state.lookAheadSec = msg.lookAheadSec;
      if (typeof msg.batchEveryMs === 'number') state.batchEveryMs = msg.batchEveryMs;
      recalcSpt();
      break;

    case 'sync':
      // mapping: { audioBase, mainBaseMs, offsetMs }
      state.sync = { ...state.sync, ...msg.mapping };
      break;

    case 'ping': {
      // Handshake for NTP-like sync
      postMessage({ type: 'pong', t0: msg.t0, tw: workerNowMs(), audioT0: msg.audioT0 });
      break; }

    case 'play': {
      // play({ audioStartSec })
      stopLoop();
      recalcSpt();
      const startSec = msg.audioStartSec || 0;
      state.tickIndex = Math.ceil(startSec / state.secPerTick);
      state.nextTickTimeSec = state.tickIndex * state.secPerTick;
      startLoop();
      break; }

    case 'seek': {
      // seek({ audioAtSec }) aligns to nearest future tick
      recalcSpt();
      const at = msg.audioAtSec || 0;
      state.tickIndex = Math.ceil(at / state.secPerTick);
      state.nextTickTimeSec = state.tickIndex * state.secPerTick;
      break; }

    case 'stop':
      stopLoop();
      break;

    case 'getTime':
      postMessage({ type: 'time', nowAudio: toAudioTimeSec(workerNowMs()) });
      break;
  }
};
