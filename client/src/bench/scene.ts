// Babylon.js pieces shared by the render benchmark and the live test.
// Deep imports keep the bundle small; the non-".pure" modules register their side effects.
import { Engine } from '@babylonjs/core/Engines/engine';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { gpuName } from './env.ts';

export type EnginePreference = 'auto' | 'webgpu' | 'webgl2';

export interface EngineHandle {
  engine: AbstractEngine;
  kind: string;
  gpu: string;
}

/** The GPU device or context went away mid-test (driver reset, memory pressure, ...). */
export class GpuLostError extends Error {}

/** No frame finished within STALL_MS: the scene is far too heavy for this device. */
export class StallError extends Error {}

/** A canvas can hold only one context type, so every engine gets a brand-new canvas. */
function freshCanvas(host: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  host.replaceChildren(canvas);
  return canvas;
}

export async function createEngine(host: HTMLElement, pref: EnginePreference): Promise<EngineHandle> {
  if (pref !== 'webgl2' && (await WebGPUEngine.IsSupportedAsync)) {
    try {
      const engine = new WebGPUEngine(freshCanvas(host), { antialias: true, adaptToDeviceRatio: false, powerPreference: 'high-performance' });
      await engine.initAsync();
      const info = (engine as unknown as { _adapterInfo?: { vendor?: string; architecture?: string; description?: string } })._adapterInfo;
      const gpu = gpuName(info) || 'неизвестно';
      return { engine, kind: 'WebGPU', gpu };
    } catch (err) {
      if (pref === 'webgpu') throw err;
    }
  } else if (pref === 'webgpu') {
    throw new Error('WebGPU недоступен в этом браузере');
  }
  const engine = new Engine(freshCanvas(host), true, { powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false }, false);
  const info = engine.getGlInfo();
  return { engine, kind: engine.webGLVersion >= 2 ? 'WebGL2' : 'WebGL1', gpu: `${info.vendor} ${info.renderer}` };
}

/**
 * Creates an engine, runs `test` with it and disposes it. In auto mode a lost WebGPU device
 * is retried once on WebGL2, and the returned note says so.
 */
export async function withEngine<T>(
  host: HTMLElement,
  pref: EnginePreference,
  progress: (text: string) => void,
  test: (handle: EngineHandle) => Promise<T>,
): Promise<{ result: T; handle: EngineHandle; note: string }> {
  let handle = await createEngine(host, pref);
  const onResize = () => handle.engine.resize();
  window.addEventListener('resize', onResize);
  try {
    try {
      return { result: await test(handle), handle, note: '' };
    } catch (err) {
      if (!(err instanceof GpuLostError) || pref !== 'auto' || handle.kind !== 'WebGPU') throw err;
      progress('WebGPU потерял устройство — повторяем на WebGL2…');
      handle.engine.dispose();
      handle = await createEngine(host, 'webgl2');
      return { result: await test(handle), handle, note: 'WebGPU потерял устройство, тест повторён на WebGL2' };
    }
  } finally {
    window.removeEventListener('resize', onResize);
    handle.engine.stopRenderLoop();
    handle.engine.dispose();
    host.replaceChildren();
  }
}

/** `?quick` in the URL shortens warm-up and measurement windows for smoke tests. */
export const TIME_SCALE = new URLSearchParams(location.search).has('quick') ? 0.2 : 1;

/** Fewer frames than this give no usable average, however long the window. */
export const MIN_FRAMES = 10;

/** Frames longer than this mean the device cannot cope at all, not that it is slow. */
export const STALL_MS = 30_000;

/**
 * Runs `frame` in the engine's render loop until it returns a result. Rejects with
 * GpuLostError if the context is lost and with StallError if frames stop coming.
 */
export function renderUntil<T>(handle: EngineHandle, frame: () => T | undefined): Promise<T> {
  const { engine } = handle;
  return new Promise<T>((resolve, reject) => {
    let lastFrame = performance.now();
    const cleanup = () => {
      clearInterval(watchdog);
      engine.onContextLostObservable.remove(lostObserver);
      engine.stopRenderLoop();
    };
    const lostObserver = engine.onContextLostObservable.add(() => {
      cleanup();
      reject(new GpuLostError(`${handle.kind}: устройство GPU потеряно`));
    });
    const watchdog = setInterval(() => {
      if (performance.now() - lastFrame > STALL_MS) {
        cleanup();
        reject(new StallError(`${handle.kind}: кадр не дорисовался за ${STALL_MS / 1000} с`));
      }
    }, 1000);
    engine.runRenderLoop(() => {
      lastFrame = performance.now();
      try {
        const result = frame();
        if (result !== undefined) {
          cleanup();
          resolve(result);
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  });
}

export function createCityScene(engine: AbstractEngine, size: number): { scene: Scene; camera: ArcRotateCamera } {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.62, 0.74, 0.86, 1);
  scene.skipPointerMovePicking = true;
  scene.skipFrustumClipping = true;

  const camera = new ArcRotateCamera('camera', -Math.PI / 4, 0.95, size * 0.75, Vector3.Zero(), scene);
  camera.minZ = 2;
  camera.maxZ = size * 4;

  const sky = new HemisphericLight('sky', new Vector3(0.2, 1, 0.1), scene);
  sky.intensity = 0.75;
  sky.groundColor = new Color3(0.35, 0.33, 0.3);
  const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.35), scene);
  sun.intensity = 0.55;

  const ground = CreateGround('ground', { width: size * 1.2, height: size * 1.2 }, scene);
  const groundMat = new StandardMaterial('ground', scene);
  groundMat.diffuseColor = new Color3(0.42, 0.45, 0.4);
  groundMat.specularColor = Color3.Black();
  ground.material = groundMat;
  ground.isPickable = false;
  ground.freezeWorldMatrix();
  return { scene, camera };
}

function instancedMaterial(name: string, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = Color3.Black();
  return mat;
}

/** A unit box standing on y=0, scaled per instance. */
export function createBuildingMesh(scene: Scene): Mesh {
  const mesh = new Mesh('buildings', scene);
  const data = CreateBoxVertexData({ size: 1 });
  data.transform(Matrix.Translation(0, 0.5, 0));
  data.applyToMesh(mesh);
  mesh.material = instancedMaterial('buildings', scene);
  mesh.isPickable = false;
  return mesh;
}

export type CarDetail = 'box' | 'lowpoly';

/** A car pointing along +x: a plain box (12 triangles) or body + cabin + wheels (~200). */
export function createCarMesh(scene: Scene, detail: CarDetail): Mesh {
  const mesh = new Mesh(`cars-${detail}`, scene);
  let data: VertexData;
  if (detail === 'box') {
    data = CreateBoxVertexData({ width: 4.4, height: 1.5, depth: 1.9 });
    data.transform(Matrix.Translation(0, 0.75, 0));
  } else {
    data = CreateBoxVertexData({ width: 4.4, height: 0.8, depth: 1.9 });
    data.transform(Matrix.Translation(0, 0.75, 0));
    const cabin = CreateBoxVertexData({ width: 2.3, height: 0.65, depth: 1.7 });
    cabin.transform(Matrix.Translation(-0.3, 1.45, 0));
    const wheels: VertexData[] = [];
    for (const [x, z] of [[1.4, 0.85], [1.4, -0.85], [-1.4, 0.85], [-1.4, -0.85]]) {
      const wheel = CreateCylinderVertexData({ height: 0.3, diameter: 0.7, tessellation: 12 });
      wheel.transform(Matrix.RotationX(Math.PI / 2).multiply(Matrix.Translation(x, 0.35, z)));
      wheels.push(wheel);
    }
    data.merge([cabin, ...wheels]);
  }
  data.applyToMesh(mesh);
  mesh.material = instancedMaterial(`cars-${detail}`, scene);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

export function triangleCount(mesh: Mesh): number {
  return (mesh.getTotalIndices() / 3) * Math.max(1, mesh.thinInstanceCount);
}

/**
 * Writes a car's world matrix (Babylon layout, row vectors, translation in 12..14).
 * (dx, dz) is the unit heading on the ground plane.
 */
export function writeCarMatrix(m: Float32Array, i: number, x: number, z: number, dx: number, dz: number): void {
  const o = i * 16;
  m[o] = dx;
  m[o + 1] = 0;
  m[o + 2] = dz;
  m[o + 3] = 0;
  m[o + 4] = 0;
  m[o + 5] = 1;
  m[o + 6] = 0;
  m[o + 7] = 0;
  m[o + 8] = -dz;
  m[o + 9] = 0;
  m[o + 10] = dx;
  m[o + 11] = 0;
  m[o + 12] = x;
  m[o + 13] = 0;
  m[o + 14] = z;
  m[o + 15] = 1;
}

/** Random pleasant colours, RGBA per instance. */
export function randomColors(count: number, rand: () => number, palette: [number, number, number][]): Float32Array {
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const [r, g, b] = palette[Math.floor(rand() * palette.length)];
    const shade = 0.85 + rand() * 0.3;
    colors.set([r * shade, g * shade, b * shade, 1], i * 4);
  }
  return colors;
}

export const CAR_PALETTE: [number, number, number][] = [
  [0.85, 0.85, 0.87], [0.12, 0.12, 0.14], [0.55, 0.57, 0.6], [0.7, 0.1, 0.1], [0.1, 0.25, 0.55], [0.85, 0.75, 0.2], [0.2, 0.45, 0.25],
];

export const BUILDING_PALETTE: [number, number, number][] = [
  [0.82, 0.78, 0.7], [0.72, 0.62, 0.52], [0.6, 0.62, 0.66], [0.9, 0.88, 0.84], [0.66, 0.5, 0.42], [0.5, 0.55, 0.6],
];

/** Deterministic PRNG for scene layout (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Collects frame times between `begin()` calls. */
export class FrameTimer {
  private last = 0;
  readonly frames: number[] = [];
  readonly updates: number[] = [];
  readonly renders: number[] = [];

  begin(): void {
    const now = performance.now();
    if (this.last) this.frames.push(now - this.last);
    this.last = now;
  }

  reset(): void {
    this.last = 0;
    this.frames.length = 0;
    this.updates.length = 0;
    this.renders.length = 0;
  }
}
