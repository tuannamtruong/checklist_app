/**
 * Where the frames go. The app is fast on the seeded twelve rows and the
 * complaint is that it is *sometimes* choppy, which is a sentence about a
 * bigger tree and a longer log than any other script here builds — so this one
 * builds them and then watches the main thread while the app is used.
 *
 * It measures rather than asserts: every number is printed with the budget it
 * is being read against, and a regression is a number that moved. The four
 * things it watches are the four the app does on the main thread — the first
 * paint, a keystroke, the sync cycle, and a scroll — and `longtask` is the one
 * signal that covers all of them, because a task over 50ms is a frame nobody
 * got.
 *
 * Usage:
 *   NODE_PATH=/home/nam/.npm/_npx/e41f203b7505f1fb/node_modules node scripts/perf.mjs
 *   ... --rows 2000   how many rows to seed (default 800)
 *   ... --profile     sample the boot and name what it spent the time in
 *   ... --headed      watch it happen
 */

import { BASE_URL, buildIfNeeded, playwright, startPreview } from './lib/harness.mjs';

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const rows = Number(args[args.indexOf('--rows') + 1]) || 800;
/** Sample the boot and print where the time actually went, rather than that it went. */
const profiling = args.includes('--profile');

const DEVICE = '5eed0001';

/**
 * A tree of `rows` rows in folders of twenty, written as the device file the
 * app reads at startup — the same shape `harness.seedLog` writes, at a size a
 * person reaches after a year rather than in a demo.
 */
function bigLog(count) {
  const start = Date.UTC(2026, 0, 1, 9, 0, 0);
  const lines = [];
  let counter = 0;
  const emit = (fields) => {
    counter += 1;
    lines.push(JSON.stringify({ ...fields, c: counter, at: start + counter * 1000 }));
  };

  let folder = null;
  for (let i = 0; i < count; i += 1) {
    if (i % 20 === 0) {
      folder = `n_f${String(i).padStart(6, '0')}`;
      emit({ op: 'create', id: folder, parent: 'root', kind: 'folder', order: `a${i}` });
      emit({ op: 'set', id: folder, title: `Folder ${i / 20 + 1}` });
    }
    const id = `n_r${String(i).padStart(6, '0')}`;
    emit({ op: 'create', id, parent: folder, kind: 'task', order: `a${i % 20}` });
    emit({ op: 'set', id, title: `Row ${i + 1} of the long tree` });
    // Every tenth row is edited again, which is what a log looks like after a
    // while and what compaction exists for.
    if (i % 10 === 0) emit({ op: 'set', id, title: `Row ${i + 1} of the long tree, edited` });
  }
  emit({ op: 'create', id: 'n_note01', parent: 'root', kind: 'note', order: 'zz' });
  emit({ op: 'set', id: 'n_note01', title: 'A note at the end' });
  emit({ op: 'set', id: 'n_note01', body: 'Something to type into.' });

  const header = JSON.stringify({ v: 1, dev: DEVICE, clock: { [DEVICE]: counter } });
  return { ops: counter, text: [header, ...lines].join('\n') + '\n' };
}

/**
 * Self time per function, out of a CPU profile: the sampler hits a node, and a
 * node's self time is the deltas of the samples that hit it. Aggregated by
 * name and site rather than by node, because a hot function is called from
 * several places and the sum is the thing worth reading.
 */
function selfTimes(profile) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const total = new Map();
  for (let i = 0; i < profile.samples.length; i += 1) {
    const node = byId.get(profile.samples[i]);
    if (node === undefined) continue;
    const frame = node.callFrame;
    const site = frame.url ? `${frame.url.split('/').pop()}:${frame.lineNumber + 1}` : '';
    const key = `${frame.functionName || '(anonymous)'} ${site}`.trim();
    total.set(key, (total.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  }
  return [...total].sort((a, b) => b[1] - a[1]);
}

/** Long tasks, collected in the page and read back per phase. */
const OBSERVE = () => {
  const seen = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) seen.push(Math.round(entry.duration));
  }).observe({ entryTypes: ['longtask'] });
  Object.defineProperty(window, '__long', { value: seen });
};

function report(label, durations, budget) {
  const worst = durations.length === 0 ? 0 : Math.max(...durations);
  const total = durations.reduce((sum, one) => sum + one, 0);
  const verdict = worst <= budget ? 'ok  ' : 'SLOW';
  console.log(
    `${verdict} ${label}: ${durations.length} long tasks, worst ${worst}ms, ${total}ms total (budget ${budget}ms)`,
  );
  return worst <= budget;
}

async function main() {
  const log = bigLog(rows);
  console.log(`seeding ${rows} rows, ${log.ops} ops, ${(log.text.length / 1024).toFixed(0)}KiB`);

  // A profile of the minified bundle names everything `ko` — harness.mjs.
  await buildIfNeeded({ force: true, minify: !profiling });
  const server = await startPreview();
  const { chromium } = playwright();
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(
    ([device, text]) => {
      const file = `checklist:folder:checklist.${device}.ops.jsonl`;
      if (localStorage.getItem(file) !== null) return;
      localStorage.setItem('checklist.device', device);
      localStorage.setItem(file, text);
    },
    [DEVICE, log.text],
  );
  await context.addInitScript(OBSERVE);
  const page = await context.newPage();

  const drain = async () => {
    const seen = await page.evaluate(() => {
      const out = [...window.__long];
      window.__long.length = 0;
      return out;
    });
    return seen;
  };

  const cdp = profiling ? await context.newCDPSession(page) : null;
  if (cdp) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  }

  /**
   * One phase: run it, say what its long tasks were, and — when profiling —
   * name the functions the phase spent itself in. The profiler is started and
   * stopped around each one rather than once around the run, because "where
   * did the boot go" and "where did a keystroke go" are different questions
   * with different answers.
   */
  const phase = async (label, budget, run) => {
    await drain();
    if (cdp) await cdp.send('Profiler.start');
    await run();
    const long = await drain();
    const ok = report(label, long, budget);
    if (cdp) {
      const { profile } = await cdp.send('Profiler.stop');
      for (const [name, ms] of selfTimes(profile).slice(0, 8)) {
        if (ms >= 10) console.log(`       ${ms.toFixed(0).padStart(5)}ms  ${name}`);
      }
    }
    return ok;
  };

  let passed = true;
  try {
    // --- the first paint, which is decode + fold + resolve + render ---------
    let booted = 0;
    passed =
      (await phase('boot', 400, async () => {
        const from = Date.now();
        await page.goto(BASE_URL);
        await page.waitForSelector('[data-testid="row"]');
        booted = Date.now() - from;
      })) && passed;
    console.log(`     first row on screen after ${booted}ms`);

    // --- a keystroke in a row title ----------------------------------------
    // T-2's draft means the store is not touched per key, so this is the cost
    // of Svelte's own re-render and nothing else.
    passed =
      (await phase('typing in a title', 50, async () => {
        await page.locator('[data-testid="title"]').first().click();
        await page.keyboard.type('a change to the title', { delay: 25 });
      })) && passed;

    // --- a keystroke in a note body ----------------------------------------
    // K-7 stages the body into the store on a 1s pause, which re-folds the tree
    // and re-renders every row on screen. That is the one keystroke in the
    // application that costs a whole tree.
    await page.goto(`${BASE_URL}#/n/n_note01`);
    await page.waitForSelector('[data-testid="note-body"]');
    passed =
      (await phase('typing in a note body', 50, async () => {
        await page.locator('[data-testid="note-body"]').click();
        await page.keyboard.type('typing into a body for a while', { delay: 40 });
        await page.waitForTimeout(1500);
      })) && passed;

    // --- the sync cycles, which are S-19's +5s, +15s and +60s after an edit -
    // Every peer file read, every op re-folded, the tree resolved again. They
    // are on a timer, so they are the hitches that arrive while nothing is
    // being done at all — which is what "sometimes" means. Long enough to catch
    // the second one as well as the first, because a cost paid once per edit
    // and a cost paid once per cycle look identical over a single cycle.
    passed =
      (await phase('two idle sync cycles', 50, () => page.waitForTimeout(20_000))) && passed;

    // --- scrolling the list ------------------------------------------------
    await page.goto(BASE_URL);
    await page.waitForSelector('[data-testid="row"]');
    passed =
      (await phase('scrolling', 50, async () => {
        for (let i = 0; i < 20; i += 1) {
          await page.mouse.wheel(0, 400);
          await page.waitForTimeout(50);
        }
      })) && passed;

    const counted = await page.locator('[data-testid="row"]').count();
    console.log(`     ${counted} rows rendered`);
  } finally {
    await browser.close();
    await server.stop();
  }
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error('perf failed:', error);
  process.exit(1);
});
