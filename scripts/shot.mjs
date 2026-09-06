/**
 * Screenshots the seeded app at named routes and widths, so a change to the
 * shell can be looked at rather than described.
 *
 * `ui-smoke` asserts and `seed` opens a window a person watches; neither leaves
 * a picture behind on its own, and a layout change is the one kind of work that
 * is only finished when someone has seen it. This is that third thing: a fresh
 * profile, the seed tree, and one PNG per route per width in `ui-shots/`.
 *
 * Usage:
 *   NODE_PATH=/home/nam/.npm/_npx/e41f203b7505f1fb/node_modules node scripts/shot.mjs
 *   ... --routes '#/,#/done'   the hashes to visit (default: those two)
 *   ... --widths 1280,420      viewport widths (default: those two)
 *   ... --out ui-shots         where the PNGs land
 */

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BASE_URL, ROOT_DIR, buildIfNeeded, playwright, seedInto, startPreview } from './lib/harness.mjs';

const args = process.argv.slice(2);

/** `--flag value`, or the default when the flag is absent. */
function flag(name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at === -1 || at === args.length - 1 ? fallback : args[at + 1];
}

const routes = flag('routes', '#/,#/done').split(',');
const widths = flag('widths', '1280,420').split(',').map(Number);
const outDir = join(ROOT_DIR, flag('out', 'ui-shots'));

/** A file name a person can read back: `done-1280.png`, `root-420.png`. */
function shotName(route, width) {
  const slug = route.replace(/^#\/?/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return `${slug || 'root'}-${width}.png`;
}

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await buildIfNeeded({ force: true });
  const server = await startPreview();
  const { chromium } = playwright();

  // A throwaway context rather than `seed`'s persistent profile: a shot of a
  // sidebar the last run happened to have resized is a shot of nothing.
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await seedInto(context);
  const page = await context.newPage();

  const written = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 860 });
    for (const route of routes) {
      await page.goto(BASE_URL + route);
      await page.waitForSelector('[data-testid="sidebar"]');
      const path = join(outDir, shotName(route, width));
      await page.screenshot({ path });
      written.push(path);
    }
  }

  await browser.close();
  await server.stop();
  for (const path of written) console.log(path);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
