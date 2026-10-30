// Shared between live.ts (main thread) and live.worker.ts. Kept separate so the main
// bundle never pulls in the worker's code.
import type { WasmVariant } from './wasm.ts';

export const RENDER_STRIDE = 4;
export const SLOTS = 3;
/** header[LATEST]: slot with the newest frame; header[TICK]: number of published ticks. */
export const LATEST = 0;
export const TICK = 1;

export type LiveRequest = {
  type: 'start';
  variant: WasmVariant;
  n: number;
  rendered: number;
  tickRate: number;
  header: SharedArrayBuffer;
  slots: SharedArrayBuffer;
};

export type LiveResponse =
  | { type: 'started' }
  | { type: 'stats'; tickMs: number; publishMs: number; ticksPerSec: number }
  | { type: 'error'; message: string };
