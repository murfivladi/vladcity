import plainUrl from '../generated/spike_agents.wasm?url';
import simdUrl from '../generated/spike_agents_simd.wasm?url';
import type { SimExports } from './protocol.ts';

export type WasmVariant = 'simd' | 'plain';

/** Loads the simulation spike. The module has no imports, so instantiation is trivial. */
export async function loadSim(variant: WasmVariant): Promise<SimExports> {
  const url = variant === 'simd' ? simdUrl : plainUrl;
  const bytes = await (await fetch(url)).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports as unknown as SimExports;
}

/** Smallest module using a v128 instruction (same probe as wasm-feature-detect). */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

export function wasmSimdSupported(): boolean {
  try {
    return WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}
