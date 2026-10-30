// Simulation benchmark worker: owns one WASM instance and either runs the full protocol
// for one world, or holds a world and ticks it on request (multi-worker scaling test).
import { runBench, World, type Model, type SimExports } from './protocol.ts';
import { loadSim, type WasmVariant } from './wasm.ts';

export type SimRequest =
  | { type: 'init'; variant: WasmVariant }
  | { type: 'bench'; model: Model; n: number }
  | { type: 'create'; model: Model; n: number; seed: number }
  | { type: 'tick' }
  | { type: 'destroy' };

export type SimResponse =
  | { type: 'ready' }
  | { type: 'bench'; row: ReturnType<typeof runBench> }
  | { type: 'created' }
  | { type: 'ticked'; ms: number }
  | { type: 'error'; message: string };

let sim: SimExports | null = null;
let world: World | null = null;

function reply(msg: SimResponse): void {
  postMessage(msg);
}

onmessage = async (e: MessageEvent<SimRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init':
        sim = await loadSim(msg.variant);
        reply({ type: 'ready' });
        break;
      case 'bench':
        reply({ type: 'bench', row: runBench(sim!, msg.model, msg.n, () => performance.now()) });
        break;
      case 'create':
        world?.free();
        world = new World(sim!, msg.model, msg.n, msg.seed);
        world.warmup();
        reply({ type: 'created' });
        break;
      case 'tick': {
        const t = performance.now();
        world!.tick();
        reply({ type: 'ticked', ms: performance.now() - t });
        break;
      }
      case 'destroy':
        world?.free();
        world = null;
        break;
    }
  } catch (err) {
    reply({ type: 'error', message: String(err) });
  }
};
