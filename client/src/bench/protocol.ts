// Benchmark protocol for the simulation spike. Plain TypeScript with no browser or Vite
// imports, so the same code runs in a Web Worker and in Node (scripts/bench-wasm-node.mjs).
// Keep the constants in sync with sim/spike-agents/src/bin/native_bench.rs.

export const SEED = 2026;
export const AGENT_DT = 1.0;
export const AGENT_WARMUP_DT = 10.0;
export const AGENT_WARMUP_TICKS = 90;
export const IDM_DT = 0.25;
export const IDM_WARMUP_TICKS = 20;
export const CHECKSUM_TICKS = 30;
export const MIN_SAMPLES = 30;
export const MAX_TICKS = 3000;
export const MIN_MS = 1000;
/** Browsers coarsen timers (Safari to 1 ms without isolation), so tiny ticks are timed in batches. */
export const MIN_SAMPLE_MS = 2;

export const AGENT_SIZES = [100_000, 500_000, 1_000_000];
export const IDM_SIZES = [10_000, 50_000, 100_000, 250_000];

export type Model = 'agents' | 'idm';

/** The C ABI exported by sim/spike-agents (src/lib.rs). */
export interface SimExports {
  memory: WebAssembly.Memory;
  agents_new(n: number, seed: number): number;
  agents_free(p: number): void;
  agents_tick(p: number, dt: number): void;
  agents_fill_render(p: number, count: number): number;
  agents_moving(p: number): number;
  agents_checksum(p: number): number;
  agents_bytes(p: number): number;
  idm_new(n: number, seed: number): number;
  idm_free(p: number): void;
  idm_tick(p: number, dt: number): void;
  idm_mean_speed(p: number): number;
  idm_checksum(p: number): number;
  idm_bytes(p: number): number;
}

export interface TickStats {
  avg: number;
  p50: number;
  p95: number;
  max: number;
}

export interface BenchRow extends TickStats {
  model: Model;
  n: number;
  nsPerAgent: number;
  bytesPerAgent: number;
  checksum: string;
  samples: number;
  /** Ticks per timed sample (1 unless ticks are shorter than the timer resolution). */
  batch: number;
}

export function summarize(times: number[]): TickStats {
  const sorted = [...times].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.round((sorted.length - 1) * p)];
  const avg = times.reduce((s, t) => s + t, 0) / times.length;
  return { avg, p50: pct(0.5), p95: pct(0.95), max: sorted[sorted.length - 1] };
}

/** A world of one model, hiding the C ABI. */
export class World {
  readonly ptr: number;
  private readonly sim: SimExports;
  readonly model: Model;
  readonly n: number;

  constructor(sim: SimExports, model: Model, n: number, seed = SEED) {
    this.sim = sim;
    this.model = model;
    this.n = n;
    this.ptr = model === 'agents' ? sim.agents_new(n, seed) : sim.idm_new(n, seed);
  }

  warmup(): void {
    if (this.model === 'agents') {
      for (let i = 0; i < AGENT_WARMUP_TICKS; i++) this.sim.agents_tick(this.ptr, AGENT_WARMUP_DT);
    } else {
      for (let i = 0; i < IDM_WARMUP_TICKS; i++) this.sim.idm_tick(this.ptr, IDM_DT);
    }
  }

  tick(count = 1): void {
    if (this.model === 'agents') {
      for (let i = 0; i < count; i++) this.sim.agents_tick(this.ptr, AGENT_DT);
    } else {
      for (let i = 0; i < count; i++) this.sim.idm_tick(this.ptr, IDM_DT);
    }
  }

  checksum(): string {
    const h = this.model === 'agents' ? this.sim.agents_checksum(this.ptr) : this.sim.idm_checksum(this.ptr);
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  bytes(): number {
    return this.model === 'agents' ? this.sim.agents_bytes(this.ptr) : this.sim.idm_bytes(this.ptr);
  }

  free(): void {
    if (this.model === 'agents') this.sim.agents_free(this.ptr);
    else this.sim.idm_free(this.ptr);
  }
}

/** State checksum after warm-up plus CHECKSUM_TICKS, without any timing. */
export function checksumOnly(sim: SimExports, model: Model, n: number): string {
  const world = new World(sim, model, n);
  try {
    world.warmup();
    world.tick(CHECKSUM_TICKS);
    return world.checksum();
  } finally {
    world.free();
  }
}

/** Same protocol as native_bench: warm up, fixed ticks, checksum, then timed samples. */
export function runBench(sim: SimExports, model: Model, n: number, now: () => number): BenchRow {
  const world = new World(sim, model, n);
  try {
    world.warmup();
    const t0 = now();
    world.tick(CHECKSUM_TICKS);
    const estimate = Math.max((now() - t0) / CHECKSUM_TICKS, 1e-4);
    const checksum = world.checksum();
    const batch = Math.max(1, Math.ceil(MIN_SAMPLE_MS / estimate));

    const times: number[] = [];
    let total = 0;
    let ticks = 0;
    while ((total < MIN_MS || times.length < MIN_SAMPLES) && ticks < MAX_TICKS) {
      const t = now();
      world.tick(batch);
      const ms = now() - t;
      times.push(ms / batch);
      total += ms;
      ticks += batch;
    }
    const stats = summarize(times);
    return {
      model,
      n,
      ...stats,
      nsPerAgent: (stats.avg * 1e6) / n,
      bytesPerAgent: Math.round(world.bytes() / n),
      checksum,
      samples: times.length,
      batch,
    };
  } finally {
    world.free();
  }
}
