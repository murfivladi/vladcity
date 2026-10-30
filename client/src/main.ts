import './style.css';
import { probeEnvironment } from './bench/env.ts';
import { recoverCrashedRun, runMemoryPhase } from './bench/memory.ts';
import { loadResults, saveResults, toMarkdown, type EnvInfo, type Results } from './bench/results.ts';
import type { EnginePreference } from './bench/scene.ts';
import { runSimBench } from './bench/sim.ts';

const ISSUE_URL = 'https://github.com/murfivladi/vladcity/issues/new';
/** Browsers and GitHub start refusing URLs somewhere above 8 KB. */
const MAX_URL = 7500;

type TestId = 'sim' | 'render' | 'live' | 'memory';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const results: Results = loadResults();
let running = false;
let stopRequested = false;

const crashed = recoverCrashedRun();
if (crashed) {
  results.memory = { ...results.memory, [crashed.phase]: crashed.result };
  saveResults(results);
}

// ---- UI helpers ---------------------------------------------------------------------------

function renderReport(): void {
  $('#report').textContent = toMarkdown(results);
  for (const id of ['sim', 'render', 'live', 'memory'] as TestId[]) {
    const done = id === 'memory' ? !!results.memory?.js || !!results.memory?.wasm : !!results[id];
    const el = $(`[data-status="${id}"]`);
    if (!el.classList.contains('bad')) el.textContent = done ? 'Готово ✓' : '';
  }
}

function setStatus(id: TestId, text: string, bad = false): void {
  const el = $(`[data-status="${id}"]`);
  el.textContent = text;
  el.classList.toggle('bad', bad);
}

function showBusy(text: string | null): void {
  $('#busy').hidden = text === null;
  if (text !== null) $('#busy-text').textContent = text;
}

function showStage(on: boolean): void {
  $('#stage').hidden = !on;
  $('#stage-text').textContent = '';
}

function note(text: string): void {
  $('#action-note').textContent = text;
}

function renderEnv(env: EnvInfo | null): void {
  const list = $('#env');
  if (!env) {
    list.innerHTML = '<li class="bad">Не удалось проверить окружение</li>';
    return;
  }
  const items: [string, 'ok' | 'bad' | 'warn', string][] = [];
  items.push(['Общая память (COOP/COEP)', env.crossOriginIsolated ? 'ok' : 'bad', env.crossOriginIsolated ? 'работает' : 'хостинг не отдаёт заголовки']);
  items.push(['Данные воркера без копирования', env.sabVisible ? 'ok' : 'bad', env.sabVisible ? 'видны' : 'нет']);
  items.push(['WebGPU', env.webgpu.startsWith('да') ? 'ok' : 'warn', env.webgpu.startsWith('да') ? env.webgpu.slice(2).trim() || 'есть' : `${env.webgpu}, будет WebGL2`]);
  items.push(['WebGL2', env.webgl2.startsWith('да') ? 'ok' : 'bad', env.webgl2.replace(/^да ?/, '') || 'нет']);
  items.push(['WASM SIMD', env.wasmSimd ? 'ok' : 'warn', env.wasmSimd ? 'есть' : 'нет, будет медленнее']);
  items.push(['Процессор', 'ok', `${env.cores} потоков${env.deviceMemoryGB ? `, ≥ ${env.deviceMemoryGB} ГБ ОЗУ` : ''}`]);
  list.replaceChildren(
    ...items.map(([name, state, detail]) => {
      const li = document.createElement('li');
      li.className = state;
      li.append(`${name} `);
      const small = document.createElement('small');
      small.textContent = detail;
      li.append(small);
      return li;
    }),
  );
}

// ---- Tests --------------------------------------------------------------------------------

function enginePref(): EnginePreference {
  return ($('#engine') as HTMLSelectElement).value as EnginePreference;
}

async function runTest(id: TestId): Promise<void> {
  if (running) return;
  running = true;
  stopRequested = false;
  document.querySelectorAll<HTMLButtonElement>('.tests button').forEach((b) => (b.disabled = true));
  setStatus(id, 'Идёт…');
  try {
    switch (id) {
      case 'sim':
        showBusy('Запускаем симуляцию…');
        results.sim = await runSimBench((t) => showBusy(t));
        break;
      case 'render': {
        showStage(true);
        const { runRenderBench } = await import('./bench/render.ts');
        results.render = await runRenderBench($('#viewport'), enginePref(), (t) => ($('#stage-text').textContent = t), () => stopRequested);
        break;
      }
      case 'live': {
        showStage(true);
        const { runLiveTest } = await import('./bench/live.ts');
        const n = Number(($('#live-n') as HTMLSelectElement).value);
        results.live = await runLiveTest($('#viewport'), enginePref(), n, (t) => ($('#stage-text').textContent = t), () => stopRequested);
        break;
      }
      case 'memory': {
        results.memory = {};
        for (const phase of ['wasm', 'js'] as const) {
          const name = phase === 'wasm' ? 'WebAssembly.Memory' : 'ArrayBuffer';
          showBusy(`${name}: выделяем память…`);
          results.memory[phase] = await runMemoryPhase(phase, (mb) => showBusy(`${name}: ${mb.toLocaleString('ru-RU')} МБ`));
          saveResults(results);
        }
        break;
      }
    }
    saveResults(results);
    setStatus(id, 'Готово ✓');
  } catch (err) {
    console.error(err);
    setStatus(id, `Ошибка: ${err instanceof Error ? err.message : String(err)}`, true);
  } finally {
    showBusy(null);
    showStage(false);
    running = false;
    document.querySelectorAll<HTMLButtonElement>('.tests button').forEach((b) => (b.disabled = false));
    renderReport();
  }
}

// ---- Wiring -------------------------------------------------------------------------------

const deviceInput = $('#device') as HTMLInputElement;
deviceInput.value = results.deviceLabel;
deviceInput.addEventListener('input', () => {
  results.deviceLabel = deviceInput.value.trim();
  saveResults(results);
  renderReport();
});

document.querySelectorAll<HTMLButtonElement>('.tests button').forEach((b) => {
  b.addEventListener('click', () => runTest(b.dataset.test as TestId));
});
$('#stop').addEventListener('click', () => (stopRequested = true));

async function copyReport(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(toMarkdown(results));
    return true;
  } catch {
    const range = document.createRange();
    range.selectNodeContents($('#report'));
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    return false;
  }
}

$('#copy').addEventListener('click', async () => {
  note((await copyReport()) ? 'Скопировано.' : 'Не удалось скопировать автоматически — текст выделен, скопируйте вручную.');
});

$('#send').addEventListener('click', () => {
  if (!results.deviceLabel) {
    note('Сначала назовите устройство в поле сверху.');
    deviceInput.focus();
    return;
  }
  const title = `Бенчмарк фазы 1: ${results.deviceLabel}`;
  const md = toMarkdown(results);
  let url = `${ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(md)}`;
  const tooLong = url.length > MAX_URL;
  if (tooLong) {
    const body = 'Результаты скопированы в буфер обмена — вставьте их сюда.';
    url = `${ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  }
  // Open first, synchronously: mobile browsers block pop-ups opened after an await.
  window.open(url, '_blank', 'noopener');
  void copyReport();
  note(tooLong ? 'Отчёт длинный: он скопирован, вставьте его в открывшуюся форму.' : 'Открыта форма на GitHub, осталось нажать «Submit new issue».');
});

$('#download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vladcity-bench-${(results.deviceLabel || 'device').replace(/[^\p{L}\p{N}]+/gu, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#reset').addEventListener('click', () => {
  if (!confirm('Удалить все результаты на этом устройстве?')) return;
  const label = results.deviceLabel;
  for (const key of Object.keys(results) as (keyof Results)[]) {
    if (key !== 'version') delete results[key];
  }
  results.deviceLabel = label;
  saveResults(results);
  document.querySelectorAll('[data-status]').forEach((el) => {
    el.textContent = '';
    el.classList.remove('bad');
  });
  renderReport();
  void probe();
});

async function probe(): Promise<void> {
  try {
    results.env = await probeEnvironment();
    saveResults(results);
    renderEnv(results.env);
  } catch (err) {
    console.error(err);
    renderEnv(null);
  }
  renderReport();
}

renderReport();
void probe();
