// Memory limit test, main-thread side. Progress is written to localStorage before every
// allocation, so if the phone kills the whole tab we still know how far it got.
import type { MemoryPhase, MemoryRequest, MemoryResponse } from './memory.shared.ts';
import type { MemoryPhaseResult } from './results.ts';

const PROGRESS_KEY = 'vladcity.bench.memory-progress';
const STEP_MB = 64;
/** wasm32 cannot address more than 4 GB; JS gets the same cap to keep desktops responsive. */
const CAP_MB = 4096;
/** No message for this long means the worker died silently. */
const WATCHDOG_MS = 20_000;

interface Progress {
  phase: MemoryPhase;
  lastOkMB: number;
  running: boolean;
}

function saveProgress(p: Progress | null): void {
  try {
    if (p) localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
    else localStorage.removeItem(PROGRESS_KEY);
  } catch {
    // Without storage a tab crash simply goes unrecorded.
  }
}

/** If the previous run took the tab down, returns what it reached. */
export function recoverCrashedRun(): { phase: MemoryPhase; result: MemoryPhaseResult } | null {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Progress;
    saveProgress(null);
    if (!p.running) return null;
    return { phase: p.phase, result: { maxMB: p.lastOkMB, capped: false, outcome: 'tab-crash', detail: '' } };
  } catch {
    return null;
  }
}

export function runMemoryPhase(phase: MemoryPhase, onProgress: (mb: number) => void): Promise<MemoryPhaseResult> {
  const worker = new Worker(new URL('./memory.worker.ts', import.meta.url), { type: 'module' });
  let lastOkMB = 0;
  saveProgress({ phase, lastOkMB, running: true });

  return new Promise<MemoryPhaseResult>((resolve) => {
    let watchdog = 0;
    const finish = (result: MemoryPhaseResult) => {
      clearTimeout(watchdog);
      worker.terminate();
      saveProgress(null);
      resolve(result);
    };
    const arm = () => {
      clearTimeout(watchdog);
      watchdog = window.setTimeout(
        () => finish({ maxMB: lastOkMB, capped: false, outcome: 'worker-crash', detail: 'воркер перестал отвечать' }),
        WATCHDOG_MS,
      );
    };
    worker.onmessage = (e: MessageEvent<MemoryResponse>) => {
      const msg = e.data;
      arm();
      if (msg.type === 'progress') {
        lastOkMB = msg.mb;
        saveProgress({ phase, lastOkMB, running: true });
        onProgress(msg.mb);
      } else if (msg.type === 'done') {
        finish({ maxMB: msg.mb, capped: msg.capped, outcome: msg.capped ? 'ok' : 'error', detail: msg.error });
      }
    };
    worker.onerror = (e) => finish({ maxMB: lastOkMB, capped: false, outcome: 'worker-crash', detail: e.message || '' });
    arm();
    const req: MemoryRequest = { phase, stepMB: STEP_MB, capMB: CAP_MB };
    worker.postMessage(req);
  });
}
