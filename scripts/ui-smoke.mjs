/**
 * Drives the built app in Chromium and asserts the things only a real browser
 * can answer: the keyboard model of requirements.md §3.1, that every keyboard
 * action is also in the row menu, that an edit survives a reload through the op
 * log, and that the layout holds at a phone width.
 *
 * Every check reports and the run fails at the end — test.md §1. One failure
 * still shows the state of the rest.
 *
 * Screenshots land in `ui-smoke/`, which is git-ignored.
 *
 * Usage:
 *   NODE_PATH=/home/nam/.npm/_npx/e41f203b7505f1fb/node_modules node scripts/ui-smoke.mjs
 *   ... --headed   watch it happen
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BASE_URL, ROOT_DIR, buildIfNeeded, playwright, seedInto, startPreview } from './lib/harness.mjs';

const headed = process.argv.includes('--headed');
const shots = join(ROOT_DIR, 'ui-smoke');

/** The actions keyboard.ts binds; the row menu owes every one of them. */
const KEY_BOUND_ACTIONS = [
  'new-below',
  'new-inside',
  'indent',
  'outdent',
  'move-up',
  'move-down',
  'delete',
];

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const WRITE_SETTLE_MS = 600;

async function main() {
  await mkdir(shots, { recursive: true });
  await buildIfNeeded({ force: true });
  const server = await startPreview();
  const { chromium } = playwright();
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await seedInto(context);

  const consoleErrors = [];
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  try {
    await page.goto(BASE_URL);
    await page.waitForSelector('[data-testid="tree"]');

    // --- the seeded folder actually loaded -------------------------------
    const titles = await page.locator('[data-testid="row"] [data-testid="title"]').evaluateAll(
      (inputs) => inputs.map((input) => input.value),
    );
    check(
      'the op log in the folder is what the tree is built from',
      titles.includes('Shopping') && titles.includes('Milk') && titles.includes('Descale the kettle'),
      `${titles.length} rows`,
    );
    const sidebar = (await page.locator('[data-testid="sidebar-link"]').allInnerTexts()).map((t) => t.trim());
    check(
      'the sidebar shows folders and lists only — T-10',
      sidebar.length === 3 && sidebar.includes('Kitchen') && !sidebar.includes('Trip notes'),
      sidebar.join(','),
    );

    // --- the row menu carries every keyboard action — §3.1 ----------------
    const milkRow = await rowByTitle(page, 'Milk');
    await milkRow.locator('[data-testid="row-menu-button"]').click();
    const menuActions = await page
      .locator('[data-testid="row-menu"] [data-action]')
      .evaluateAll((buttons) => buttons.map((button) => button.dataset.action));
    const missing = KEY_BOUND_ACTIONS.filter((action) => !menuActions.includes(action));
    check('every keyboard action is in the row menu', missing.length === 0, missing.join(', '));
    check(
      'the menu teaches the keys',
      (await page.locator('[data-testid="row-menu"] kbd').allInnerTexts()).join(' ').includes('Alt-↑'),
    );
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="row-menu"]').waitFor({ state: 'detached' });

    // --- Enter, typing, and the commit on blur ---------------------------
    await (await rowByTitle(page, 'Coffee beans')).locator('[data-testid="title"]').click();
    await page.keyboard.press('Enter');
    await page.keyboard.type('Oat milk');
    await page.keyboard.press('ArrowUp');
    check(
      'Enter makes a sibling below, and the typed title sticks',
      (await titlesUnder(page, 'Shopping')).join('|') === 'Milk|Coffee beans|Oat milk',
      (await titlesUnder(page, 'Shopping')).join('|'),
    );

    // --- Tab and Shift-Tab ------------------------------------------------
    await (await rowByTitle(page, 'Oat milk')).locator('[data-testid="title"]').click();
    await page.keyboard.press('Tab');
    check(
      'Tab indents under the sibling above — T-3',
      (await depthOf(page, 'Oat milk')) === 2 && (await titlesUnder(page, 'Coffee beans')).join('|') === 'Oat milk',
      `depth ${await depthOf(page, 'Oat milk')}`,
    );
    await page.keyboard.press('Shift+Tab');
    check(
      'Shift-Tab puts it back as the parent’s next sibling',
      (await depthOf(page, 'Oat milk')) === 1,
      `depth ${await depthOf(page, 'Oat milk')}`,
    );

    // --- Alt-↑ / Alt-↓ ----------------------------------------------------
    await page.keyboard.press('Alt+ArrowUp');
    check(
      'Alt-↑ moves among siblings — T-4',
      (await titlesUnder(page, 'Shopping')).join('|') === 'Milk|Oat milk|Coffee beans',
      (await titlesUnder(page, 'Shopping')).join('|'),
    );
    await page.keyboard.press('Alt+ArrowDown');
    check(
      'Alt-↓ moves it back',
      (await titlesUnder(page, 'Shopping')).join('|') === 'Milk|Coffee beans|Oat milk',
    );

    // --- ↑ / ↓ move the caret --------------------------------------------
    await page.keyboard.press('ArrowUp');
    const focusedTitle = await page.evaluate(() => document.activeElement?.value ?? null);
    check('↑ moves the caret to the row above', focusedTitle === 'Coffee beans', String(focusedTitle));

    // --- Escape discards --------------------------------------------------
    await page.keyboard.press('End');
    await page.keyboard.type(' XXX');
    await page.keyboard.press('Escape');
    check(
      'Escape discards the in-progress title edit',
      (await page.evaluate(() => document.activeElement?.value ?? null)) === 'Coffee beans',
    );

    // --- Backspace on an empty row ---------------------------------------
    await (await rowByTitle(page, 'Oat milk')).locator('[data-testid="title"]').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    check(
      'Backspace on an empty row deletes it',
      !(await titlesUnder(page, 'Shopping')).includes('Oat milk'),
      (await titlesUnder(page, 'Shopping')).join('|'),
    );

    // Refused when the row has children — §3.1.
    const rowsBefore = await page.locator('[data-testid="row"]').count();
    await (await rowByTitle(page, 'Shopping')).locator('[data-testid="title"]').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    const rowsAfter = await page.locator('[data-testid="row"]').count();
    check(
      'Backspace is refused on a row with children',
      rowsAfter === rowsBefore,
      `${rowsBefore} rows before, ${rowsAfter} after`,
    );
    await page.keyboard.type('Shopping');
    await page.keyboard.press('ArrowDown');

    // --- T-11: a ticked row is not in the normal view ---------------------
    // Only a browser can answer this one: the assertion is about what is *not*
    // on screen, and the seeded 'Bread' is ticked in the op log itself.
    check(
      'a row ticked in the folder never reaches the tree — T-11',
      !(await titlesUnder(page, 'Shopping')).includes('Bread'),
      (await titlesUnder(page, 'Shopping')).join('|'),
    );
    await (await rowByTitle(page, 'Milk')).locator('[data-testid="done"]').click();
    check(
      'ticking a row takes it out of its list',
      !(await titlesUnder(page, 'Shopping')).includes('Milk'),
      (await titlesUnder(page, 'Shopping')).join('|'),
    );

    // --- T-12: the Done view ----------------------------------------------
    await page.locator('[data-testid="done-link"]').click();
    await page.waitForSelector('[data-testid="done-page"]');
    const finishedTitles = await archivedTitles(page, 'finished-row');
    check(
      'the Done view holds every finished row — T-12',
      finishedTitles.join('|') === 'Milk|Bread',
      finishedTitles.join('|'),
    );
    const deletedTitles = await archivedTitles(page, 'deleted-row');
    check(
      'and every deleted one, newest first',
      deletedTitles.join('|') === 'Oat milk|Old receipts',
      deletedTitles.join('|'),
    );
    const paths = (await page.locator('[data-testid="archived-path"]').allInnerTexts()).map((t) => t.trim());
    check(
      'each row carries the path it sat on',
      paths.filter((path) => path === 'Shopping').length === 3,
      paths.join('|'),
    );
    await page.screenshot({ path: join(shots, 'done.png'), fullPage: true });

    // Un-ticking here is an ordinary field write, so the row goes back to its
    // list. Nothing un-deletes — T-13.
    await finishedRowByTitle(page, 'Milk').locator('[data-testid="done"]').click();
    check(
      'un-ticking in the Done view returns the row to its list',
      (await archivedTitles(page, 'finished-row')).join('|') === 'Bread',
      (await archivedTitles(page, 'finished-row')).join('|'),
    );
    await page.waitForTimeout(WRITE_SETTLE_MS);
    await page.goto(BASE_URL);
    await page.waitForSelector('[data-testid="tree"]');
    check(
      'and the list has it back',
      (await titlesUnder(page, 'Shopping')).join('|') === 'Milk|Coffee beans',
      (await titlesUnder(page, 'Shopping')).join('|'),
    );

    // --- the note page ----------------------------------------------------
    await (await rowByTitle(page, 'Trip notes')).locator('[data-testid="open"]').click();
    await page.waitForSelector('[data-testid="note-body"]');
    check(
      'a note opens its own page with its body — K-3',
      (await page.locator('[data-testid="note-body"]').inputValue()).startsWith('Ferry leaves'),
    );
    check(
      'a note still owns its checklist children — K-4',
      (await page.locator('[data-testid="tree"] [data-testid="title"]').evaluateAll((i) => i.map((x) => x.value)))
        .includes('Book the ferry'),
    );
    check('breadcrumbs name the path back up — T-9', await page.locator('[data-testid="breadcrumbs"]').isVisible());
    await page.locator('[data-testid="note-body"]').click();
    await page.keyboard.press('End');
    await page.keyboard.type('\nTickets printed.');
    await page.locator('[data-testid="page-title"]').click();
    await page.waitForTimeout(WRITE_SETTLE_MS);

    // --- a reload rebuilds it all from the folder — S-21 ------------------
    await page.reload();
    await page.waitForSelector('[data-testid="note-body"]');
    check(
      'the note body survived a reload',
      (await page.locator('[data-testid="note-body"]').inputValue()).includes('Tickets printed.'),
    );
    await page.goto(BASE_URL);
    await page.waitForSelector('[data-testid="tree"]');
    const afterReload = await titlesUnder(page, 'Shopping');
    check(
      'the edits survived a reload, folded back out of the op log',
      afterReload.join('|') === 'Milk|Coffee beans',
      afterReload.join('|'),
    );
    await page.locator('[data-testid="done-link"]').click();
    await page.waitForSelector('[data-testid="done-page"]');
    check(
      'and so did the Done view, which is derived rather than stored — T-12',
      (await archivedTitles(page, 'finished-row')).join('|') === 'Bread' &&
        (await archivedTitles(page, 'deleted-row')).join('|') === 'Oat milk|Old receipts',
    );
    await page.goto(BASE_URL);
    await page.waitForSelector('[data-testid="tree"]');

    await page.screenshot({ path: join(shots, 'desktop.png'), fullPage: true });

    // --- X-11 -------------------------------------------------------------
    await page.goto(`${BASE_URL}#/n/n_does_not_exist`);
    await page.waitForSelector('[data-testid="recovery"]');
    check('a link to a missing node renders a recovery page — X-11', true);

    // --- the phone layout — X-1, X-2 --------------------------------------
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL);
    await page.waitForSelector('[data-testid="tree"]');
    check(
      'the sidebar is a shut drawer on a phone — X-2',
      (await page.locator('[data-testid="sidebar"]').getAttribute('data-open')) === 'false' &&
        (await page.locator('[data-testid="drawer-button"]').isVisible()),
    );
    await page.locator('[data-testid="drawer-button"]').click();
    await page.waitForTimeout(300);
    check('the drawer opens', await page.locator('[data-testid="drawer-backdrop"]').isVisible());
    await page.screenshot({ path: join(shots, 'phone-drawer.png') });
    // Away from the drawer itself, which sits above the backdrop on purpose.
    await page.locator('[data-testid="drawer-backdrop"]').click({ position: { x: 340, y: 500 } });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(shots, 'phone.png'), fullPage: true });

    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(100);
      const overflow = await page.evaluate(() => document.body.scrollWidth - window.innerWidth);
      check(`no horizontal scroll at ${width}px`, overflow <= 0, `${overflow}px over`);
    }

    // --- X-5: a cold start with no network at all -------------------------
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(BASE_URL);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('[data-testid="tree"]', { timeout: 15_000 });
    const offlineTitles = await titlesUnder(page, 'Shopping');
    check(
      'cold start offline, with the tree intact — X-5',
      offlineTitles.join('|') === 'Milk|Coffee beans',
      offlineTitles.join('|'),
    );
    await context.setOffline(false);

    check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
    await browser.close();
    await server.stop();
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exit(1);
}

async function rowByTitle(page, title) {
  const rows = page.locator('[data-testid="row"]');
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    if ((await row.locator('[data-testid="title"]').inputValue()) === title) return row;
  }
  throw new Error(`no row titled ${JSON.stringify(title)}`);
}

/** The Done view's rows of one section, in the order it renders them — T-12. */
async function archivedTitles(page, testid) {
  const titles = await page
    .locator(`[data-testid="${testid}"] [data-testid="archived-title"]`)
    .allInnerTexts();
  return titles.map((title) => title.trim());
}

function finishedRowByTitle(page, title) {
  return page.locator('[data-testid="finished-row"]').filter({ hasText: title });
}

/** The titles of the rows rendered directly under the row with this title. */
async function titlesUnder(page, parentTitle) {
  return page.evaluate((parent) => {
    const rows = [...document.querySelectorAll('[data-testid="row"]')];
    const start = rows.findIndex((row) => row.querySelector('[data-testid="title"]').value === parent);
    if (start === -1) return [];
    const depth = Number(rows[start].dataset.depth) + 1;
    const out = [];
    for (const row of rows.slice(start + 1)) {
      const rowDepth = Number(row.dataset.depth);
      if (rowDepth < depth) break;
      if (rowDepth === depth) out.push(row.querySelector('[data-testid="title"]').value);
    }
    return out;
  }, parentTitle);
}

async function depthOf(page, title) {
  const row = await rowByTitle(page, title);
  return Number(await row.getAttribute('data-depth'));
}

main().catch((error) => {
  console.error('ui-smoke failed:', error);
  process.exit(1);
});
