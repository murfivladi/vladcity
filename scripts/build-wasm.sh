#!/usr/bin/env bash
# Builds the simulation spike to WebAssembly in two flavours (plain and SIMD128)
# and drops them where the client imports them from.
set -euo pipefail
cd "$(dirname "$0")/.."

out=client/src/generated
mkdir -p "$out"

cargo build -p spike-agents --lib --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/spike_agents.wasm "$out/spike_agents.wasm"

RUSTFLAGS="-C target-feature=+simd128" \
  cargo build -p spike-agents --lib --release --target wasm32-unknown-unknown --target-dir target/simd
cp target/simd/wasm32-unknown-unknown/release/spike_agents.wasm "$out/spike_agents_simd.wasm"

ls -l "$out"/*.wasm
