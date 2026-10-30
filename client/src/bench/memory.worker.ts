// Memory limit probe. Allocates in steps and touches every byte so the OS really commits the
// pages. Runs in a worker: terminating it frees everything, and on phones an out-of-memory
// kill may take down only the worker instead of the whole tab.
import type { MemoryRequest, MemoryResponse } from './memory.shared.ts';

const MB = 2 ** 20;
const WASM_PAGE = 64 * 1024;

function reply(msg: MemoryResponse): void {
  postMessage(msg);
}

onmessage = (e: MessageEvent<MemoryRequest>) => {
  const { phase, stepMB, capMB } = e.data;
  const keep: ArrayBuffer[] = [];
  const memory = phase === 'wasm' ? new WebAssembly.Memory({ initial: 0 }) : null;
  let mb = 0;
  try {
    while (mb + stepMB <= capMB) {
      reply({ type: 'attempt', mb: mb + stepMB });
      if (memory) {
        memory.grow((stepMB * MB) / WASM_PAGE);
        new Uint8Array(memory.buffer, mb * MB, stepMB * MB).fill(1);
      } else {
        const buf = new ArrayBuffer(stepMB * MB);
        new Uint8Array(buf).fill(1);
        keep.push(buf);
      }
      mb += stepMB;
      reply({ type: 'progress', mb });
    }
    reply({ type: 'done', mb, capped: true, error: '' });
  } catch (err) {
    reply({ type: 'done', mb, capped: false, error: String(err) });
  }
};
