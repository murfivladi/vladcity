// Echo worker for the environment probe: postMessage ping-pong, Atomics ping-pong and a
// shared-buffer write the main thread verifies without any copy or transfer.

export type SabRequest =
  | { type: 'ping'; i: number }
  | { type: 'atomics'; flags: SharedArrayBuffer; rounds: number }
  | { type: 'fill'; data: SharedArrayBuffer };

onmessage = (e: MessageEvent<SabRequest>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'ping':
      postMessage({ type: 'pong', i: msg.i });
      break;
    case 'atomics': {
      // flags[0]: round requested by main; flags[1]: round answered by the worker.
      const flags = new Int32Array(msg.flags);
      postMessage({ type: 'atomics-ready' });
      for (let round = 1; round <= msg.rounds; round++) {
        if (Atomics.wait(flags, 0, round - 1, 2000) === 'timed-out') break;
        Atomics.store(flags, 1, round);
        Atomics.notify(flags, 1);
      }
      break;
    }
    case 'fill': {
      const data = new Float32Array(msg.data);
      for (let i = 0; i < data.length; i++) data[i] = i * 0.5;
      postMessage({ type: 'filled' });
      break;
    }
  }
};
