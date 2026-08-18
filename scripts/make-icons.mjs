/**
 * Renders the PWA's PNG icons from the two SVGs in `public/icons/`.
 *
 * X-3 wants the app installable and X-4 wants a maskable Android icon, and both
 * want PNGs — a manifest icon may be an SVG but Android's launcher is the one
 * consumer that reliably will not take one. The SVGs stay the source of truth;
 * this script is how they become the files the manifest names, so nobody has to
 * hand-edit a binary.
 *
 * Chromium is the renderer because it is already on this machine for the UI
 * tests, and because it is the same rasteriser the installed app will use.
 *
 * Usage:
 *   node scripts/make-icons.mjs
 */

import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright is installed globally on this machine rather than in the project,
// so ESM `import` cannot resolve it — code-standard.md §1 forbids hardcoding the
// path, hence NODE_PATH plus this bridge.
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const iconDir = join(root, 'public', 'icons');

/** @type {{ source: string; out: string; size: number }[]} */
const TARGETS = [
  { source: 'icon.svg', out: 'icon-192.png', size: 192 },
  { source: 'icon.svg', out: 'icon-512.png', size: 512 },
  { source: 'icon-maskable.svg', out: 'icon-maskable-512.png', size: 512 },
];

async function main() {
  await mkdir(iconDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const target of TARGETS) {
      const svg = await readFile(join(iconDir, target.source), 'utf8');
      const page = await browser.newPage({
        viewport: { width: target.size, height: target.size },
        deviceScaleFactor: 1,
      });
      await page.setContent(
        `<!doctype html><style>html,body{margin:0;padding:0}svg{display:block;width:${target.size}px;height:${target.size}px}</style>${svg}`,
      );
      await page.screenshot({ path: join(iconDir, target.out), omitBackground: true });
      await page.close();
      console.log(`ok  ${target.out}  ${target.size}x${target.size}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('make-icons failed:', error);
  process.exit(1);
});
