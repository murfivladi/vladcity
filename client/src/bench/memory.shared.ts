// Messages between memory.ts and memory.worker.ts.

export type MemoryPhase = 'wasm' | 'js';

export interface MemoryRequest {
  phase: MemoryPhase;
  stepMB: number;
  capMB: number;
}

export type MemoryResponse =
  | { type: 'attempt'; mb: number }
  | { type: 'progress'; mb: number }
  | { type: 'done'; mb: number; capped: boolean; error: string };
