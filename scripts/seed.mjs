/**
 * Opens the app in a real browser with a small tree already in it, so a change
 * can be looked at rather than reasoned about.
 *
 * The profile is kept in `.dev-profile/`, so the device id, the collapse state
 * and the op log survive between runs — reopening it is the same reload the
 * user's second visit is.
 *
 * Usage:
 *   NODE_PATH=/home/nam/.npm/_npx/e41f203b7505f1fb/node_modules node scripts/seed.mjs
 *   ... --fresh     throw the stored folder away and seed it again
 *   ... --headless  no window, for checking that it boots at all
 */

import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BASE_URL, ROOT_DIR, buildIfNeeded, playwright, seedInto, startPreview } from './lib/harness.mjs';

const args = process.argv.slice(2);
const fresh = args.includes('--fresh');
const headless = args.includes('--headless');
const profile = join(ROOT_DIR, '.dev-profile');

async function main() {
  if (fresh) await rm(profile, { recursive: true, force: true });
  await buildIfNeeded({ force: true });
  const server = await startPreview();
  const { chromium } = playwright();

  const context = await chromium.launchPersistentContext(profile, {
    headless,
    viewport: { width: 1280, height: 860 },
  });
  if (fresh) await seedInto(context);

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(BASE_URL);
  // Attached, not visible: an empty tree renders a zero-height div, and "you
  // have no rows yet" is a state worth opening the window on, not a timeout.
  await page.waitForSelector('[data-testid="tree"]', { state: 'attached' });
  console.log(`serving ${BASE_URL} — close the window to stop`);

  if (headless) {
    const rows = await page.locator('[data-testid="row"]').count();
    console.log(`ok  booted with ${rows} visible rows`);
    await context.close();
    await server.stop();
    return;
  }

  await context.waitForEvent('close', { timeout: 0 });
  await server.stop();
}

main().catch((error) => {
  console.error('seed failed:', error);
  process.exit(1);
});
