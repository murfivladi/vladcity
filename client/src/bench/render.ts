// Render benchmark: can Babylon.js draw 100 000 moving cars and 50 000 buildings?
// Every car is a thin instance whose matrix is rewritten on the CPU each frame (the
// honest worst case: nothing is culled, everything is uploaded every frame).
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { summarize } from './protocol.ts';
import type { RenderResult, RenderScenarioResult } from './results.ts';
import {
  BUILDING_PALETTE,
  CAR_PALETTE,
  createBuildingMesh,
  createCarMesh,
  createCityScene,
  FrameTimer,
  mulberry32,
  randomColors,
  MIN_FRAMES,
  renderUntil,
  STALL_MS,
  StallError,
  TIME_SCALE,
  triangleCount,
  withEngine,
  writeCarMatrix,
  type CarDetail,
  type EngineHandle,
  type EnginePreference,
} from './scene.ts';

interface Scenario {
  id: string;
  label: string;
  cars: number;
  buildings: number;
  carDetail: CarDetail;
}

export const SCENARIOS: Scenario[] = [
  { id: 'b50k', label: '50 000 зданий', cars: 0, buildings: 50_000, carDetail: 'box' },
  { id: 'c100k', label: '100 000 машин (коробки)', cars: 100_000, buildings: 0, carDetail: 'box' },
  { id: 'c100k-b50k', label: '100 000 машин + 50 000 зданий', cars: 100_000, buildings: 50_000, carDetail: 'box' },
  { id: 'c100k-lp-b50k', label: '100 000 машин (~200 треуг.) + 50 000 зданий', cars: 100_000, buildings: 50_000, carDetail: 'lowpoly' },
  { id: 'c200k-b100k', label: 'Запас: 200 000 машин + 100 000 зданий', cars: 200_000, buildings: 100_000, carDetail: 'box' },
];

const WARMUP_MS = 2000 * TIME_SCALE;
const MEASURE_MS = 8000 * TIME_SCALE;
/** Distance between road centre lines; one building per cell. */
const CELL = 24;

interface CarState {
  axis: Uint8Array; // 0: along x, 1: along z
  line: Float32Array; // coordinate of the lane across the travel direction
  s: Float32Array; // position along the road
  dir: Int8Array;
  speed: Float32Array;
}

function citySide(buildings: number): number {
  return Math.ceil(Math.sqrt(Math.max(buildings, 50_000)));
}

function placeBuildings(mesh: Mesh, count: number, rand: () => number): void {
  const side = citySide(count);
  const half = (side * CELL) / 2;
  const m = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) {
    const cx = (i % side) * CELL - half + CELL / 2;
    const cz = Math.floor(i / side) * CELL - half + CELL / 2;
    const w = 9 + rand() * 9;
    const d = 9 + rand() * 9;
    const h = 6 + 70 * rand() ** 3;
    const o = i * 16;
    m[o] = w;
    m[o + 5] = h;
    m[o + 10] = d;
    m[o + 12] = cx;
    m[o + 14] = cz;
    m[o + 15] = 1;
  }
  mesh.thinInstanceSetBuffer('matrix', m, 16, true);
  mesh.thinInstanceSetBuffer('color', randomColors(count, rand, BUILDING_PALETTE), 4, true);
  mesh.thinInstanceRefreshBoundingInfo();
  mesh.freezeWorldMatrix();
}

function spawnCars(count: number, side: number, rand: () => number): CarState {
  const length = side * CELL;
  const half = length / 2;
  const cars: CarState = {
    axis: new Uint8Array(count),
    line: new Float32Array(count),
    s: new Float32Array(count),
    dir: new Int8Array(count),
    speed: new Float32Array(count),
  };
  for (let i = 0; i < count; i++) {
    const dir = rand() < 0.5 ? 1 : -1;
    const road = Math.floor(rand() * (side + 1)) * CELL - half;
    cars.axis[i] = rand() < 0.5 ? 0 : 1;
    cars.dir[i] = dir;
    // Right-hand traffic: offset to the right of the travel direction.
    cars.line[i] = road + (cars.axis[i] === 0 ? -dir : dir) * 1.75;
    cars.s[i] = rand() * length;
    cars.speed[i] = 8 + rand() * 9;
  }
  return cars;
}

function moveCars(cars: CarState, matrices: Float32Array, length: number, dt: number): void {
  const half = length / 2;
  const n = cars.s.length;
  for (let i = 0; i < n; i++) {
    let s = cars.s[i] + cars.speed[i] * cars.dir[i] * dt;
    if (s < 0) s += length;
    else if (s >= length) s -= length;
    cars.s[i] = s;
    const along = s - half;
    if (cars.axis[i] === 0) writeCarMatrix(matrices, i, along, cars.line[i], cars.dir[i], 0);
    else writeCarMatrix(matrices, i, cars.line[i], along, 0, cars.dir[i]);
  }
}

export async function runRenderBench(
  host: HTMLElement,
  pref: EnginePreference,
  progress: (text: string) => void,
  shouldStop: () => boolean,
): Promise<RenderResult> {
  const { result, handle, note } = await withEngine(host, pref, progress, async (h) => {
    const scenarios: RenderScenarioResult[] = [];
    for (const sc of SCENARIOS) {
      if (shouldStop()) break;
      progress(`${sc.label}: прогрев…`);
      const res = await runScenario(h, sc, progress, shouldStop);
      scenarios.push(res);
      // Heavier scenes would stall too; keep what we have instead of hanging the device.
      if (res.stalled) break;
    }
    return scenarios;
  });
  return {
    engine: note ? `${handle.kind} (${note})` : handle.kind,
    gpu: handle.gpu,
    resolution: `${handle.engine.getRenderWidth()}×${handle.engine.getRenderHeight()}`,
    scenarios: result,
  };
}

async function runScenario(
  handle: EngineHandle,
  sc: Scenario,
  progress: (text: string) => void,
  shouldStop: () => boolean,
): Promise<RenderScenarioResult> {
  const rand = mulberry32(1234);
  const side = citySide(sc.buildings);
  const length = side * CELL;
  const { scene, camera } = createCityScene(handle.engine, length);

  let triangles = 0;
  if (sc.buildings) {
    const buildings = createBuildingMesh(scene);
    placeBuildings(buildings, sc.buildings, rand);
    triangles += triangleCount(buildings);
  }
  let cars: CarState | null = null;
  let carMesh: Mesh | null = null;
  let matrices: Float32Array | null = null;
  if (sc.cars) {
    carMesh = createCarMesh(scene, sc.carDetail);
    cars = spawnCars(sc.cars, side, rand);
    matrices = new Float32Array(sc.cars * 16);
    moveCars(cars, matrices, length, 0);
    carMesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
    carMesh.thinInstanceSetBuffer('color', randomColors(sc.cars, rand, CAR_PALETTE), 4, true);
    triangles += triangleCount(carMesh);
  }

  const timer = new FrameTimer();
  const start = performance.now();
  let measuring = false;
  try {
    return await renderUntil<RenderScenarioResult>(handle, () => {
      const elapsed = performance.now() - start;
      if (!measuring && elapsed > WARMUP_MS) {
        measuring = true;
        timer.reset();
        progress(`${sc.label}: замер…`);
      }
      if (measuring && ((elapsed > WARMUP_MS + MEASURE_MS && timer.frames.length >= MIN_FRAMES) || shouldStop())) {
        const frames = summarize(timer.frames.length ? timer.frames : [NaN]);
        return {
          id: sc.id,
          label: sc.label,
          cars: sc.cars,
          buildings: sc.buildings,
          triangles,
          fps: 1000 / frames.avg,
          frameP95: frames.p95,
          updateMs: timer.updates.length ? summarize(timer.updates).avg : 0,
          renderCpuMs: summarize(timer.renders.length ? timer.renders : [NaN]).avg,
        };
      }
      timer.begin();
      // Orbit and zoom from the whole city down to street level and back once per run,
      // so both the far view (all geometry) and the near view (fill rate) are measured.
      const phase = elapsed / (WARMUP_MS + MEASURE_MS);
      camera.alpha = -Math.PI / 4 + phase * Math.PI * 0.5;
      camera.radius = length * (0.04 + 0.71 * (0.5 + 0.5 * Math.cos(phase * 2 * Math.PI)));
      if (cars && carMesh && matrices) {
        const t = performance.now();
        moveCars(cars, matrices, length, 1 / 60);
        carMesh.thinInstanceBufferUpdated('matrix');
        if (measuring) timer.updates.push(performance.now() - t);
      }
      const t = performance.now();
      scene.render();
      if (measuring) timer.renders.push(performance.now() - t);
      return undefined;
    });
  } catch (err) {
    if (!(err instanceof StallError)) throw err;
    return {
      id: sc.id,
      label: sc.label,
      cars: sc.cars,
      buildings: sc.buildings,
      triangles,
      fps: 0,
      frameP95: STALL_MS,
      updateMs: NaN,
      renderCpuMs: NaN,
      stalled: true,
    };
  } finally {
    scene.dispose();
  }
}
