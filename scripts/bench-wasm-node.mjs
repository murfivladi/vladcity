// Runs the WASM build of the simulation spike in Node (V8, same engine as Chrome) with the
// exact browser protocol. Useful to compare WASM against native_bench on the same machine.
// Usage (after scripts/build-wasm.sh):
//   node scripts/bench-wasm-node.mjs                     timing table for both builds
//   node scripts/bench-wasm-node.mjs --checksums simd    checksums only, same format as native_bench
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { AGENT_SIZES, IDM_SIZES, checksumOnly, runBench } from '../client/src/bench/protocol.ts';

const files = {
  simd: '../client/src/generated/spike_agents_simd.wasm',
  plain: '../client/src/generated/spike_agents.wasm',
};
const jobs = [...AGENT_SIZES.map((n) => ['agents', n]), ...IDM_SIZES.map((n) => ['idm', n])];

async function load(variant) {
  const bytes = await readFile(new URL(files[variant], import.meta.url));
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports;
}

if (process.argv[2] === '--checksums') {
  const sim = await load(process.argv[3] ?? 'simd');
  for (const [model, n] of jobs) console.log(`${model} ${n} ${checksumOnly(sim, model, n)}`);
} else {
  console.log('| WASM | Модель | Агентов | мс/тик (ср.) | p50 | p95 | нс/агент | байт/агент | checksum |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const variant of Object.keys(files)) {
    const sim = await load(variant);
    for (const [model, n] of jobs) {
      const r = runBench(sim, model, n, () => performance.now());
      console.log(
        `| ${variant} | ${model} | ${n} | ${r.avg.toFixed(2)} | ${r.p50.toFixed(2)} | ${r.p95.toFixed(2)} | ` +
          `${r.nsPerAgent.toFixed(1)} | ${r.bytesPerAgent} | ${r.checksum} |`,
      );
    }
  }
}
