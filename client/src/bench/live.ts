// Live test: the whole planned pipeline in miniature. A worker simulates N residents in WASM,
// publishes positions through a SharedArrayBuffer, and the main thread draws up to 100 000
// of them as cars. Proves that cross-origin isolation works on the real hosting.
import { summarize } from './protocol.ts';
import type { LiveResult } from './results.ts';
import {
  CAR_PALETTE,
  createCarMesh,
  createCityScene,
  FrameTimer,
  mulberry32,
  randomColors,
  MIN_FRAMES,
  renderUntil,
  TIME_SCALE,
  withEngine,
  writeCarMatrix,
  type EnginePreference,
} from './scene.ts';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { LATEST, RENDER_STRIDE, SLOTS, TICK, type LiveRequest, type LiveResponse } from './live.shared.ts';
import { wasmSimdSupported } from './wasm.ts';

// Mirrors sim/spike-agents/src/agents.rs.
const CITY_SIZE = 8000;
const BLOCK = 50;
export const LIVE_RENDER_BUDGET = 100_000;
const TICK_RATE = 20;
const WARMUP_MS = 3000 * TIME_SCALE;
const MEASURE_MS = 15000 * TIME_SCALE;

function createRoads(scene: Scene): void {
  const mesh = new Mesh('roads', scene);
  const data = CreateBoxVertexData({ width: 1, height: 0.2, depth: 1 });
  data.applyToMesh(mesh);
  const mat = new StandardMaterial('roads', scene);
  mat.diffuseColor = new Color3(0.22, 0.22, 0.24);
  mat.specularColor = Color3.Black();
  mesh.material = mat;
  const lines = CITY_SIZE / BLOCK + 1;
  const m = new Float32Array(lines * 2 * 16);
  for (let i = 0; i < lines; i++) {
    const c = i * BLOCK - CITY_SIZE / 2;
    // Along x, then along z; 7 m wide, two lanes.
    m.set([CITY_SIZE, 0, 0, 0, 0, 1, 0, 0, 0, 0, 7, 0, 0, 0.1, c, 1], i * 32);
    m.set([7, 0, 0, 0, 0, 1, 0, 0, 0, 0, CITY_SIZE, 0, c, 0.1, 0, 1], i * 32 + 16);
  }
  mesh.thinInstanceSetBuffer('matrix', m, 16, true);
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
}

export async function runLiveTest(
  host: HTMLElement,
  pref: EnginePreference,
  n: number,
  progress: (text: string) => void,
  shouldStop: () => boolean,
): Promise<LiveResult> {
  if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    throw new Error('SharedArrayBuffer недоступен: хостинг не отдаёт заголовки COOP/COEP');
  }
  const rendered = Math.min(n, LIVE_RENDER_BUDGET);
  const header = new SharedArrayBuffer(4 * 4);
  const slots = new SharedArrayBuffer(SLOTS * rendered * RENDER_STRIDE * 4);
  const headerView = new Int32Array(header);
  const slotView = new Float32Array(slots);

  const worker = new Worker(new URL('./live.worker.ts', import.meta.url), { type: 'module' });
  const tickStats: { tickMs: number; publishMs: number; ticksPerSec: number }[] = [];
  let measuring = false;
  const started = new Promise<void>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<LiveResponse>) => {
      const msg = e.data;
      if (msg.type === 'started') resolve();
      else if (msg.type === 'error') reject(new Error(msg.message));
      else if (msg.type === 'stats' && measuring) tickStats.push(msg);
    };
    worker.onerror = (e) => reject(new Error(e.message || 'сбой воркера'));
  });
  progress(`Создаём ${n.toLocaleString('ru-RU')} жителей…`);
  const start: LiveRequest = {
    type: 'start',
    variant: wasmSimdSupported() ? 'simd' : 'plain',
    n,
    rendered,
    tickRate: TICK_RATE,
    header,
    slots,
  };
  worker.postMessage(start);

  try {
    await started;
    const { result } = await withEngine(host, pref, progress, async (handle) => {
      measuring = false;
      tickStats.length = 0;
      const { scene, camera } = createCityScene(handle.engine, CITY_SIZE);
      camera.radius = CITY_SIZE * 0.55;
      createRoads(scene);
      const cars = createCarMesh(scene, 'box');
      const matrices = new Float32Array(rendered * 16);
      cars.thinInstanceSetBuffer('matrix', matrices, 16, false);
      cars.thinInstanceSetBuffer('color', randomColors(rendered, mulberry32(7), CAR_PALETTE), 4, true);

      const timer = new FrameTimer();
      const t0 = performance.now();
      let lastTick = -1;
      const half = CITY_SIZE / 2;
      try {
        return await renderUntil<LiveResult>(handle, () => {
          const elapsed = performance.now() - t0;
          if (!measuring && elapsed > WARMUP_MS) {
            measuring = true;
            timer.reset();
            progress('Замер: воркер считает, главный поток рисует…');
          }
          if (measuring && ((elapsed > WARMUP_MS + MEASURE_MS && timer.frames.length >= MIN_FRAMES) || shouldStop())) {
            const frames = summarize(timer.frames.length ? timer.frames : [NaN]);
            const avg = (key: 'tickMs' | 'publishMs' | 'ticksPerSec') =>
              tickStats.length ? tickStats.reduce((s, t) => s + t[key], 0) / tickStats.length : NaN;
            return {
              simAgents: n,
              rendered,
              tickMs: avg('tickMs'),
              publishMs: avg('publishMs'),
              ticksPerSec: avg('ticksPerSec'),
              targetTicksPerSec: TICK_RATE,
              fps: 1000 / frames.avg,
              frameP95: frames.p95,
              matrixMs: timer.updates.length ? summarize(timer.updates).avg : NaN,
              engine: handle.kind,
            };
          }
          timer.begin();
          camera.alpha += 0.001;
          const tick = Atomics.load(headerView, TICK);
          if (tick !== lastTick) {
            lastTick = tick;
            const t = performance.now();
            const base = Atomics.load(headerView, LATEST) * rendered * RENDER_STRIDE;
            for (let i = 0; i < rendered; i++) {
              const o = base + i * RENDER_STRIDE;
              const dx = slotView[o + 2];
              const dz = slotView[o + 3];
              if (dx === 0 && dz === 0) {
                // Parked at home or work: collapse to a zero matrix, i.e. invisible.
                matrices.fill(0, i * 16, i * 16 + 16);
              } else {
                writeCarMatrix(matrices, i, slotView[o] - half, slotView[o + 1] - half, dx, dz);
              }
            }
            cars.thinInstanceBufferUpdated('matrix');
            if (measuring) timer.updates.push(performance.now() - t);
          }
          scene.render();
          return undefined;
        });
      } finally {
        scene.dispose();
      }
    });
    return result;
  } finally {
    worker.terminate();
  }
}
