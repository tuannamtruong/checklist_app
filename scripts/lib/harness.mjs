/**
 * Shared plumbing for the scripts that drive the real app in a real browser:
 * the Playwright bridge, the preview server on this project's port, and a seed
 * op log written the way the app itself would have written it.
 *
 * Seeding through the folder rather than through the UI is deliberate. It
 * exercises the load path — decode the JSONL, fold the ops, resolve the tree —
 * which is the path a reload takes and the path M2's peers will arrive on.
 *
 * Usage: imported by scripts/seed.mjs and scripts/ui-smoke.mjs.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** Playwright lives outside the project on this machine — hence NODE_PATH. */
export function playwright() {
  try {
    return require('playwright');
  } catch (error) {
    throw new Error(
      'playwright not found. Run with NODE_PATH set, for example:\n' +
        '  NODE_PATH=/home/nam/.npm/_npx/e41f203b7505f1fb/node_modules node scripts/ui-smoke.mjs\n' +
        `original error: ${error.message}`,
    );
  }
}

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Port 38531 is this project's, in development as in the Windows bundle. */
export const PORT = 38531;
export const BASE_URL = `http://127.0.0.1:${PORT}/`;

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: ROOT_DIR, stdio: 'inherit', ...options });
    child.on('error', rejectRun);
    child.on('exit', (code) =>
      code === 0 ? resolveRun() : rejectRun(new Error(`${command} exited with ${code}`)),
    );
  });
}

export async function buildIfNeeded({ force = false } = {}) {
  if (!force && existsSync(join(ROOT_DIR, 'dist', 'index.html'))) return;
  await run('npx', ['vite', 'build']);
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not up yet; the server is still binding.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server did not answer on ${url} within ${timeoutMs}ms`);
}

/**
 * Serves `dist/` — the same bundle a static host would serve.
 *
 * Its own process group, because `npx` is a shell wrapper that does not pass a
 * signal to the vite it spawned: killing the wrapper alone leaves the server
 * holding port 38531, and the next run fails on `strictPort` for a reason that
 * has nothing to do with the change being tested.
 */
export async function startPreview() {
  const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stderr.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`));
  await waitForServer(BASE_URL);
  return {
    async stop() {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // Already gone, which is the outcome this was asking for.
      }
    },
  };
}

// Eight hex characters, because that is what the app accepts as a device id —
// anything else and it mints a fresh one and never reads the seeded file.
const DEVICE = '5eed0001';

function op(fields, counter, at) {
  return JSON.stringify({ ...fields, c: counter, at });
}

/**
 * A small tree that covers every kind and two levels of nesting, written as the
 * device file the app reads at startup — glossary.md's op log.
 *
 * It seeds one ticked row and one deleted one on purpose. Both are invisible in
 * the tree (T-11, T-7) and both are what the Done view has to show (T-12), so a
 * seeded window and a smoke run start with that view already populated.
 */
export function seedLog(device = DEVICE) {
  const start = Date.UTC(2026, 7, 18, 9, 0, 0);
  const lines = [];
  let counter = 0;
  const at = () => start + counter * 1000;
  const emit = (fields) => {
    counter += 1;
    lines.push(op(fields, counter, at()));
  };

  const rows = [
    { id: 'n_seed0001', parent: 'root', kind: 'list', order: 'a1', title: 'Shopping' },
    { id: 'n_seed0002', parent: 'n_seed0001', kind: 'task', order: 'a1', title: 'Milk' },
    { id: 'n_seed0003', parent: 'n_seed0001', kind: 'task', order: 'a2', title: 'Bread', done: true },
    { id: 'n_seed0004', parent: 'n_seed0001', kind: 'task', order: 'a3', title: 'Coffee beans' },
    { id: 'n_seed0005', parent: 'root', kind: 'folder', order: 'a2', title: 'House' },
    { id: 'n_seed0006', parent: 'n_seed0005', kind: 'list', order: 'a1', title: 'Kitchen' },
    { id: 'n_seed0007', parent: 'n_seed0006', kind: 'task', order: 'a1', title: 'Descale the kettle' },
    { id: 'n_seed0008', parent: 'root', kind: 'note', order: 'a3', title: 'Trip notes' },
    { id: 'n_seed0009', parent: 'n_seed0008', kind: 'task', order: 'a1', title: 'Book the ferry' },
    { id: 'n_seed0010', parent: 'root', kind: 'note', order: 'a4', title: 'Old receipts', deleted: true },
  ];

  for (const row of rows) {
    emit({ op: 'create', id: row.id, parent: row.parent, kind: row.kind, order: row.order });
    emit({ op: 'set', id: row.id, title: row.title });
    if (row.done) emit({ op: 'set', id: row.id, done: true });
    if (row.deleted) emit({ op: 'delete', id: row.id });
  }
  emit({
    op: 'set',
    id: 'n_seed0008',
    body: 'Ferry leaves at 07:40.\nPassports are in the top drawer.',
  });

  const header = JSON.stringify({ v: 1, dev: device, clock: { [device]: counter } });
  return { device, text: [header, ...lines].join('\n') + '\n' };
}

const PEER = '5eed0002';

/**
 * A second device's file, for the checks only a real browser can answer: does a
 * peer's row arrive without a reload, and does a race raise the nav entry.
 *
 * It is written by hand rather than by a second app instance because that is
 * what a Sync Folder delivers — bytes, from a device that is not here. The
 * title op deliberately races the seed's own: `at` is later, so the peer wins,
 * and neither file carries a receipt for the other, so the two are concurrent
 * rather than ordered — sync-flow.md §2.1.
 */
export function peerLog(device = PEER) {
  const at = Date.UTC(2026, 7, 18, 10, 0, 0);
  const lines = [
    { op: 'create', id: 'n_peer0001', parent: 'n_seed0001', kind: 'task', order: 'a5', c: 1, at },
    { op: 'set', id: 'n_peer0001', title: 'Tea', c: 2, at: at + 1_000 },
    { op: 'set', id: 'n_seed0004', title: 'Coffee', c: 3, at: at + 2_000 },
  ].map((line) => JSON.stringify(line));
  const header = JSON.stringify({ v: 1, dev: device, clock: { [device]: 3 } });
  return { device, name: `checklist.${device}.ops.jsonl`, text: [header, ...lines].join('\n') + '\n' };
}

/**
 * Puts the seed in place before the page's own scripts run.
 *
 * Only into an empty folder. The init script runs on every navigation, so
 * seeding unconditionally would overwrite whatever the app had just written and
 * make every reload look like it had lost the edit.
 */
export async function seedInto(context, { device, text } = seedLog()) {
  await context.addInitScript(
    ([deviceId, content]) => {
      const file = `checklist:folder:checklist.${deviceId}.ops.jsonl`;
      if (localStorage.getItem(file) !== null) return;
      localStorage.setItem('checklist.device', deviceId);
      localStorage.setItem(file, content);
    },
    [device, text],
  );
}
