// Synchronize a clock Worker with AudioContext time using an NTP-like handshake

export async function syncWorkerTime(worker, audioCtx, tries = 7) {
  function once(type) {
    return new Promise((resolve) => {
      const onMsg = (e) => {
        if (e.data?.type === type) {
          worker.removeEventListener('message', onMsg);
          resolve(e.data);
        }
      };
      worker.addEventListener('message', onMsg);
    });
  }

  let best = null;
  for (let i = 0; i < tries; i++) {
    const t0 = performance.now();
    const audioT0 = audioCtx.currentTime;
    worker.postMessage({ type: 'ping', t0, audioT0 });
    const pong = await once('pong'); // { t0, tw, audioT0 }
    const t2 = performance.now();
    const rtt = t2 - pong.t0;
    const mainAtTw = pong.t0 + rtt / 2;
    const offsetMs = mainAtTw - pong.tw; // mainNow ≈ workerNow + offsetMs
    const cand = {
      rtt,
      mapping: {
        audioBase: pong.audioT0, // audio time at t0 (main)
        mainBaseMs: pong.t0,     // main time for that audio time
        offsetMs
      }
    };
    if (!best || cand.rtt < best.rtt) best = cand;
    // small pause between attempts to vary browser scheduling
    await new Promise(r => setTimeout(r, 10));
  }
  worker.postMessage({ type: 'sync', mapping: best.mapping });
  return best.mapping;
}
