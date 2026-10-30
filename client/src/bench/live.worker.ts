// Live test, simulation side: ticks residents at a fixed rate and publishes the positions of
// the first `rendered` of them into a SharedArrayBuffer (triple-buffered) for the renderer.
import { World } from './protocol.ts';
import { LATEST, RENDER_STRIDE, SLOTS, TICK, type LiveRequest, type LiveResponse } from './live.shared.ts';
import { loadSim } from './wasm.ts';

function reply(msg: LiveResponse): void {
  postMessage(msg);
}

onmessage = async (e: MessageEvent<LiveRequest>) => {
  const msg = e.data;
  try {
    const sim = await loadSim(msg.variant);
    const world = new World(sim, 'agents', msg.n);
    world.warmup();
    const header = new Int32Array(msg.header);
    const slots = new Float32Array(msg.slots);
    const slotSize = msg.rendered * RENDER_STRIDE;
    const interval = 1000 / msg.tickRate;
    reply({ type: 'started' });

    let next = performance.now();
    let windowStart = next;
    let ticks = 0;
    let tickSum = 0;
    let publishSum = 0;

    const loop = () => {
      const t0 = performance.now();
      world.tick();
      const t1 = performance.now();
      const ptr = sim.agents_fill_render(world.ptr, msg.rendered);
      const slot = (Atomics.load(header, LATEST) + 1) % SLOTS;
      // The WASM memory may have grown, so the view is created fresh every time.
      slots.set(new Float32Array(sim.memory.buffer, ptr, slotSize), slot * slotSize);
      Atomics.store(header, LATEST, slot);
      Atomics.add(header, TICK, 1);
      const t2 = performance.now();

      ticks++;
      tickSum += t1 - t0;
      publishSum += t2 - t1;
      if (t2 - windowStart >= 1000) {
        reply({ type: 'stats', tickMs: tickSum / ticks, publishMs: publishSum / ticks, ticksPerSec: (ticks * 1000) / (t2 - windowStart) });
        windowStart = t2;
        ticks = tickSum = publishSum = 0;
      }
      next += interval;
      // If the tick is slower than the interval, run back-to-back instead of piling up.
      if (next < t2) next = t2;
      setTimeout(loop, next - t2);
    };
    loop();
  } catch (err) {
    reply({ type: 'error', message: String(err) });
  }
};
