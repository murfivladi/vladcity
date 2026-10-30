#!/usr/bin/env bash
# Determinism guard: the native build and both WASM builds must reach bit-identical states.
# Requires scripts/build-wasm.sh to have run.
set -euo pipefail
cd "$(dirname "$0")/.."

native=$(cargo run --quiet --release --bin native_bench -- --checksums)
echo "$native"
for variant in simd plain; do
  wasm=$(node scripts/bench-wasm-node.mjs --checksums "$variant")
  if ! diff <(echo "$native") <(echo "$wasm"); then
    echo "WASM ($variant) diverged from native" >&2
    exit 1
  fi
  echo "WASM ($variant): checksums match native"
done
