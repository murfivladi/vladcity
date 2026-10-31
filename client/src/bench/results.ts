// Benchmark results: one object per device, kept in localStorage between tests
// (the render and memory tests can reload the page), exported as Markdown for the report.
import type { BenchRow, Model } from './protocol.ts';
import type { WasmVariant } from './wasm.ts';

export interface EnvInfo {
  userAgent: string;
  cores: number;
  deviceMemoryGB: number | null;
  jsHeapLimitMB: number | null;
  screen: string;
  dpr: number;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  atomicsWaitAsync: boolean;
  wasmSimd: boolean;
  wasmSharedMemory: boolean;
  webgpu: string;
  webgl2: string;
  postMessageRttMs: number | null;
  atomicsRttMs: number | null;
  sabVisible: boolean | null;
  /** Server sent COOP/COEP for the page / for a script file. */
  headersPage: boolean | null;
  headersScript: boolean | null;
}

export interface SimResult {
  single: (BenchRow & { variant: WasmVariant })[];
  parallel: { model: Model; n: number; workers: number; wallAvg: number; wallP95: number; maxWorkerAvg: number }[];
}

export interface RenderScenarioResult {
  id: string;
  label: string;
  cars: number;
  buildings: number;
  triangles: number;
  fps: number;
  frameP95: number;
  updateMs: number;
  renderCpuMs: number;
  /** A frame took longer than the watchdog allows; heavier scenes were skipped. */
  stalled?: boolean;
}

export interface RenderResult {
  engine: string;
  gpu: string;
  resolution: string;
  scenarios: RenderScenarioResult[];
}

export interface LiveResult {
  simAgents: number;
  rendered: number;
  tickMs: number;
  /** Render buffer fill + copy into the SharedArrayBuffer. */
  publishMs: number;
  ticksPerSec: number;
  targetTicksPerSec: number;
  fps: number;
  frameP95: number;
  matrixMs: number;
  engine: string;
}

export interface MemoryPhaseResult {
  maxMB: number;
  capped: boolean;
  outcome: 'ok' | 'error' | 'worker-crash' | 'tab-crash';
  detail: string;
}

export interface Results {
  version: 1;
  deviceLabel: string;
  updated: string;
  env?: EnvInfo;
  sim?: SimResult;
  render?: RenderResult;
  live?: LiveResult;
  memory?: { wasm?: MemoryPhaseResult; js?: MemoryPhaseResult };
}

const KEY = 'vladcity.bench.v1';

export function loadResults(): Results {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Results;
      if (parsed.version === 1) return parsed;
    }
  } catch {
    // Storage blocked or corrupted: start fresh.
  }
  return { version: 1, deviceLabel: '', updated: new Date().toISOString() };
}

export function saveResults(r: Results): void {
  r.updated = new Date().toISOString();
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // Results still live in memory for this session.
  }
}

const f = (v: number, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : '—');
const yes = (b: boolean | null) => (b === null ? '—' : b ? 'да' : 'нет');
const num = (n: number) => n.toLocaleString('ru-RU').replace(/ /g, ' ');

export function toMarkdown(r: Results): string {
  const out: string[] = [];
  out.push(`## Бенчмарк фазы 1: ${r.deviceLabel || 'устройство без названия'}`);
  out.push('');
  out.push(`Дата: ${r.updated.slice(0, 16).replace('T', ' ')} UTC`);
  if (r.env) {
    const e = r.env;
    out.push(`Браузер: \`${e.userAgent}\``);
    out.push('');
    out.push('### Окружение');
    out.push('| Параметр | Значение |');
    out.push('|---|---|');
    out.push(`| crossOriginIsolated (COOP/COEP) | ${yes(e.crossOriginIsolated)} |`);
    out.push(`| Заголовки сервера: страница / скрипты | ${yes(e.headersPage ?? null)} / ${yes(e.headersScript ?? null)} |`);
    out.push(`| SharedArrayBuffer | ${yes(e.sharedArrayBuffer)} |`);
    out.push(`| Данные воркера видны без копирования | ${yes(e.sabVisible)} |`);
    out.push(`| Atomics.waitAsync | ${yes(e.atomicsWaitAsync)} |`);
    out.push(`| WASM SIMD / общая память WASM | ${yes(e.wasmSimd)} / ${yes(e.wasmSharedMemory)} |`);
    out.push(`| WebGPU | ${e.webgpu} |`);
    out.push(`| WebGL2 | ${e.webgl2} |`);
    out.push(`| Ядер CPU | ${e.cores} |`);
    out.push(`| deviceMemory / лимит JS-кучи | ${e.deviceMemoryGB ?? '—'} ГБ / ${e.jsHeapLimitMB ?? '—'} МБ |`);
    out.push(`| Экран (CSS px × DPR) | ${e.screen} × ${e.dpr} |`);
    out.push(`| Пинг воркера: postMessage / Atomics | ${e.postMessageRttMs === null ? '—' : f(e.postMessageRttMs, 3)} / ${e.atomicsRttMs === null ? '—' : f(e.atomicsRttMs, 3)} мс |`);
  }
  if (r.sim) {
    out.push('');
    out.push('### Симуляция: один воркер');
    out.push('| WASM | Модель | Агентов | мс/тик | p95 | нс/агент | байт/агент | checksum |');
    out.push('|---|---|---|---|---|---|---|---|');
    for (const s of r.sim.single) {
      out.push(`| ${s.variant} | ${s.model} | ${num(s.n)} | ${f(s.avg)} | ${f(s.p95)} | ${f(s.nsPerAgent, 1)} | ${s.bytesPerAgent} | ${s.checksum} |`);
    }
    if (r.sim.parallel.length) {
      out.push('');
      out.push('### Симуляция: несколько воркеров (мир поделён на части)');
      out.push('| Модель | Агентов | Воркеров | мс/тик (с пересылкой) | p95 | самый медленный воркер, мс |');
      out.push('|---|---|---|---|---|---|');
      for (const p of r.sim.parallel) {
        out.push(`| ${p.model} | ${num(p.n)} | ${p.workers} | ${f(p.wallAvg)} | ${f(p.wallP95)} | ${f(p.maxWorkerAvg)} |`);
      }
    }
  }
  if (r.render) {
    out.push('');
    out.push(`### Рендер: ${r.render.engine}, ${r.render.resolution}`);
    out.push(`GPU: ${r.render.gpu}`);
    out.push('');
    out.push('| Сцена | Треугольников | FPS | кадр p95, мс | матрицы машин, мс | CPU рендера, мс |');
    out.push('|---|---|---|---|---|---|');
    for (const s of r.render.scenarios) {
      if (s.stalled) {
        out.push(`| ${s.label} | ${num(s.triangles)} | завис: кадр дольше ${f(s.frameP95 / 1000, 0)} с, дальше не тестировали | — | — | — |`);
      } else {
        out.push(`| ${s.label} | ${num(s.triangles)} | ${f(s.fps, 1)} | ${f(s.frameP95, 1)} | ${f(s.updateMs)} | ${f(s.renderCpuMs)} |`);
      }
    }
  }
  if (r.live) {
    const l = r.live;
    out.push('');
    out.push('### Живой тест: воркер → SharedArrayBuffer → рендер');
    out.push('| Агентов | Отрисовано | мс/тик | передача в SAB, мс | тиков/с (цель) | FPS | кадр p95, мс | матрицы, мс | Движок |');
    out.push('|---|---|---|---|---|---|---|---|---|');
    out.push(`| ${num(l.simAgents)} | ${num(l.rendered)} | ${f(l.tickMs)} | ${f(l.publishMs)} | ${f(l.ticksPerSec, 1)} (${l.targetTicksPerSec}) | ${f(l.fps, 1)} | ${f(l.frameP95, 1)} | ${f(l.matrixMs)} | ${l.engine} |`);
  }
  if (r.memory) {
    out.push('');
    out.push('### Память');
    out.push('| Тест | Удалось выделить | Чем закончилось |');
    out.push('|---|---|---|');
    const row = (name: string, m?: MemoryPhaseResult) => {
      if (!m) return;
      const outcome = { ok: 'упёрлись в предел теста', error: 'отказ выделения', 'worker-crash': 'воркер упал', 'tab-crash': 'вкладка перезагрузилась' }[m.outcome];
      out.push(`| ${name} | ${m.capped ? '≥ ' : ''}${num(m.maxMB)} МБ | ${outcome}${m.detail ? `: ${m.detail}` : ''} |`);
    };
    row('WebAssembly.Memory', r.memory.wasm);
    row('ArrayBuffer (JS)', r.memory.js);
  }
  return out.join('\n');
}
