// Environment probe: what the browser offers (isolation, SAB, WASM features, GPU APIs)
// and how fast the main thread can talk to a worker.
import type { EnvInfo } from './results.ts';
import { wasmSimdSupported } from './wasm.ts';

interface NavigatorExtras {
  deviceMemory?: number;
  gpu?: { requestAdapter(): Promise<{ info?: { vendor?: string; architecture?: string; description?: string } } | null> };
}

function wasmSharedMemorySupported(): boolean {
  try {
    const mem = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    return mem.buffer instanceof SharedArrayBuffer;
  } catch {
    return false;
  }
}

async function probeWebGPU(): Promise<string> {
  const gpu = (navigator as NavigatorExtras).gpu;
  if (!gpu) return 'нет API';
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return 'API есть, адаптера нет';
    const info = adapter.info;
    const name = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' ');
    return `да${name ? ` (${name})` : ''}`;
  } catch (err) {
    return `ошибка: ${String(err)}`;
  }
}

function probeWebGL2(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'нет';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return `да (${String(renderer)})`;
  } catch {
    return 'нет';
  }
}

function nextMessage<T>(worker: Worker, type: string): Promise<T> {
  return new Promise((resolve) => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === type) {
        worker.removeEventListener('message', handler);
        resolve(e.data as T);
      }
    };
    worker.addEventListener('message', handler);
  });
}

async function measureWorkerLinks(): Promise<Pick<EnvInfo, 'postMessageRttMs' | 'atomicsRttMs' | 'sabVisible'>> {
  const worker = new Worker(new URL('./sab.worker.ts', import.meta.url), { type: 'module' });
  try {
    const rounds = 200;
    // Warm the channel up before timing it.
    for (let i = 0; i < 10; i++) {
      worker.postMessage({ type: 'ping', i });
      await nextMessage(worker, 'pong');
    }
    let t = performance.now();
    for (let i = 0; i < rounds; i++) {
      worker.postMessage({ type: 'ping', i });
      await nextMessage(worker, 'pong');
    }
    const postMessageRttMs = (performance.now() - t) / rounds;

    if (typeof SharedArrayBuffer === 'undefined' || !crossOriginIsolated) {
      return { postMessageRttMs, atomicsRttMs: null, sabVisible: null };
    }

    const data = new SharedArrayBuffer(4 * 1_000_000);
    worker.postMessage({ type: 'fill', data });
    await nextMessage(worker, 'filled');
    const view = new Float32Array(data);
    const sabVisible = view[0] === 0 && view[123_457] === 123_457 * 0.5 && view[999_999] === 999_999 * 0.5;

    let atomicsRttMs: number | null = null;
    const waitAsync = (Atomics as unknown as { waitAsync?: typeof Atomics.waitAsync }).waitAsync;
    if (waitAsync) {
      const flags = new Int32Array(new SharedArrayBuffer(8));
      worker.postMessage({ type: 'atomics', flags: flags.buffer, rounds });
      await nextMessage(worker, 'atomics-ready');
      t = performance.now();
      for (let round = 1; round <= rounds; round++) {
        Atomics.store(flags, 0, round);
        Atomics.notify(flags, 0);
        const res = Atomics.waitAsync(flags, 1, round - 1, 2000);
        if (res.async) await res.value;
      }
      atomicsRttMs = (performance.now() - t) / rounds;
    }
    return { postMessageRttMs, atomicsRttMs, sabVisible };
  } finally {
    worker.terminate();
  }
}

export async function probeEnvironment(): Promise<EnvInfo> {
  const nav = navigator as Navigator & NavigatorExtras;
  const perfMemory = (performance as unknown as { memory?: { jsHeapSizeLimit: number } }).memory;
  const links = await measureWorkerLinks().catch(() => ({ postMessageRttMs: null, atomicsRttMs: null, sabVisible: null }));
  return {
    userAgent: navigator.userAgent,
    cores: navigator.hardwareConcurrency || 1,
    deviceMemoryGB: nav.deviceMemory ?? null,
    jsHeapLimitMB: perfMemory ? Math.round(perfMemory.jsHeapSizeLimit / 2 ** 20) : null,
    screen: `${screen.width}×${screen.height}`,
    dpr: Math.round(devicePixelRatio * 100) / 100,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    atomicsWaitAsync: typeof (Atomics as unknown as { waitAsync?: unknown }).waitAsync === 'function',
    wasmSimd: wasmSimdSupported(),
    wasmSharedMemory: wasmSharedMemorySupported(),
    webgpu: await probeWebGPU(),
    webgl2: probeWebGL2(),
    ...links,
  };
}
