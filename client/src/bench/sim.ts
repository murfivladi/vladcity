// Simulation benchmark, main-thread side: drives sim.worker.ts.
import { AGENT_SIZES, IDM_SIZES, MIN_MS, MIN_SAMPLES, SEED, summarize, type Model } from './protocol.ts';
import type { SimResult } from './results.ts';
import type { SimRequest, SimResponse } from './sim.worker.ts';
import { wasmSimdSupported, type WasmVariant } from './wasm.ts';

class SimWorker {
  private readonly worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });

  request(msg: SimRequest): Promise<SimResponse> {
    return new Promise((resolve, reject) => {
      this.worker.onmessage = (e: MessageEvent<SimResponse>) => {
        if (e.data.type === 'error') reject(new Error(e.data.message));
        else resolve(e.data);
      };
      this.worker.onerror = (e) => reject(new Error(e.message || 'сбой воркера'));
      this.worker.postMessage(msg);
    });
  }

  terminate(): void {
    this.worker.terminate();
  }
}

export type Progress = (text: string) => void;

async function runSingle(variant: WasmVariant, jobs: [Model, number][], out: SimResult, progress: Progress) {
  const w = new SimWorker();
  try {
    await w.request({ type: 'init', variant });
    for (const [model, n] of jobs) {
      progress(`Один воркер, ${variant}: ${model} × ${n.toLocaleString('ru-RU')}…`);
      const res = await w.request({ type: 'bench', model, n });
      if (res.type === 'bench') out.single.push({ ...res.row, variant });
    }
  } finally {
    w.terminate();
  }
}

/** Splits one world across `count` workers and ticks them in lock-step from the main thread. */
async function runParallel(variant: WasmVariant, model: Model, n: number, count: number, progress: Progress) {
  progress(`${count} воркера, ${model} × ${n.toLocaleString('ru-RU')}…`);
  const workers = Array.from({ length: count }, () => new SimWorker());
  try {
    await Promise.all(workers.map((w) => w.request({ type: 'init', variant })));
    const share = Math.ceil(n / count);
    await Promise.all(workers.map((w, i) => w.request({ type: 'create', model, n: share, seed: SEED + i })));
    const wall: number[] = [];
    const perWorker: number[][] = workers.map(() => []);
    let total = 0;
    while (total < MIN_MS || wall.length < MIN_SAMPLES) {
      const t = performance.now();
      const replies = await Promise.all(workers.map((w) => w.request({ type: 'tick' })));
      const ms = performance.now() - t;
      wall.push(ms);
      total += ms;
      replies.forEach((r, i) => r.type === 'ticked' && perWorker[i].push(r.ms));
    }
    const wallStats = summarize(wall);
    return {
      model,
      n,
      workers: count,
      wallAvg: wallStats.avg,
      wallP95: wallStats.p95,
      maxWorkerAvg: Math.max(...perWorker.map((t) => summarize(t).avg)),
    };
  } finally {
    workers.forEach((w) => w.terminate());
  }
}

export async function runSimBench(progress: Progress): Promise<SimResult> {
  const out: SimResult = { single: [], parallel: [] };
  const simd = wasmSimdSupported();
  const main: WasmVariant = simd ? 'simd' : 'plain';
  const all: [Model, number][] = [...AGENT_SIZES.map((n): [Model, number] => ['agents', n]), ...IDM_SIZES.map((n): [Model, number] => ['idm', n])];
  await runSingle(main, all, out, progress);
  if (simd) {
    // The largest sizes once more without SIMD, to see what SIMD buys.
    await runSingle('plain', [['agents', AGENT_SIZES.at(-1)!], ['idm', IDM_SIZES.at(-1)!]], out, progress);
  }

  // Leave one core for the main thread (render) — that is how the game will run.
  const cores = navigator.hardwareConcurrency || 2;
  const workerCounts = [...new Set([2, Math.min(8, Math.max(2, cores - 1))])];
  for (const count of workerCounts) {
    out.parallel.push(await runParallel(main, 'agents', AGENT_SIZES.at(-1)!, count, progress));
    out.parallel.push(await runParallel(main, 'idm', IDM_SIZES.at(-1)!, count, progress));
  }
  return out;
}
