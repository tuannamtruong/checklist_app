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
import {
  BASE_URL,
  ROOT_DIR,
  buildIfNeeded,
  peerLog,
  playwright,
  seedInto,
  startPreview,
} from './lib/harness.mjs';

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
    if (message.type() !== 'error') return;
    // A `/folder/info` that fails is not an error, it is the answer: "nothing
    // is serving a folder here" — X-18, and `helperInfo` catches it by design.
    // Offline (X-5) every boot asks and every boot is refused, and the browser
    // logs the refusal whatever the page does with it.
    if (message.location()?.url?.includes('/folder/info')) return;
    consoleErrors.push(message.text());
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

    // --- T-14: dragging a row, with a pointer -----------------------------
    // Pointer events rather than HTML5 drag-and-drop, so this is the same input
    // a thumb produces — requirements.md §3. Playwright's mouse emits the
    // pointer events the grip listens for.
    await dragRow(page, 'Milk', 'Oat milk', 'after');
    check(
      'a row dropped below another lands there — T-14',
      (await titlesUnder(page, 'Shopping')).join('|') === 'Coffee beans|Oat milk|Milk',
      (await titlesUnder(page, 'Shopping')).join('|'),
    );
    await dragRow(page, 'Milk', 'Coffee beans', 'before');
    check(
      'and dropped above one, it lands above it',
      (await titlesUnder(page, 'Shopping')).join('|') === 'Milk|Coffee beans|Oat milk',
      (await titlesUnder(page, 'Shopping')).join('|'),
    );
    await dragRow(page, 'Oat milk', 'Coffee beans', 'inside');
    check(
      'and dropped into the middle of a row, it becomes its child',
      (await depthOf(page, 'Oat milk')) === 2 &&
        (await titlesUnder(page, 'Coffee beans')).join('|') === 'Oat milk',
      `depth ${await depthOf(page, 'Oat milk')}`,
    );

    // T-5's refusal, reachable at last — §15 row 2. Dragging a row into its own
    // child is the one gesture that can ask for it.
    const beforeRefused = (await titlesUnder(page, 'Shopping')).join('|');
    const refusedMark = await dragRow(page, 'Coffee beans', 'Oat milk', 'inside');
    check(
      'a drop into the dragged row’s own child is refused, and drawn as refused — T-5',
      refusedMark === 'true' && (await titlesUnder(page, 'Shopping')).join('|') === beforeRefused,
      `refused=${refusedMark}`,
    );
    await dragRow(page, 'Oat milk', 'Coffee beans', 'after');
    check(
      'and the row dragged back out is a sibling again',
      (await depthOf(page, 'Oat milk')) === 1,
      `depth ${await depthOf(page, 'Oat milk')}`,
    );

    // --- K-8: the quick-add line -------------------------------------------
    const quickAdd = page.locator('[data-testid="quick-add"]');
    await quickAdd.fill('Batteries');
    await page.keyboard.press('Enter');
    const added = await rowByTitle(page, 'Batteries');
    check(
      'typing a title and pressing Enter makes a task — K-8',
      (await added.getAttribute('data-kind')) === 'task' &&
        (await added.locator('[data-testid="done"]').count()) === 1,
      String(await added.getAttribute('data-kind')),
    );
    check(
      'and the line is empty and still holds the caret, ready for the next one',
      (await quickAdd.inputValue()) === '' &&
        (await page.evaluate(() => document.activeElement?.dataset?.testid ?? null)) === 'quick-add',
      String(await page.evaluate(() => document.activeElement?.dataset?.testid ?? null)),
    );
    // --- K-9: a pasted paragraph is one row per line -----------------------
    // Only a browser can answer this one: it is a paste event carrying a
    // clipboard, and what it asserts is that the line breaks became rows rather
    // than one row holding a paragraph.
    await quickAdd.focus();
    await quickAdd.fill('Buy ');
    await page.evaluate(() => {
      const line = document.querySelector('[data-testid="quick-add"]');
      line.setSelectionRange(line.value.length, line.value.length);
      const data = new DataTransfer();
      data.setData('text/plain', 'apples\r\n\n  pears  \nplums\n');
      line.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    // The line adds to the page it is on, which here is the root — so the rows
    // it made are the top-level ones, and the caret half of the paste is the
    // "Buy " that was already typed.
    const pasted = await topLevelTitles(page);
    check(
      'a pasted paragraph is one row per line, in order — K-9',
      pasted.slice(-3).join('|') === 'Buy apples|pears|plums',
      pasted.join('|'),
    );
    check(
      'the blank line made no row, and the line is empty and ready again',
      !pasted.includes('') && (await quickAdd.inputValue()) === '',
      `${pasted.length} top-level rows, line "${await quickAdd.inputValue()}"`,
    );
    await quickAdd.focus();

    const rowsBeforeEscape = await page.locator('[data-testid="row"]').count();
    await quickAdd.fill('Never written');
    await page.keyboard.press('Escape');
    // Blur commits what is left in the line, so this also asserts that Escape
    // emptied it rather than only leaving it unwritten.
    await page.locator('[data-testid="tree"]').click({ position: { x: 5, y: 5 } });
    check(
      'Escape throws away what was typed there, and nothing is written — K-8',
      (await page.locator('[data-testid="row"]').count()) === rowsBeforeEscape &&
        !(await titlesOf(page)).includes('Never written'),
      `${await page.locator('[data-testid="row"]').count()} rows, was ${rowsBeforeEscape}`,
    );

    // --- A-1 to A-6: tags, the flag and the filter -------------------------
    const milkRow2 = await rowByTitle(page, 'Milk');
    const flag = milkRow2.locator('[data-testid="priority"]');
    await flag.click();
    check(
      'the flag cycles highest first — A-2',
      (await flag.getAttribute('data-priority')) === 'high',
      String(await flag.getAttribute('data-priority')),
    );

    await milkRow2.locator('[data-testid="row-menu-button"]').click();
    await page.locator('[data-testid="row-menu"] [data-action="tags"]').click();
    await page.locator('[data-testid="tag-input"]').fill('#Town');
    await page.keyboard.press('Enter');
    check(
      'a tag typed with a hash and a capital is stored as one tag — A-1',
      (await milkRow2.locator('[data-testid="tag-chip"]').innerText()).trim() === 'town',
      (await milkRow2.locator('[data-testid="tag-chip"]').innerText()).trim(),
    );

    await page.locator('[data-testid="filter-tag"][data-tag="town"]').click();
    const filteredTitles = await page
      .locator('[data-testid="row"] [data-testid="title"]')
      .evaluateAll((inputs) => inputs.map((input) => input.value));
    check(
      'filtering shows the matching row and the path to it, and nothing else — A-4',
      filteredTitles.join('|') === 'Shopping|Milk',
      filteredTitles.join('|'),
    );
    check(
      'and says how many rows carry the tags it is ANDing — §4.2',
      (await page.locator('[data-testid="filter-summary"]').innerText()).includes('1 row with town'),
      await page.locator('[data-testid="filter-summary"]').innerText(),
    );

    // A-6: a row created under a filter carries it, or it would vanish as it
    // was typed.
    await page.locator('[data-testid="quick-add"]').fill('Errand run');
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="filter-clear"]').click();
    const errand = await rowByTitle(page, 'Errand run');
    check(
      'a row created while filtering carries the filter’s tags — A-6',
      (await errand.locator('[data-testid="tag-chip"][data-tag="town"]').count()) === 1,
    );
    check(
      'clearing the filter puts the whole tree back',
      (await titlesUnder(page, 'Shopping')).join('|') === 'Milk|Coffee beans|Oat milk',
      (await titlesUnder(page, 'Shopping')).join('|'),
    );

    // --- ↑ / ↓ move the caret --------------------------------------------
    // The caret goes back where the keyboard checks left it: the tag block above
    // was driven with a mouse, and a button does not hold a caret.
    await (await rowByTitle(page, 'Oat milk')).locator('[data-testid="title"]').click();
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

    // --- T-13: restoring, which M1 and M2 could not do --------------------
    // One op, and the subtree comes with it: T-7 never tombstoned the child
    // individually, so clearing the top of the run is the whole operation.
    await deletedRowByTitle(page, 'Old receipts').locator('[data-testid="restore"]').click();
    check(
      'restoring a row takes it out of the deleted list — T-13',
      (await archivedTitles(page, 'deleted-row')).join('|') === 'Oat milk',
      (await archivedTitles(page, 'deleted-row')).join('|'),
    );
    await page.waitForTimeout(WRITE_SETTLE_MS);
    await page.goto(BASE_URL);
    await page.waitForSelector('[data-testid="tree"]');
    check(
      'and the tree has it back, after a reload through the op log',
      (await titlesUnder(page, 'Old receipts')).join('|') === 'Fuel receipt',
      (await titlesUnder(page, 'Old receipts')).join('|'),
    );

    // --- §6: search -------------------------------------------------------
    await page.locator('[data-testid="title"]').first().blur();
    await page.keyboard.press('/');
    await page.waitForSelector('[data-testid="search-page"]');
    check('“/” opens search from the tree — F-5', true);
    await page.locator('[data-testid="search-input"]').fill('ferry');
    const ferryHits = await searchHitTitles(page);
    check(
      'a query finds a title and a note body — F-1',
      ferryHits.includes('Book the ferry') && ferryHits.includes('Trip notes'),
      ferryHits.join('|'),
    );
    check(
      'the query is in the route, so the list is linkable — F-5',
      page.url().endsWith('#/search/ferry'),
      page.url(),
    );
    await page.locator('[data-testid="search-input"]').fill('bread');
    check(
      'a row T-11 has hidden is still findable, and says so — F-3',
      (await searchHitTitles(page)).join('|') === 'Bread' &&
        (await page.locator('[data-testid="hit-done"]').count()) === 1,
      (await searchHitTitles(page)).join('|'),
    );
    check(
      'every hit carries the path it sits on — F-2',
      (await page.locator('[data-testid="hit-path"]').first().innerText()).trim() === 'Shopping',
    );
    await page.screenshot({ path: join(shots, 'search.png'), fullPage: true });

    // --- §10 X-12: the settings screen --------------------------------------
    await page.locator('[data-testid="settings-link"]').click();
    await page.waitForSelector('[data-testid="settings-page"]');
    check(
      'settings gathers appearance, the name and the log — X-12',
      (await page.locator('[data-testid="settings-appearance"]').isVisible()) &&
        (await page.locator('[data-testid="device-name"]').isVisible()) &&
        (await page.locator('[data-testid="log-link"]').isVisible()),
    );

    // --- X-15 to X-17: the sync folder section -------------------------------
    // This run reaches its folder through `local-folder`, which is the browser
    // itself: there is no folder to show and no client to start, so what is
    // asserted is that the section names what this device writes to and that a
    // capability this shell does not have is an absent button rather than a
    // dead one — requirements.md §10.2.
    const folderSection = await page.locator('[data-testid="settings-folder-label"]').innerText();
    // The sidebar keeps one line about the folder and only while it is the
    // unsynced fallback, which is what this run is — architecture.md §4.
    const footerWarning = await page.locator('[data-testid="not-synced"]').innerText();
    check(
      'settings names the folder this device syncs through — X-15',
      folderSection.trim() === footerWarning.trim() && folderSection.trim() !== '',
      folderSection,
    );
    check(
      'a browser that cannot open a folder offers no button, only the picker — §10.2',
      (await page.locator('[data-testid="open-folder"]').count()) === 0 &&
        (await page.locator('[data-testid="open-provider"]').count()) === 0 &&
        (await page.locator('[data-testid="change-folder"]').isVisible()),
    );
    check(
      'the provider catalog is offered, and nothing is chosen by default — X-17',
      (await page.locator('[data-testid="provider"]').inputValue()) === '' &&
        (await page.locator('[data-testid="provider"] option').count()) === 7,
    );

    // --- X-13, X-14: themes -------------------------------------------------
    const themeIds = await page
      .locator('[data-testid="theme-option"]')
      .evaluateAll((buttons) => buttons.map((button) => button.dataset.themeId));
    check(
      'every theme in the catalog is offered — X-13',
      themeIds.join('|') === 'light|dark|green|teal|orange|yellow',
      themeIds.join('|'),
    );
    // One theme is driven all the way — picked, seen on the tree, and still
    // there after a reload, which is the half a unit test cannot reach.
    await page.locator('[data-theme-id="dark"]').click();
    check(
      'picking a theme sets it on the document root — X-13',
      (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark',
    );
    await page.screenshot({ path: join(shots, 'settings-dark.png'), fullPage: true });
    await page.goto(`${BASE_URL}#/settings`);
    await page.waitForSelector('[data-testid="settings-page"]');
    check(
      'the theme survives a reload, and is set before the first paint — X-14',
      (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark' &&
        (await page.locator('[data-theme-id="dark"]').getAttribute('aria-pressed')) === 'true',
    );
    // The rest are a screenshot each: contrast is what a person checks and a
    // script cannot — test.md §3.5. What the script does assert is that no
    // theme moves anything, which is the claim §10.1 makes about all six.
    const themeShapes = [];
    for (const id of themeIds) {
      await page.locator(`[data-theme-id="${id}"]`).click();
      await page.waitForTimeout(100);
      themeShapes.push(
        await page.evaluate(() => {
          const box = document.querySelector('[data-testid="settings-page"]').getBoundingClientRect();
          return `${Math.round(box.width)}x${Math.round(box.height)}:${document.body.scrollWidth - window.innerWidth}`;
        }),
      );
      await page.screenshot({ path: join(shots, `theme-${id}.png`), fullPage: true });
    }
    check(
      'no theme changes a layout, a size or an overflow — §10.1',
      new Set(themeShapes).size === 1 && themeShapes[0].endsWith(':0'),
      themeShapes.join(' '),
    );
    await page.locator('[data-theme-id="light"]').click();

    // --- D-5: the name the device gave itself ------------------------------
    // Nothing has typed into this field yet, and it is not empty: the shape is
    // platform-browser-id4, and the last four are the first four of the id
    // beside it — requirements.md §8.
    const givenName = await page.locator('[data-testid="device-name"]').inputValue();
    const ownId = (await page.locator('[data-testid="settings-device-id"]').innerText()).trim();
    check(
      'a device nobody has named carries the name it gave itself — D-5',
      /^[A-Za-z]{1,5}-[A-Za-z]{1,4}-[0-9a-z]{4}$/.test(givenName) &&
        givenName.endsWith(`-${ownId.slice(0, 4)}`),
      `${givenName} for ${ownId}`,
    );
    // The screen as a device meets it, before anything has been typed into it.
    await page.screenshot({ path: join(shots, 'settings-unnamed.png'), fullPage: true });

    // --- D-1: this device's name -------------------------------------------
    await page.locator('[data-testid="device-name"]').fill('the laptop');
    await page.waitForTimeout(WRITE_SETTLE_MS);
    await page.screenshot({ path: join(shots, 'settings.png'), fullPage: true });
    await page.goto(`${BASE_URL}#/settings`);
    await page.waitForSelector('[data-testid="settings-page"]');
    check(
      'a name survives a reload, so it reached the file rather than the page — D-1',
      (await page.locator('[data-testid="device-name"]').inputValue()) === 'the laptop',
      await page.locator('[data-testid="device-name"]').inputValue(),
    );

    // --- §8: the device list ------------------------------------------------
    await page.locator('[data-testid="devices-link"]').click();
    await page.waitForSelector('[data-testid="devices-page"]');
    check(
      'the device list holds this device, under the name it was given — D-1',
      (await page.locator('[data-testid="device-row"]').count()) >= 1 &&
        (await page.locator('[data-testid="device-row"]').first().getAttribute('data-self')) === 'true' &&
        (await page.locator('[data-testid="device-label"]').first().innerText()).trim() === 'the laptop',
      await page.locator('[data-testid="device-label"]').first().innerText(),
    );
    await page.screenshot({ path: join(shots, 'devices.png'), fullPage: true });
    await page.goto(`${BASE_URL}#/settings`);
    await page.waitForSelector('[data-testid="settings-page"]');

    // --- D-4: this device's own log ---------------------------------------
    await page.locator('[data-testid="log-link"]').click();
    await page.waitForSelector('[data-testid="logs-page"]');
    const logRows = page.locator('[data-testid="log-entry"]');
    check(
      'the settings screen leads to this device’s log — D-4',
      (await logRows.count()) > 0,
      `${await logRows.count()} entries`,
    );
    // The log reads from the end, so the newest entry is the run's last edit —
    // restoring “Old receipts” a few checks up.
    const newest = logRows.first();
    check(
      'the newest entry is the last edit made, which is what newest-first means — D-4',
      (await newest.getAttribute('data-op')) === 'restore' &&
        (await newest.locator('[data-testid="log-title"]').innerText()).trim() === 'Old receipts',
      `${await newest.getAttribute('data-op')} ${(await newest.locator('[data-testid="log-title"]').innerText()).trim()}`,
    );
    check(
      'the header line is on the page: the file, the op count and the vector — D-4',
      (await page.locator('[data-testid="log-file"]').innerText()).endsWith('.ops.jsonl') &&
        Number(await page.locator('[data-testid="log-count"]').innerText()) >=
          (await logRows.count()) &&
        (await page.locator('[data-testid="log-clock"]').innerText()).includes('the laptop'),
      await page.locator('[data-testid="log-file"]').innerText(),
    );
    await page.screenshot({ path: join(shots, 'logs.png'), fullPage: true });

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

    // The scrim is a token of its own rather than `ink` at 20%, because under a
    // dark palette that veil brightens what it is meant to dim — §10.1. The
    // claim is per theme, so it is asserted per theme: composite the scrim over
    // the surface and it must come out darker than the surface alone.
    const dimmed = [];
    for (const id of themeIds) {
      await page.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), id);
      await page.waitForTimeout(50);
      dimmed.push(
        await page.evaluate((theme) => {
          const backdrop = document.querySelector('[data-testid="drawer-backdrop"]');
          const scrim = getComputedStyle(backdrop).backgroundColor;
          const surface = getComputedStyle(document.documentElement).backgroundColor;
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d');
          const luma = (over) => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = surface;
            ctx.fillRect(0, 0, 1, 1);
            if (over) {
              ctx.fillStyle = scrim;
              ctx.fillRect(0, 0, 1, 1);
            }
            const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          return { theme, bare: Math.round(luma(false)), veiled: Math.round(luma(true)) };
        }, id),
      );
    }
    const brightening = dimmed.filter((row) => row.veiled >= row.bare);
    check(
      'the drawer scrim darkens the page in every theme — §10.1',
      brightening.length === 0,
      brightening.map((row) => `${row.theme} ${row.bare}→${row.veiled}`).join(', ') ||
        dimmed.map((row) => `${row.theme} ${row.bare}→${row.veiled}`).join(', '),
    );
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: join(shots, 'phone-drawer-dark.png') });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
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

    // The log's row is the widest thing the app renders — a counter, a clock, an
    // op name and a title on one line — so it gets the phone width of its own.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}#/logs`);
    await page.waitForSelector('[data-testid="logs-page"]');
    // The drawer's transform is still settling on a fresh load, and it is what
    // the width is measured against.
    await page.waitForTimeout(300);
    const logOverflow = await page.evaluate(() => document.body.scrollWidth - window.innerWidth);
    check('the log holds at a phone width — D-4, X-1', logOverflow <= 0, `${logOverflow}px over`);
    await page.screenshot({ path: join(shots, 'phone-logs.png'), fullPage: true });

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

    // --- a second device arrives in the folder — M2 --------------------------
    // Written straight into the folder while the page is open, which is what
    // the provider's client does. Nothing reloads: the cycle picks it up.
    const peer = peerLog();
    await page.evaluate(
      ([name, content]) => localStorage.setItem(`checklist:folder:${name}`, content),
      [peer.name, peer.text],
    );
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForSelector('[data-testid="conflicts-link"]', { timeout: 5_000 });
    const withPeer = await titlesUnder(page, 'Shopping');
    check(
      'a peer’s row appears without a reload — S-19',
      withPeer.includes('Tea'),
      withPeer.join('|'),
    );
    check(
      'and its concurrent title write won on both, by (at, device id)',
      withPeer.includes('Coffee') && !withPeer.includes('Coffee beans'),
      withPeer.join('|'),
    );
    // The peer count is on the settings screen rather than in the corner — §10.
    await page.locator('[data-testid="settings-link"]').click();
    await page.waitForSelector('[data-testid="settings-page"]');
    const reach = await page.locator('[data-testid="settings-folder-synced"]').innerText();
    check('the folder now shows two devices', reach.includes('1 other device'), reach);
    await page.goBack();
    await page.waitForSelector('[data-testid="tree"]', { state: 'attached' });
    // The receipt is a write of our own file, so it lands on the write debounce
    // rather than with the fold — sync-flow.md §2.4.
    await page.waitForTimeout(WRITE_SETTLE_MS);
    check(
      'our own file records the receipt, so the next edit is not a phantom race',
      await page.evaluate(
        (device) =>
          (localStorage.getItem('checklist:folder:checklist.5eed0001.ops.jsonl') ?? '')
            .split('\n')[0]
            .includes(device),
        peer.device,
      ),
    );

    // --- the conflict nav — §9 ----------------------------------------------
    check(
      'a race raises the nav entry, which is absent otherwise — C-5',
      (await page.locator('[data-testid="conflicts-link"]').innerText()).includes('1'),
    );
    await page.locator('[data-testid="conflicts-link"]').click();
    await page.waitForSelector('[data-testid="conflicts-page"]');
    const detail = await page.locator('[data-testid="conflict-detail"]').first().innerText();
    check(
      'the row says what was kept, what was not, and by which device — C-4',
      detail.includes('Coffee') && detail.includes('Coffee beans') && detail.includes('5eed0002'),
      detail.replace(/\s+/g, ' '),
    );
    await page.screenshot({ path: join(shots, 'conflicts.png'), fullPage: true });

    // C-6: only the dismissal persists, and only on this device.
    await page.locator('[data-testid="conflict-dismiss"]').first().click();
    await page.waitForSelector('[data-testid="conflicts-empty"]');
    check(
      'dismissing takes the row out of the list and the nav',
      (await page.locator('[data-testid="conflicts-hidden"]').innerText()).includes('1 dismissed'),
      await page.locator('[data-testid="conflicts-hidden"]').innerText(),
    );
    await page.locator('[data-testid="conflicts-hidden"] button').click();
    await page.waitForSelector('[data-testid="conflict-row"]');
    check('and it can be brought back', true);

    await page.locator('[data-testid="conflict-restore"]').first().click();
    await page.waitForSelector('[data-testid="conflicts-empty"]');
    check('taking the dropped value back settles it, as an ordinary edit — C-1', true);
    await page.waitForTimeout(WRITE_SETTLE_MS);
    await page.goto(BASE_URL);
    await page.waitForSelector('[data-testid="tree"]');
    const settled = await titlesUnder(page, 'Shopping');
    check(
      'and it survives the reload, with the peer’s row still there',
      settled.includes('Coffee beans') && settled.includes('Tea'),
      settled.join('|'),
    );
    check(
      'the nav entry is gone once nothing is unresolved',
      (await page.locator('[data-testid="conflicts-link"]').count()) === 0,
    );

    // --- first run, in a browser with nothing in it — architecture.md §4 -----
    // Its own context, because the question is what a device with no folder and
    // no op log does, and the seeded one has both.
    const fresh = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const firstRun = await fresh.newPage();
      await firstRun.goto(BASE_URL);
      await firstRun.waitForSelector('[data-testid="folder-setup"]');
      check('a device with no folder is asked for one, once — X-3', true);
      await firstRun.screenshot({ path: join(shots, 'folder-setup.png'), fullPage: true });

      await firstRun.locator('[data-testid="setup-local"]').click();
      await firstRun.waitForSelector('[data-testid="tree"]', { state: 'attached' });
      check(
        'and declining still gets a working app, which says it is not synced',
        (await firstRun.locator('[data-testid="not-synced"]').innerText()).includes('not synced'),
        await firstRun.locator('[data-testid="not-synced"]').innerText(),
      );
      await firstRun.reload();
      await firstRun.waitForSelector('[data-testid="tree"]', { state: 'attached' });
      check(
        'and is not asked again on the next launch',
        (await firstRun.locator('[data-testid="folder-setup"]').count()) === 0,
      );
    } finally {
      await fresh.close();
    }

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

/**
 * T-14, driven the way a finger drives it: down on the grip, move, up. The
 * pointer is captured by the grip, so every move goes there and the app decides
 * what is under it — `src/ui/drag.svelte.ts`.
 *
 * Returns what the target row said about the drop while the pointer was still
 * down, which is the only moment a refusal is visible.
 */
async function dragRow(page, title, ontoTitle, where) {
  const grip = (await rowByTitle(page, title)).locator('[data-testid="drag-handle"]');
  const target = await rowByTitle(page, ontoTitle);
  const from = await grip.boundingBox();
  const to = await target.boundingBox();
  const y =
    where === 'before' ? to.y + 2 : where === 'after' ? to.y + to.height - 2 : to.y + to.height / 2;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Two moves: the first leaves the grip, the second lands, and a single jump
  // can be coalesced into something the page never sees.
  await page.mouse.move(to.x + to.width / 2, y, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2 + 1, y, { steps: 2 });
  const refused = await target.getAttribute('data-drop-refused');
  await page.mouse.up();
  return refused;
}

/** The titles of the rows at the top level, in render order. */
async function topLevelTitles(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="row"]')]
      .filter((row) => row.dataset.depth === '0')
      .map((row) => row.querySelector('[data-testid="title"]').value),
  );
}

/** Every title on screen, in render order. */
async function titlesOf(page) {
  return page
    .locator('[data-testid="row"] [data-testid="title"]')
    .evaluateAll((inputs) => inputs.map((input) => input.value));
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
function deletedRowByTitle(page, title) {
  return page.locator('[data-testid="deleted-row"]').filter({ hasText: title });
}
async function searchHitTitles(page) {
  const titles = await page.locator('[data-testid="hit-title"]').allInnerTexts();
  return titles.map((title) => title.trim());
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
