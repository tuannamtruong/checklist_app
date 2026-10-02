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
  seedLog,
  startPreview,
} from './lib/harness.mjs';

const headed = process.argv.includes('--headed');
const shots = join(ROOT_DIR, 'ui-smoke');

/** X-34. What the row menu draws: the edits, never the four reorderings. */
const MENU_ACTIONS = ['new-below', 'new-inside', 'tags', 'delete'];
const KEYBOARD_ONLY_ACTIONS = ['indent', 'outdent', 'move-up', 'move-down'];

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Waits until this device's file in the folder carries `written`.
 *
 * A fixed pause is a race against the 250 ms write debounce of
 * `src/app/device-log.ts`, and on a busy main thread the timer sometimes loses
 * — which shows up as an edit that "did not survive a reload" when the reload
 * simply outran the write. What the run means to say is that the op reached the
 * folder, so it says that instead.
 */
/**
 * The add group the *list* owns — X-27's phone bar or K-10's page header,
 * whichever the width draws — and never the note pane's copy of it (X-31).
 *
 * K-12 is why the distinction has to be in the selector rather than in a bare
 * `:visible`: a caret in a task's title raises the pane, so the pane's own line
 * is on screen for most of this run rather than only while a note is open.
 */
function listAdd(page, testid) {
  return page.locator(
    `[data-testid="topbar"] [data-testid="${testid}"]:visible, [data-testid="page-header"] [data-testid="${testid}"]:visible`,
  );
}

async function landed(page, written) {
  await page.waitForFunction(
    (text) =>
      (localStorage.getItem('checklist:folder:checklist.5eed0001.ops.jsonl') ?? '').includes(text),
    written,
    { timeout: 10_000 },
  );
}

async function main() {
  await mkdir(shots, { recursive: true });
  await buildIfNeeded({ force: true });
  const server = await startPreview();
  const { chromium } = playwright();
  const browser = await chromium.launch({ headless: !headed });
  // The clipboard is granted for one check: B-8's Copy button on a code block,
  // which is the only thing in the application that writes to it.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
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
    const sidebarTitles = async () =>
      (await page.locator('[data-testid="sidebar-link"]').allInnerTexts()).map((t) => t.trim()).join(',');
    check(
      'the sidebar starts at the top-level folders and notes, second level closed — T-10, T-17',
      (await sidebarTitles()) === 'Shopping,House,Trip notes',
      await sidebarTitles(),
    );

    // --- T-17: the second level, disclosed and device-local -----------------
    const sidebarRowId = async (title) =>
      page
        .locator('[data-testid="sidebar-link"]')
        .filter({ hasText: title })
        .first()
        .getAttribute('data-row-id');
    const disclosure = async (title) =>
      page.locator(`[data-testid="sidebar-disclosure"][data-row-id="${await sidebarRowId(title)}"]`);

    const shoppingTriangle = await disclosure('Shopping');
    const houseTriangle = await disclosure('House');
    check(
      'a row with no folders or notes under it offers no disclosure — T-17',
      (await shoppingTriangle.getAttribute('aria-expanded')) === null &&
        (await houseTriangle.getAttribute('aria-expanded')) === 'false',
      `Shopping ${await shoppingTriangle.getAttribute('aria-expanded')}, House ${await houseTriangle.getAttribute('aria-expanded')}`,
    );

    await houseTriangle.click();
    check(
      'opening a top-level row shows its immediate folders and notes — T-10',
      (await sidebarTitles()) === 'Shopping,House,Kitchen,Trip notes',
      await sidebarTitles(),
    );

    await (await disclosure('Trip notes')).click();
    check(
      'and never a task at the second level, however navigable the note is — T-10',
      (await sidebarTitles()) === 'Shopping,House,Kitchen,Trip notes,Packing list',
      await sidebarTitles(),
    );

    await page.reload();
    await page.waitForSelector('[data-testid="tree"]');
    check(
      'which rows are open is device-local state, so it survives a reload — T-17, §2.3',
      (await sidebarTitles()) === 'Shopping,House,Kitchen,Trip notes,Packing list',
      await sidebarTitles(),
    );

    // Shut again, so every check below reads the column it was written against.
    await (await disclosure('House')).click();
    await (await disclosure('Trip notes')).click();
    // --- T-18: a sidebar entry is a row, so it carries a row's menu ---------
    await page.locator('[data-testid="sidebar"] [data-testid="row-menu-button"]').first().click();
    const sidebarMenu = await page
      .locator('[data-testid="row-menu"] [data-action]')
      .evaluateAll((buttons) => buttons.map((button) => button.dataset.action));
    check(
      'a sidebar entry carries the same menu the tree’s rows do — T-18',
      MENU_ACTIONS.every((action) => sidebarMenu.includes(action)) &&
        KEYBOARD_ONLY_ACTIONS.every((action) => !sidebarMenu.includes(action)),
      sidebarMenu.join(','),
    );
    check(
      'with the two editors it has nowhere to draw shown disabled rather than absent',
      await page.locator('[data-testid="row-menu"] [data-action="tags"]').isDisabled(),
    );
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="row-menu"]').waitFor({ state: 'detached' });

    check(
      'and the disclosure closes what it opened',
      (await sidebarTitles()) === 'Shopping,House,Trip notes',
      await sidebarTitles(),
    );

    const corner = page.locator('[data-testid="all-lists-link"]');
    check(
      'the sidebar’s corner is named for the page it opens, not for the app — X-28',
      (await corner.innerText()).trim() === 'All' &&
        (await corner.getAttribute('href')) === '#/' &&
        !/checklist/i.test(await page.locator('[data-testid="sidebar"]').innerText()),
      (await corner.innerText()).trim(),
    );

    // --- X-29: the sidebar scrolls apart from the page ----------------------
    // A short window is what makes the seeded tree taller than the viewport, so
    // the check needs no rows of its own: the question is only whether scrolling
    // the page moves the sidebar with it.
    await page.setViewportSize({ width: 1280, height: 420 });
    const sidebarTop = async () => Math.round((await page.locator('[data-testid="sidebar"]').boundingBox()).y);
    const pageColumn = page.locator('[data-testid="page-scroll"]');
    check(
      'the shell clips rather than letting the document scroll — X-29',
      await page.evaluate(() => document.scrollingElement.scrollHeight <= window.innerHeight + 1),
      `${await page.evaluate(() => document.scrollingElement.scrollHeight)} vs ${await page.evaluate(() => window.innerHeight)}`,
    );
    const topBefore = await sidebarTop();
    const scrolled = await pageColumn.evaluate((column) => {
      column.scrollTop = 400;
      return column.scrollTop;
    });
    check(
      'the list scrolls in its own column, and the sidebar stays where it is — X-29',
      scrolled > 0 && (await sidebarTop()) === topBefore,
      `scrollTop ${scrolled}, sidebar y ${topBefore} -> ${await sidebarTop()}`,
    );
    check(
      'and the sidebar is the window\u2019s height rather than the page\u2019s — X-29',
      Math.round((await page.locator('[data-testid="sidebar"]').boundingBox()).height) ===
        (await page.evaluate(() => window.innerHeight)),
      String(Math.round((await page.locator('[data-testid="sidebar"]').boundingBox()).height)),
    );
    await pageColumn.evaluate((column) => (column.scrollTop = 0));
    await page.setViewportSize({ width: 1280, height: 900 });

    // --- X-20: the sidebar's width is dragged, and it stays dragged ---------
    // The grip is a pointer gesture over a two-pixel strip, so a browser is the
    // only place the capture and the clamp can both be exercised.
    const sidebarWidth = async () =>
      Math.round((await page.locator('[data-testid="sidebar"]').boundingBox()).width);
    const startWidth = await sidebarWidth();
    await page.locator('[data-testid="sidebar-resize"]').hover();
    await page.mouse.down();
    await page.mouse.move(startWidth + 84, 400, { steps: 8 });
    await page.mouse.up();
    const dragged = await sidebarWidth();
    check('the sidebar is dragged wider by its grip — X-20', dragged > startWidth + 60, `${startWidth} -> ${dragged}`);

    await page.locator('[data-testid="sidebar-resize"]').hover();
    await page.mouse.down();
    await page.mouse.move(2000, 400, { steps: 8 });
    await page.mouse.up();
    const clamped = await sidebarWidth();
    check('and stops at its bound rather than taking the page', clamped <= 480, String(clamped));

    await page.reload();
    await page.waitForSelector('[data-testid="tree"]');
    check(
      'the width is device-local state, so it survives a reload — §2.3',
      (await sidebarWidth()) === clamped,
      `${clamped} -> ${await sidebarWidth()}`,
    );

    // Back to the default, so every check below measures the layout it was
    // written against.
    await page.locator('[data-testid="sidebar-resize"]').focus();
    await page.keyboard.press('Home');
    check(
      'and the keyboard reaches the grip when no pointer does',
      (await sidebarWidth()) === startWidth,
      String(await sidebarWidth()),
    );

    // --- the row menu is edits and nothing else — X-34 --------------------
    const milkRow = await rowByTitle(page, 'Milk');
    await milkRow.locator('[data-testid="row-menu-button"]').click();
    const menuActions = await page
      .locator('[data-testid="row-menu"] [data-action]')
      .evaluateAll((buttons) => buttons.map((button) => button.dataset.action));
    const missing = MENU_ACTIONS.filter((action) => !menuActions.includes(action));
    check('every edit a thumb needs is in the row menu', missing.length === 0, missing.join(', '));
    const structural = KEYBOARD_ONLY_ACTIONS.filter((action) => menuActions.includes(action));
    check(
      'and the four reorderings are not — a finger drags instead',
      structural.length === 0,
      structural.join(', '),
    );
    check(
      'the menu teaches no keys: the reference is on the settings screen — X-33',
      (await page.locator('[data-testid="row-menu"] kbd').count()) === 0,
      await page.locator('[data-testid="row-menu"]').innerText(),
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

    // T-15: the grip is outside the indent, so a nested list draws one column
    // of grips rather than a staircase of them.
    const grips = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="row"]')].map((row) => ({
        depth: row.dataset.depth,
        x: Math.round(row.querySelector('[data-testid="drag-handle"]').getBoundingClientRect().x),
      })),
    );
    const gripColumns = new Set(grips.map((grip) => grip.x));
    const gripDepths = new Set(grips.map((grip) => grip.depth));
    check(
      'every grip sits in one column, whatever the row’s depth — T-15',
      gripColumns.size === 1 && gripDepths.size > 1,
      `${gripColumns.size} columns over ${gripDepths.size} depths`,
    );

    // --- K-8: the quick-add line -------------------------------------------
    // `listAdd` because X-27 puts a group in the phone's top bar and X-26 puts
    // one in the page header, and the layout hides one of them in CSS rather
    // than rendering only the width it is at — X-1. The note pane holds a third
    // (X-31), which is never the one a check about the list means.
    const quickAdd = listAdd(page, 'quick-add');
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
      const line = [...document.querySelectorAll('[data-testid="quick-add"]')].find(
        (input) => input.getClientRects().length > 0,
      );
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

    // --- K-10 and X-26: one add group, at the top of the list and pinned ---
    const addGroup = await page.evaluate(() => {
      const header = document.querySelector('[data-testid="page-header"]');
      const tree = document.querySelector('[data-testid="tree"]');
      const buttons = [...document.querySelectorAll('[data-testid="add-note"]')];
      return {
        inHeader: header.querySelectorAll('[data-testid="add-row"] [data-testid="add-note"]').length,
        grouped: buttons.every((button) => button.closest('[data-testid="add-row"]') !== null),
        aboveTheList: tree.getBoundingClientRect().top >= header.getBoundingClientRect().bottom,
        pinned: getComputedStyle(header).position,
      };
    });
    check(
      'the two kind buttons are in the group at the top, not under the list — K-10',
      addGroup.inHeader === 1 && addGroup.grouped && addGroup.aboveTheList,
      `${addGroup.inHeader} in the header, grouped ${addGroup.grouped}`,
    );
    check(
      'and the group is pinned there rather than scrolling away — X-26',
      addGroup.pinned === 'sticky',
      addGroup.pinned,
    );

    // --- K-11: the typed title is the kind button's title ------------------
    await quickAdd.fill('Packing tips');
    await listAdd(page, 'add-note').click();
    const typedNote = await rowByTitle(page, 'Packing tips');
    check(
      'a title typed in the line and “+ Note” pressed is one note carrying it — K-11',
      (await typedNote.getAttribute('data-kind')) === 'note' &&
        !(await titlesOf(page)).includes(''),
      String(await typedNote.getAttribute('data-kind')),
    );
    check(
      'and the line is empty again, with nothing written as a task on the way',
      (await quickAdd.inputValue()) === '' &&
        (await page.locator('[data-testid="row"][data-kind="task"] [data-testid="title"]')
          .evaluateAll((inputs) => inputs.map((input) => input.value))).filter(
          (title) => title === 'Packing tips',
        ).length === 0,
      await quickAdd.inputValue(),
    );

    // --- A-1 to A-4, A-7: tags, the flag, and the one page that narrows -----
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
    // The row's editor, which is the one the menu opened: the note pane has an
    // editor of its own for the row it draws, and since K-12 that pane is open
    // whenever a caret has been in a task's title.
    await page.locator('[data-testid="tree"] [data-testid="tag-input"]').fill('#Town');
    await page.keyboard.press('Enter');
    check(
      'a tag typed with a hash and a capital is stored as one tag — A-1',
      (await milkRow2.locator('[data-testid="tag-chip"]').innerText()).trim() === 'town',
      (await milkRow2.locator('[data-testid="tag-chip"]').innerText()).trim(),
    );
    await page.keyboard.press('Escape');
    // A-9. Kept for the Tags page below: the same tag has to draw in the same
    // colour there, and nothing anywhere stored it.
    const townChipTint = await milkRow2
      .locator('[data-testid="tag-chip"][data-tag="town"]')
      .evaluate((el) => el.style.getPropertyValue('--tag-tint'));
    check(
      'the chip is a link to that one tag, and never a filter over the tree — A-10, §4.2',
      (await milkRow2.locator('[data-testid="tag-chip"][data-tag="town"]').getAttribute('href')) ===
        '#/tags/town' &&
        (await page.locator('[data-testid="tag-filter"]').count()) === 0 &&
        (await milkRow2.locator('button[data-testid="tag-chip"]').count()) === 0,
      await milkRow2.locator('[data-testid="tag-chip"][data-tag="town"]').getAttribute('href'),
    );

    // A-10. The whole journey, because the href above is only half of it: the
    // chip on the row reaches the page for that tag, and Back is the way out.
    await milkRow2.locator('[data-testid="tag-chip"][data-tag="town"]').click();
    await page.waitForSelector('[data-testid="tagged-row"]');
    check(
      'and tapping it opens that tag on the Tags page — A-10',
      page.url().endsWith('#/tags/town') &&
        (await page.locator('[data-testid="tagged-row"]').count()) === 1,
      `${page.url()} with ${await page.locator('[data-testid="tagged-row"]').count()} rows`,
    );
    await page.goBack();
    await page.waitForSelector('[data-testid="tree"]');

    // Two more rows to tag, so the AND below has something to narrow.
    await quickAdd.fill('Errand run');
    await page.keyboard.press('Enter');
    const errand = await rowByTitle(page, 'Errand run');
    await errand.locator('[data-testid="row-menu-button"]').click();
    await page.locator('[data-testid="row-menu"] [data-action="tags"]').click();
    await page.locator('[data-testid="tag-input"]').fill('town');
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="tag-input"]').fill('errand');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    check(
      'the tree is never narrowed by a tag, however many rows carry one — §4.2',
      (await titlesUnder(page, 'Shopping')).join('|') === 'Milk|Coffee beans|Oat milk',
      (await titlesUnder(page, 'Shopping')).join('|'),
    );

    // --- A-8: tags typed in front of the title on the add line ---------------
    await quickAdd.fill('#Town #errand Post the letters');
    await page.keyboard.press('Enter');
    const letters = await rowByTitle(page, 'Post the letters');
    check(
      'a #tag prefix on the add line tags the row it makes — A-8',
      (await letters.locator('[data-testid="tag-chip"]').allInnerTexts())
        .map((text) => text.trim())
        .join(',') === 'errand,town',
      (await letters.locator('[data-testid="tag-chip"]').allInnerTexts()).join(','),
    );

    await quickAdd.fill('Buy milk #2');
    await page.keyboard.press('Enter');
    const hashLate = await rowByTitle(page, 'Buy milk #2');
    check(
      'and a hash further along the line is part of the title — A-8',
      (await hashLate.locator('[data-testid="tag-chip"]').count()) === 0,
    );

    await quickAdd.fill('#town');
    await page.keyboard.press('Enter');
    check(
      'a line of tags alone writes nothing and keeps what was typed — A-8',
      (await quickAdd.inputValue()) === '#town',
      await quickAdd.inputValue(),
    );
    await quickAdd.fill('');

    // --- A-7: the tags of the tree, and the rows they name -------------------
    await page.locator('[data-testid="tags-link"]').click();
    await page.waitForSelector('[data-testid="tags-page"]');
    const tagEntries = await page
      .locator('[data-testid="tag-entry"]')
      .evaluateAll((links) => links.map((link) => link.dataset.tag));
    check(
      'the Tags page lists every tag in the tree, most used first — A-7',
      tagEntries.join(',') === 'town,errand',
      tagEntries.join(','),
    );
    check(
      'and shows nothing else at all until a tag is chosen — F-6',
      (await page.locator('[data-testid="tagged-row"]').count()) === 0 &&
        (await page.locator('[data-testid="tags-summary"]').count()) === 0,
    );

    // --- A-9: a colour per tag, derived from the tag itself -----------------
    // Two claims, and neither of them can be seen in a unit test: two tags draw
    // in two colours, and one tag draws in the *same* colour in two views — the
    // catalog here and the chip on the row — with nothing stored anywhere.
    const tint = (tag, where) =>
      page
        .locator(`${where}[data-tag="${tag}"]`)
        .first()
        .evaluate((el) => [el.style.getPropertyValue('--tag-tint'), getComputedStyle(el).color]);
    const [townEntry, errandEntry] = [
      await tint('town', '[data-testid="tag-entry"]'),
      await tint('errand', '[data-testid="tag-entry"]'),
    ];
    check(
      'two tags draw in two colours, both of them derived — A-9',
      townEntry[0] !== '' && townEntry[0] !== errandEntry[0] && townEntry[1] !== errandEntry[1],
      `town ${townEntry.join(' ')} | errand ${errandEntry.join(' ')}`,
    );
    check(
      'and one tag is the same colour here as on its row in the tree — A-9',
      townEntry[0] === townChipTint,
      `${townEntry[0]} vs ${townChipTint}`,
    );

    await page.locator('[data-testid="tag-entry"][data-tag="town"]').click();
    await page.waitForSelector('[data-testid="tagged-row"]');
    const tagged = await page
      .locator('[data-testid="tagged-row"]')
      .evaluateAll((links) => links.map((link) => link.innerText.split('\n')[0].trim()));
    check(
      'choosing one lists the rows carrying it, in tree order — A-7, A-4',
      tagged.join('|') === 'Milk|Errand run|Post the letters',
      tagged.join('|'),
    );
    check(
      'each with the path it sits on, so the list says where the row is — F-2’s shape',
      (await page.locator('[data-testid="tagged-path"]').first().innerText()).trim() ===
        'Shopping',
      await page.locator('[data-testid="tagged-path"]').first().innerText(),
    );
    check(
      'and the chosen tags are in the route, so the list is linkable — A-7, F-5',
      page.url().endsWith('#/tags/town'),
      page.url(),
    );

    await page.locator('[data-testid="tag-entry"][data-tag="errand"]').click();
    await page.waitForURL(/#\/tags\/town,errand$/);
    await page
      .locator('[data-testid="tags-summary"]')
      .filter({ hasText: 'town and errand' })
      .waitFor();
    check(
      'a second tag narrows the first: every one of them, on the same row — A-4',
      (await page.locator('[data-testid="tagged-row"]').count()) === 2 &&
        (await page.locator('[data-testid="tags-summary"]').innerText()).includes(
          '2 rows with town and errand',
        ),
      await page.locator('[data-testid="tags-summary"]').innerText(),
    );

    await page.reload();
    await page.waitForSelector('[data-testid="tagged-row"]');
    check(
      'and the reload draws the same list, because nothing about it was stored — A-5',
      (await page.locator('[data-testid="tagged-row"]').count()) === 2,
    );

    // §4.2. A choice matching nothing is answered by the count and by nothing
    // else: the sentence under the empty list said the same thing twice.
    const chosenUrl = page.url();
    await page.goto(`${chosenUrl.split('#')[0]}#/tags/nobodyhasthis`);
    await page.locator('[data-testid="tags-summary"]').waitFor();
    check(
      'a choice that matches nothing says so by counting, and adds no second sentence — §4.2',
      (await page.locator('[data-testid="tags-summary"]').innerText()).includes(
        '0 rows with nobodyhasthis',
      ) &&
        (await page.locator('[data-testid="tagged-row"]').count()) === 0 &&
        (await page.locator('[data-testid="tags-none"]').count()) === 0,
      await page.locator('[data-testid="tags-summary"]').innerText(),
    );
    await page.goto(chosenUrl);
    await page.waitForSelector('[data-testid="tagged-row"]');

    const chosenRow = await page.locator('[data-testid="tagged-row"]').first().getAttribute('href');
    await page.locator('[data-testid="tagged-row"]').first().click();
    // The page title is an editable input, so its *property* is what says which
    // row was opened — the attribute a CSS selector reads is never written.
    // There are two titles on screen now: the row is a task, and since K-12 a
    // task's route draws the list it hangs under and the task beside it (X-21),
    // so the one to look for is whichever of them says so.
    const titlesShown = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="page-title"]')].map(
          (el) => el.value ?? el.textContent,
        ),
      );
    await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll('[data-testid="page-title"]')].some(
            (el) => el.value === 'Errand run',
          ),
        null,
        { timeout: 5_000 },
      )
      .catch(() => {});
    const openedTitles = await titlesShown();
    check(
      'a row opens from the list, which is the way back into the tree — A-7',
      openedTitles.includes('Errand run') && page.url().endsWith(chosenRow),
      `${openedTitles.join(' | ')} at ${page.url()} for ${chosenRow}`,
    );
    await page.locator('[data-testid="all-lists-link"]').click();
    await page.waitForSelector('[data-testid="tree"]');

    // --- G-1 to G-7: Today and Tomorrow --------------------------------------
    // The two lists are not the tree, so every check here is also a check that
    // nothing leaked into `All` — requirements.md §4.4.
    const agendaLinks = (await page.locator('[data-testid="agenda-link"]').allInnerTexts()).map(
      (text) => text.trim(),
    );
    check(
      'Today and Tomorrow sit under All in the nav — G-7',
      agendaLinks.join(',') === 'Today,Tomorrow',
      agendaLinks.join(','),
    );

    await page.locator('[data-testid="agenda-link"][data-agenda="today"]').click();
    await page.waitForSelector('[data-testid="agenda-page"][data-agenda="today"]');
    check(
      'a day with nothing filed for it says so rather than reading as a lost list — G-4',
      (await page.locator('[data-testid="agenda-empty"]').count()) === 1,
      await page.locator('[data-testid="page-title"]').innerText(),
    );

    await page.locator('[data-testid="agenda-link"][data-agenda="tomorrow"]').click();
    await page.waitForSelector('[data-testid="agenda-page"][data-agenda="tomorrow"]');
    const agendaAdd = listAdd(page, 'quick-add');
    await agendaAdd.fill('Collect the parcel');
    await page.keyboard.press('Enter');
    check(
      'the same line files an item on the page’s own day — G-5',
      (await titlesOf(page)).includes('Collect the parcel'),
      (await titlesOf(page)).join('|'),
    );

    await page.locator('[data-testid="all-lists-link"]').click();
    // The agenda page draws a tree of its own, so waiting for one would wait
    // for the page being left: what says the navigation landed is that page
    // going away.
    await page.waitForSelector('[data-testid="agenda-page"]', { state: 'detached' });
    check(
      'and nothing in All holds it — G-1',
      !(await titlesOf(page)).includes('Collect the parcel'),
      (await titlesOf(page)).join('|'),
    );

    await page.locator('[data-testid="agenda-link"][data-agenda="tomorrow"]').click();
    await page.waitForSelector('[data-testid="agenda-page"][data-agenda="tomorrow"]');
    const parcel = await rowByTitle(page, 'Collect the parcel');
    await parcel.locator('[data-testid="row-menu-button"]').click();
    const dayEntry = page.locator('[data-testid="row-menu"] [data-action="move-to-today"]');
    check(
      'an item in Tomorrow offers exactly one day move, and it is the other list — G-6',
      (await dayEntry.count()) === 1 &&
        (await page.locator('[data-testid="row-menu"] [data-action="move-to-tomorrow"]').count()) === 0,
      await page.locator('[data-testid="row-menu"]').innerText(),
    );
    await dayEntry.click();
    check(
      'taking it moves it into Today, and Tomorrow is empty again — G-6',
      (await page.locator('[data-testid="agenda-empty"]').count()) === 1,
      (await titlesOf(page)).join('|'),
    );

    await page.locator('[data-testid="agenda-link"][data-agenda="today"]').click();
    await page.waitForSelector('[data-testid="agenda-page"][data-agenda="today"]');
    check(
      'and Today is where it now is — G-6',
      (await titlesOf(page)).includes('Collect the parcel'),
      (await titlesOf(page)).join('|'),
    );

    const rowMenuTree = await rowByTitle(page, 'Collect the parcel');
    await rowMenuTree.locator('[data-testid="row-menu-button"]').click();
    check(
      'and the entry is now the other way round — G-6',
      (await page.locator('[data-testid="row-menu"] [data-action="move-to-tomorrow"]').count()) === 1,
    );
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="row-menu"]').waitFor({ state: 'detached' });

    await page.locator('[data-testid="all-lists-link"]').click();
    await page.waitForSelector('[data-testid="agenda-page"]', { state: 'detached' });
    const treeRow = await rowByTitle(page, 'Milk');
    await treeRow.locator('[data-testid="row-menu-button"]').click();
    check(
      'a row in the tree is offered neither: it has no day and no list to move to — G-2',
      (await page.locator('[data-testid="row-menu"] [data-action^="move-to-to"]').count()) === 0,
    );
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="row-menu"]').waitFor({ state: 'detached' });

    // --- R-1 to R-8: Timely --------------------------------------------------
    // A third list that is not the tree, and the one place a tick does not
    // finish anything — requirements.md §4.5. X-32's widths are asked here
    // because the entry it gains is the third of them: measured rather than
    // eyeballed, since what X-32 asks is that a click anywhere on the row
    // reaches the link, and a width is the only way to say that.
    const cornerWidths = await page.evaluate(() => {
      const width = (selector) =>
        Math.round(document.querySelector(selector)?.getBoundingClientRect().width ?? 0);
      return {
        all: width('[data-testid="all-lists-link"]'),
        today: width('[data-testid="agenda-link"][data-agenda="today"]'),
        timely: width('[data-testid="timely-link"]'),
      };
    });
    check(
      'All is the same full-width target its neighbours are — X-32',
      cornerWidths.all > 0 && cornerWidths.all === cornerWidths.today,
      JSON.stringify(cornerWidths),
    );
    check(
      'Timely sits with them, above the rule — R-8',
      (await page.locator('[data-testid="timely-link"]').innerText()).trim() === 'Timely' &&
        cornerWidths.timely === cornerWidths.today,
      JSON.stringify(cornerWidths),
    );

    await page.locator('[data-testid="timely-link"]').click();
    await page.waitForSelector('[data-testid="timely-page"]');
    check(
      'Timely opens on a list of its own, empty and unannotated',
      (await page.locator('[data-testid="page-title"]').innerText()) === 'Timely' &&
        (await titlesOf(page)).length === 0,
      (await titlesOf(page)).join('|'),
    );
    check(
      'and its add line offers no kind but a check item — R-1',
      (await listAdd(page, 'add-note').count()) === 0 &&
        (await listAdd(page, 'add-folder').count()) === 0,
    );

    await listAdd(page, 'quick-add').fill('Water the plants');
    await page.keyboard.press('Enter');
    let plants = await rowByTitle(page, 'Water the plants');
    check(
      'a new chore repeats daily from the moment it exists — R-2',
      (await plants.locator('[data-testid="repeat-chip"]').innerText()).trim() === '↻ 1d' &&
        (await plants.getAttribute('data-waiting')) === 'false',
      await plants.innerText(),
    );

    // R-7. The chip opens the count and the unit, which is the whole period.
    await plants.locator('[data-testid="repeat-chip"]').click();
    await page.locator('[data-testid="repeat-count"]').fill('5');
    await page.screenshot({ path: join(shots, 'timely-repeat.png'), fullPage: true });
    await page.locator('[data-testid="repeat-close"]').click();
    plants = await rowByTitle(page, 'Water the plants');
    check(
      'the chip sets an arbitrary count, not a preset off a ladder — R-7',
      (await plants.locator('[data-testid="repeat-chip"]').innerText()).trim() === '↻ 5d',
      await plants.innerText(),
    );

    // R-3 and R-5. The tick files it forward and leaves it exactly where it is.
    await plants.locator('[data-testid="done"]').click();
    plants = await rowByTitle(page, 'Water the plants');
    check(
      'ticking greys the chore and leaves it in the list rather than finishing it — R-3',
      (await plants.getAttribute('data-waiting')) === 'true' &&
        (await plants.locator('[data-testid="done"]').isChecked()),
      await plants.innerText(),
    );
    check(
      'and the row says when it comes back, counted from the tick — R-5',
      (await plants.locator('[data-testid="repeat-due"]').innerText()).trim() === 'due in 5 days',
      await plants.innerText(),
    );
    // The waiting state is the one worth a picture: it is the only row in the
    // app that is ticked and still in its list.
    await page.screenshot({ path: join(shots, 'timely.png'), fullPage: true });

    // The claim R-3 rests on, read off the folder rather than off the screen:
    // the tick is a `set day` and there is no `done` on this row anywhere.
    const choreId = await plants.getAttribute('data-row-id');
    // Waited for rather than read: the write is on `device-log.ts`'s 250 ms
    // debounce, and reading straight after the click races it — the same reason
    // `landed` exists. Every file in the folder, because the device this page is
    // running as is not the seeded peer whose id `landed` knows.
    const wrote = await page
      .waitForFunction(
        (id) => {
          const lines = Object.keys(localStorage)
            .filter((key) => key.startsWith('checklist:folder:'))
            .map((key) => localStorage.getItem(key) ?? '')
            .join('\n')
            .split('\n')
            .filter((line) => line.includes(`"${id}"`));
          const seen = {
            day: lines.some((line) => line.includes('"day"')),
            every: lines.some((line) => line.includes('"every":"5d"')),
            done: lines.some((line) => line.includes('"done"')),
          };
          return seen.day && seen.every ? seen : null;
        },
        choreId,
        { timeout: 10_000 },
      )
      .then((handle) => handle.jsonValue())
      .catch(() => ({ day: false, every: false, done: true }));
    check(
      'the tick wrote a day and never a tick — R-3',
      wrote.day && wrote.every && !wrote.done,
      JSON.stringify(wrote),
    );

    await page.locator('[data-testid="done-link"]').click();
    await page.waitForSelector('[data-testid="done-page"]');
    check(
      'a chore never reaches the Done view — R-3',
      !(await archivedTitles(page)).includes('Water the plants'),
      (await archivedTitles(page)).join('|'),
    );

    await page.locator('[data-testid="timely-link"]').click();
    await page.waitForSelector('[data-testid="timely-page"]');
    plants = await rowByTitle(page, 'Water the plants');
    await plants.locator('[data-testid="done"]').click();
    plants = await rowByTitle(page, 'Water the plants');
    check(
      'un-ticking brings it back to today, with the same control — R-6',
      (await plants.getAttribute('data-waiting')) === 'false' &&
        !(await plants.locator('[data-testid="done"]').isChecked()),
      await plants.innerText(),
    );

    await plants.locator('[data-testid="row-menu-button"]').click();
    check(
      'the menu carries the period a phone would otherwise have to tap for — R-7',
      (await page.locator('[data-testid="row-menu"] [data-action="repeat"]').innerText()).trim() ===
        'Repeats every 5 days',
      await page.locator('[data-testid="row-menu"]').innerText(),
    );
    check(
      'and offers no kind change: check items, one level — R-1',
      (await page.locator('[data-testid="row-menu"] [data-action^="turn-into-"]').count()) === 0,
      await page.locator('[data-testid="row-menu"]').innerText(),
    );
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="row-menu"]').waitFor({ state: 'detached' });

    await page.locator('[data-testid="all-lists-link"]').click();
    await page.waitForSelector('[data-testid="timely-page"]', { state: 'detached' });
    check(
      'and nothing in All holds a chore — R-1',
      !(await titlesOf(page)).includes('Water the plants'),
      (await titlesOf(page)).join('|'),
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
    // The tick has to land in a later millisecond than the delete above, or the
    // two rows tie: `archivedRows` sorts by stamp and breaks a tie by id, which
    // is deterministic but is not the "newest first" the check below is about.
    // The two events are a handful of round trips apart and that is usually
    // enough on its own — usually is not a thing to assert against.
    await page.waitForTimeout(5);
    await (await rowByTitle(page, 'Milk')).locator('[data-testid="done"]').click();
    check(
      'ticking a row takes it out of its list',
      !(await titlesUnder(page, 'Shopping')).includes('Milk'),
      (await titlesUnder(page, 'Shopping')).join('|'),
    );

    // --- T-12: the Done view ----------------------------------------------
    await page.locator('[data-testid="done-link"]').click();
    await page.waitForSelector('[data-testid="done-page"]');
    // Ticked and deleted in one list, and the seeded pair are older than the two
    // this run made — so the order is the only thing that can produce this.
    const archived = await archivedTitles(page);
    check(
      'the Done view holds every ticked and deleted row in one list, newest first — T-12',
      archived.join('|') === 'Milk|Oat milk|Old receipts|Bread',
      archived.join('|'),
    );
    const paths = (await page.locator('[data-testid="archived-path"]').allInnerTexts()).map((t) => t.trim());
    check(
      'each row carries the path it sat on',
      paths.filter((path) => path === 'Shopping').length === 3,
      paths.join('|'),
    );
    await page.screenshot({ path: join(shots, 'done.png'), fullPage: true });

    // One control, whichever way the row left. On a ticked row it is an ordinary
    // field write, so the row goes back to its list.
    await archivedRowByTitle(page, 'Milk').locator('[data-testid="restore"]').click();
    check(
      'restoring a ticked row returns it to its list',
      (await archivedTitles(page)).join('|') === 'Oat milk|Old receipts|Bread',
      (await archivedTitles(page)).join('|'),
    );
    await landed(page, '"done":false');
    await page.goto(BASE_URL);
    await page.waitForSelector('[data-testid="tree"]');
    check(
      'and the list has it back',
      (await titlesUnder(page, 'Shopping')).join('|') === 'Milk|Coffee beans',
      (await titlesUnder(page, 'Shopping')).join('|'),
    );

    // --- T-9: the path back up, on the page that draws it ------------------
    // A nested folder, because the root has no path — and the page is the only
    // thing that draws one at all since X-31 took the pane's copy away.
    await page.goto(`${BASE_URL}#/n/n_seed0006`);
    await page.waitForSelector('[data-testid="breadcrumbs"]');
    const crumbs = (await page.locator('[data-testid="breadcrumbs"]').innerText()).replace(/\s+/g, ' ');
    check('breadcrumbs name the path back up — T-9', crumbs.includes('All') && crumbs.includes('House'), crumbs);
    await page.goto(BASE_URL);
    await page.waitForSelector('[data-testid="tree"]');

    // --- the note pane, beside the list — X-21, X-23 ----------------------
    // The left edge is measured rather than looked at: X-23's whole claim is
    // that the list does not move when the pane opens, and a centred column
    // would slide sideways by half the pane's width every time.
    const listLeft = async () =>
      Math.round((await page.locator('[data-testid="page-header"]').boundingBox()).x);
    const closedLeft = await listLeft();
    const rowsListOnly = await page.locator('[data-testid="tree"] [data-testid="row"]').count();

    await (await rowByTitle(page, 'Trip notes')).locator('[data-testid="open"]').click();
    await page.waitForSelector('[data-testid="note-pane"]');
    const pane = page.locator('[data-testid="note-pane"]');
    check(
      'a note opens its own page with its body — K-3',
      (await page.locator('[data-testid="note-body"]').inputValue()).startsWith('Ferry leaves'),
    );
    // X-31. The pane is the editor and the tree is the list: no path over the
    // note, and no second copy of rows the column beside it already draws.
    check(
      'the pane draws neither a path nor the note’s own children — X-31',
      (await pane.locator('[data-testid="tree"]').count()) === 0 &&
        (await pane.locator('[data-testid="breadcrumbs"]').count()) === 0,
    );
    check(
      'and K-4’s children are still on screen, nested under the note’s own row',
      (await titlesUnder(page, 'Trip notes')).includes('Book the ferry'),
      (await titlesUnder(page, 'Trip notes')).join('|'),
    );
    const paneBox = await pane.boundingBox();
    const listBox = await page.locator('[data-testid="page-header"]').boundingBox();
    check(
      'and the list it was opened from is still on screen, beside it — X-21',
      (await page.locator('[data-testid="tree"] [data-testid="row"]').count()) === rowsListOnly &&
        paneBox.x > listBox.x + listBox.width - 1,
      `list ${Math.round(listBox.x)}+${Math.round(listBox.width)}, pane at ${Math.round(paneBox.x)}`,
    );
    // The complaint X-31 answers, measured: a five-line field with the rest of
    // the pane empty under it.
    const bodyBox = await page.locator('[data-testid="note-body"]').boundingBox();
    check(
      'the body takes the height left under the title — X-31',
      bodyBox.height > paneBox.height * 0.6,
      `${Math.round(bodyBox.height)} of ${Math.round(paneBox.height)}`,
    );
    check(
      'and the add line is above it rather than under the list it no longer draws — X-31, K-8',
      (await pane.locator('[data-testid="quick-add"]').boundingBox()).y < bodyBox.y,
    );
    // The caret arriving swaps B-3's overlay for the field itself, so the height
    // has to be the field's and not the rendered block's — the first cut put it
    // on the overlay alone and the note was edited through two rows.
    const body = page.locator('[data-testid="note-body"]');
    const written = await body.inputValue();
    await body.click();
    const editingBox = await body.boundingBox();
    check(
      'and it is still that tall once the caret is in it — X-31',
      Math.abs(editingBox.height - bodyBox.height) <= 2,
      `${Math.round(bodyBox.height)} reading, ${Math.round(editingBox.height)} editing`,
    );
    // Headings every few lines, because they are what make the rendered half
    // taller than the text in the field over it.
    await body.fill(
      Array.from({ length: 40 }, (_, i) => (i % 5 === 0 ? `# Part ${i / 5 + 1}` : `Line ${i + 1}.`)).join('\n'),
    );
    const longBox = await body.boundingBox();
    const scrolls = await body.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    check(
      'a body longer than the pane scrolls in the field rather than growing it — X-31',
      scrolls && Math.abs(longBox.height - bodyBox.height) <= 2,
      `${Math.round(longBox.height)} tall, ${scrolls ? 'scrolls' : 'grew'}`,
    );
    // B-3's two boxes over X-31's one scrollbar: the field on top is what the
    // wheel reaches, so the rendered view has to follow it or a long note would
    // sit frozen while the text scrolled invisibly behind it.
    await pane.locator('[data-testid="page-title"]').click();
    await page.waitForSelector('[data-testid="note-rendered"]');
    // By proportion, so the field's last line is the view's last line too.
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(100);
    const bothBoxes = await pane.evaluate((el) => {
      const left = (box) => box.scrollHeight - box.clientHeight - box.scrollTop;
      const view = el.querySelector('[data-testid="note-rendered"]');
      return {
        field: el.querySelector('[data-testid="note-body"]').scrollTop,
        view: view.scrollTop,
        left: left(view),
      };
    });
    check(
      'and the rendered view scrolls with the field over it, to its own end — X-31, B-3',
      bothBoxes.field > 0 && bothBoxes.left <= 1,
      `field ${Math.round(bothBoxes.field)}, view ${Math.round(bothBoxes.view)}, ${Math.round(bothBoxes.left)}px short`,
    );
    // Put the note back, and *blur* it: a body becomes an op on blur or after
    // K-7's second of quiet, so a restore typed a moment before the pane closes
    // is a restore that never happened — which is how this check first left the
    // 40 lines behind for F-1 and X-22 to trip over.
    await body.fill(written);
    await pane.locator('[data-testid="page-title"]').click();
    await page.waitForFunction(
      (text) => document.querySelector('[data-testid="note-rendered"]')?.innerText.startsWith(text),
      written.slice(0, 12),
    );
    check(
      'and the note is back to what it said, for the checks downstream that read it',
      (await body.inputValue()) === written,
      (await body.inputValue()).split('\n')[0],
    );
    const openLeft = await listLeft();
    await page.locator('[data-testid="note-close"]').click();
    await page.waitForTimeout(150);
    const reclosedLeft = await listLeft();
    check(
      'and the list did not move sideways to make room for it — X-23',
      closedLeft === openLeft && openLeft === reclosedLeft,
      `${closedLeft} then ${openLeft} then ${reclosedLeft}`,
    );
    // --- X-21: a note inside a note swaps the pane, and only the pane ------
    // The count of bodies is what catches the old drawing rather than the
    // pane's own title, which said "Packing list" either way: the parent note
    // used to be drawn as the list on the left, editor and all.
    await (await rowByTitle(page, 'Trip notes')).locator('[data-testid="open"]').click();
    await page.waitForSelector('[data-testid="note-pane"]');
    const listTitle = async () =>
      (await page.locator('[data-testid="page-title"]').first().innerText()).trim();
    const beforeSub = await listTitle();
    // Since X-31 the nested note is opened from the tree on the left, which
    // draws the whole subtree — the pane has no list to click in.
    await (await rowByTitle(page, 'Packing list')).locator('[data-testid="open"]').click();
    await page.waitForFunction(() => location.hash.endsWith('n_seed0012'));
    // The hash changing is the route; the pane redrawing is a frame later, and
    // its own title is what says the redraw happened rather than a timer.
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="note-pane"] [data-testid="page-title"]')?.value ===
        'Packing list',
    );
    const paneTitle = await pane.locator('[data-testid="page-title"]').inputValue();
    check('a note inside a note opens in the pane — X-21', paneTitle === 'Packing list', paneTitle);
    const bodies = await page.locator('[data-testid="note-body"]').count();
    check(
      'and the list beside it is the one already there, not the parent note — X-21',
      (await listTitle()) === beforeSub && bodies === 1,
      `${beforeSub} -> ${await listTitle()}, ${bodies} body on screen`,
    );
    await page.screenshot({ path: join(shots, 'note-nested.png'), fullPage: true });

    // --- X-24: the divider between the list and the note -------------------
    // The pane's own left edge, so the drag runs the other way from X-20's and
    // the sign in `WidthGrip` is the thing under test.
    const paneWidth = async () => Math.round((await pane.boundingBox()).width);
    const startPane = await paneWidth();
    const gripBox = await page.locator('[data-testid="note-resize"]').boundingBox();
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + 200);
    await page.mouse.down();
    await page.mouse.move(gripBox.x - 100, gripBox.y + 200, { steps: 8 });
    await page.mouse.up();
    const widerPane = await paneWidth();
    check(
      'the note is dragged wider by the divider on its left edge — X-24',
      widerPane > startPane + 60,
      `${startPane} -> ${widerPane}`,
    );

    await page.reload();
    await page.waitForSelector('[data-testid="note-pane"]');
    check(
      "and that width is this device's own, so it survives a reload — §2.3",
      (await paneWidth()) === widerPane,
      `${widerPane} -> ${await paneWidth()}`,
    );

    // Back to the default, so every check below measures the layout it was
    // written against.
    await page.locator('[data-testid="note-resize"]').focus();
    await page.keyboard.press('Home');
    check(
      'and the keyboard reaches this grip too',
      (await paneWidth()) === startPane,
      String(await paneWidth()),
    );

    // --- X-30: the caret raises the pane, and the list does not move --------
    // A note two levels down, because that is the only place the requirement
    // can be seen: `listAbove` it is Kitchen and the page on screen is House,
    // so a caret that navigated would move the left column and a caret that
    // does not, does not. The icon on the same row still moves it, and the last
    // check here is that contrast.
    await page.goto(`${BASE_URL}#/n/n_seed0005`);
    await page.waitForSelector('[data-testid="tree"]');
    await listAdd(page, 'add-note').click();
    await page.waitForSelector('[data-testid="note-pane"]');
    check(
      'a note made from the line opens beside it, because the caret is in it — X-30',
      (await pane.getAttribute('data-from-caret')) === 'true' &&
        (await page.evaluate(() => location.hash)) === '#/n/n_seed0005',
      await page.evaluate(() => location.hash),
    );
    await page.keyboard.type('Boiler manual');
    await page.keyboard.press('Tab');
    // The line commits the title on the way past; the caret leaving the field
    // is not the caret leaving the note, so the pane is still here — §10.3.
    await page.locator('[data-testid="page-header"] [data-testid="quick-add"]').click();
    await page.waitForTimeout(150);
    const caretPane = await page.evaluate(() => ({
      hash: location.hash,
      panes: document.querySelectorAll('[data-testid="note-pane"]').length,
      note: document.querySelector('[data-testid="note-pane"] [data-testid="page-title"]')?.value,
      list: document.querySelector('[data-testid="page-header"] ~ div [data-testid="page-title"]')
        ?.value,
    }));
    check(
      'the caret in a note opens it beside the list, and the list is the one on screen — X-30',
      caretPane.hash === '#/n/n_seed0005' &&
        caretPane.panes === 1 &&
        caretPane.note === 'Boiler manual' &&
        caretPane.list === 'House',
      `${caretPane.list} | ${caretPane.note} | ${caretPane.hash}`,
    );
    check(
      'and the pane says whose it is, so its ✕ has something to clear — X-30',
      (await pane.getAttribute('data-from-caret')) === 'true' &&
        (await pane.locator('[data-testid="note-close"]').evaluate((el) => el.tagName)) === 'BUTTON',
    );
    await page.screenshot({ path: join(shots, 'note-caret.png'), fullPage: true });

    await pane.locator('[data-testid="note-close"]').click();
    await page.waitForTimeout(150);
    check(
      'the ✕ on a caret-raised pane closes it and navigates nowhere — X-30',
      (await page.locator('[data-testid="note-pane"]').count()) === 0 &&
        (await page.evaluate(() => location.hash)) === '#/n/n_seed0005',
      await page.evaluate(() => location.hash),
    );

    await (await rowByTitle(page, 'Boiler manual')).locator('[data-testid="title"]').click();
    await page.waitForSelector('[data-testid="note-pane"]');
    // The caret raises a body and nothing else lowers it, so a folder's title —
    // the one kind with nothing behind it — leaves the pane exactly where it
    // was — X-30.
    await (await rowByTitle(page, 'Kitchen')).locator('[data-testid="title"]').click();
    await page.waitForTimeout(150);
    const afterFolder = await page.evaluate(() => ({
      note: document.querySelector('[data-testid="note-pane"] [data-testid="page-title"]')?.value,
      list: document.querySelector('[data-testid="page-header"] ~ div [data-testid="page-title"]')
        ?.value,
    }));
    check(
      'a caret in a folder leaves the pane as it is — X-30',
      afterFolder.note === 'Boiler manual' && afterFolder.list === 'House',
      `${afterFolder.list} | ${afterFolder.note}`,
    );

    // And a task's raises the task, because a check item has a body of its own
    // now — K-12. The left column is the one thing that must not move: the pane
    // followed the caret and the route did not, which is X-30 read on the kind
    // a checklist is mostly made of.
    await (await rowByTitle(page, 'Descale the kettle')).locator('[data-testid="title"]').click();
    await page.waitForTimeout(150);
    const afterTask = await page.evaluate(() => ({
      hash: location.hash,
      note: document.querySelector('[data-testid="note-pane"] [data-testid="page-title"]')?.value,
      list: document.querySelector('[data-testid="page-header"] ~ div [data-testid="page-title"]')
        ?.value,
      caret: document.querySelector('[data-testid="note-pane"]')?.dataset.fromCaret,
    }));
    check(
      'a caret in a task raises the task’s own body, and moves nothing — K-12, X-30',
      afterTask.note === 'Descale the kettle' &&
        afterTask.list === 'House' &&
        afterTask.hash === '#/n/n_seed0005' &&
        afterTask.caret === 'true',
      `${afterTask.list} | ${afterTask.note} | ${afterTask.hash}`,
    );
    await page.screenshot({ path: join(shots, 'task-body-caret.png'), fullPage: true });

    // Navigating is the reader choosing what is on screen, so the route decides
    // both panes again and the caret's note does not follow them — X-30.
    await page.goto(`${BASE_URL}#/n/n_seed0001`);
    await page.waitForSelector('[data-testid="tree"]');
    check(
      'and a navigation closes it, rather than carrying it to the next page — X-30',
      (await page.locator('[data-testid="note-pane"]').count()) === 0,
    );
    await page.goto(`${BASE_URL}#/n/n_seed0005`);
    await page.waitForSelector('[data-testid="tree"]');

    // The contrast the requirement is written against: the icon is a link and
    // behaves like one, so it *does* move the left column — to Kitchen.
    await (await rowByTitle(page, 'Boiler manual')).locator('[data-testid="open"]').click();
    await page.waitForSelector('[data-testid="note-pane"]');
    await page.waitForTimeout(150);
    const iconOpened = await page.evaluate(() => ({
      hash: location.hash,
      list: document.querySelector('[data-testid="page-header"] ~ div [data-testid="page-title"]')
        ?.value,
      caret: document.querySelector('[data-testid="note-pane"]')?.dataset.fromCaret,
    }));
    check(
      'the icon on the same row navigates, and the list becomes the note’s own — X-21',
      iconOpened.hash !== '#/n/n_seed0005' &&
        iconOpened.list === 'Kitchen' &&
        iconOpened.caret === 'false',
      `${iconOpened.list} | ${iconOpened.hash}`,
    );

    // --- X-39: the chip is a task's own way in ------------------------------
    // A task's head is the checkbox, so the link that a folder and a note wear
    // there sits in the strip beside the tags instead. It is on *every* task
    // rather than only the ones with text in them, which is the check a seeded
    // body would not make: the first body has to be reachable too.
    // The census is taken on Shopping, which is the longest list this run has
    // built: a page with one task on it would pass the "on every task" claim by
    // accident.
    await page.goto(`${BASE_URL}#/n/n_seed0001`);
    await page.waitForSelector('[data-testid="tree"]');
    const chips = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid="row"]')];
      const tasks = rows.filter((row) => row.dataset.kind === 'task');
      return {
        tasks: tasks.length,
        chipped: tasks.filter((row) => row.querySelector('[data-testid="body-chip"]')).length,
        elsewhere: rows.filter(
          (row) => row.dataset.kind !== 'task' && row.querySelector('[data-testid="body-chip"]'),
        ).length,
      };
    });
    check(
      'every task row carries the way into its own body, and no other row does — X-39',
      chips.tasks > 0 && chips.chipped === chips.tasks && chips.elsewhere === 0,
      `${chips.chipped}/${chips.tasks} tasks, ${chips.elsewhere} elsewhere`,
    );

    await page.goto(`${BASE_URL}#/n/n_seed0005`);
    await page.waitForSelector('[data-testid="tree"]');
    const kettle = await rowByTitle(page, 'Descale the kettle');
    check(
      'and it says whether there is anything behind it — X-39',
      (await kettle.locator('[data-testid="body-chip"]').getAttribute('data-has-body')) === 'false',
    );

    await kettle.locator('[data-testid="body-chip"]').click();
    await page.waitForSelector('[data-testid="note-pane"]');
    await page.waitForTimeout(150);
    const chipOpened = await page.evaluate(() => ({
      hash: location.hash,
      note: document.querySelector('[data-testid="note-pane"] [data-testid="page-title"]')?.value,
      list: document.querySelector('[data-testid="page-header"] ~ div [data-testid="page-title"]')
        ?.value,
      caret: document.querySelector('[data-testid="note-pane"]')?.dataset.fromCaret,
    }));
    check(
      'the chip navigates, and the task opens beside the list it hangs under — X-39, X-21',
      chipOpened.hash === '#/n/n_seed0007' &&
        chipOpened.note === 'Descale the kettle' &&
        chipOpened.list === 'Kitchen' &&
        chipOpened.caret === 'false',
      `${chipOpened.list} | ${chipOpened.note} | ${chipOpened.hash}`,
    );

    // The same editor, in the same pane: what is typed here is one `set body`
    // on a task — K-12 — and the chip on the row behind it says so.
    await page.locator('[data-testid="note-pane"] [data-testid="note-body"]').click();
    await page.keyboard.type('Half a litre of vinegar, an hour.');
    await page.waitForTimeout(1_200);
    const typedChip = await (await rowByTitle(page, 'Descale the kettle'))
      .locator('[data-testid="body-chip"]')
      .getAttribute('data-has-body');
    check(
      'a body typed on a task is drawn by the chip on its row — K-12, X-39',
      typedChip === 'true',
      `has-body ${typedChip}`,
    );
    await page.screenshot({ path: join(shots, 'task-body.png'), fullPage: true });

    await page.goto(`${BASE_URL}#/n/n_seed0012`);
    await page.waitForSelector('[data-testid="note-pane"]');

    await (await rowByTitle(page, 'Trip notes')).locator('[data-testid="open"]').click();
    await page.waitForSelector('[data-testid="note-body"]');
    check(
      'and the only way to change what a row is, is the row menu — K-5, K-6 withdrawn',
      (await page.locator('[data-testid="promote-to-list"]').count()) === 0,
    );
    await page.screenshot({ path: join(shots, 'note.png'), fullPage: true });
    // --- B-1 to B-6: bold and headings in the body -------------------------
    // The claim B-3 makes is about two views of one value, so it is checked as
    // two views: the marks are visible with the caret in the field, and the
    // formatting is visible without it.
    check(
      'a body is read as rendered, with the field over it — B-3',
      (await page.locator('[data-testid="note-rendered"]').isVisible()) &&
        (await page.locator('[data-testid="note-body"]').evaluate((el) =>
          Number(getComputedStyle(el).opacity),
        )) === 0,
    );
    await page.locator('[data-testid="note-body"]').click();
    check(
      'and as text the moment the caret is in it',
      (await page.locator('[data-testid="note-rendered"]').count()) === 0,
    );

    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nTickets printed.');
    await page.keyboard.press('Home');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');

    // --- B-7: the controls follow the selection ----------------------------
    // The geometry is the claim: a textarea has no range geometry of its own,
    // so this is the only thing that can say the mirror measurement in
    // `text-rect.ts` landed on the selected line rather than at the origin.
    const selectionControls = page.locator('[data-testid="selection-controls"]');
    await selectionControls.waitFor({ state: 'visible', timeout: 5_000 });
    const controlsBox = await selectionControls.boundingBox();
    const fieldBox = await page.locator('[data-testid="note-body"]').boundingBox();
    check(
      'selecting text raises the two controls beside it — B-7',
      controlsBox.y > fieldBox.y &&
        controlsBox.y + controlsBox.height <= fieldBox.y + fieldBox.height &&
        Math.abs(controlsBox.x - fieldBox.x) < 40,
      `controls at ${Math.round(controlsBox.x)},${Math.round(controlsBox.y)} over a field at ${Math.round(fieldBox.x)},${Math.round(fieldBox.y)}`,
    );
    await page.screenshot({ path: join(shots, 'note-selection.png'), fullPage: true });

    await page.locator('[data-testid="selection-bold"]').click();
    check(
      'the pair writes the marks and keeps the words selected — B-4, B-7',
      (await page.locator('[data-testid="note-body"]').inputValue()).endsWith(
        '**Tick**ets printed.',
      ) && (await selectionControls.isVisible()),
      (await page.locator('[data-testid="note-body"]').inputValue()).split('\n').at(-1),
    );
    await page.locator('[data-testid="selection-heading"]').click();
    check(
      'and the heading control marks the line the selection is on — B-4, B-7',
      (await page.locator('[data-testid="note-body"]').inputValue()).endsWith(
        '# **Tick**ets printed.',
      ),
      (await page.locator('[data-testid="note-body"]').inputValue()).split('\n').at(-1),
    );

    await pane.locator('[data-testid="page-title"]').click();
    await page.waitForSelector('[data-testid="note-rendered"]');
    const rendered = page.locator('[data-testid="note-rendered"]');
    check(
      'and the marks are a heading and a bold run when the caret leaves — B-1, B-3',
      (await rendered.locator('h3').innerText()).trim() === 'Tickets printed.' &&
        (await rendered.locator('h3 strong').innerText()).trim() === 'Tick',
      (await rendered.locator('h3').innerText()).trim(),
    );
    check(
      'and no mark is left on screen',
      !(await rendered.innerText()).includes('**') && !(await rendered.innerText()).includes('# '),
      (await rendered.innerText()).replace(/\s+/g, ' '),
    );

    // One control, three states: the row's heading button cycles heading,
    // subheading, none — A-2's flag is the precedent. The bold run survives it.
    await page.locator('[data-testid="note-body"]').click();
    await page.keyboard.press('Control+End');
    check(
      'and the controls go when the selection does — B-7',
      (await selectionControls.count()) === 0,
    );
    const headingButton = page.locator('[data-testid="mark-heading"]');
    await headingButton.click();
    const cycled = await headingButton.getAttribute('data-level');
    await headingButton.click();
    check(
      'the heading control cycles heading, subheading, none — B-4',
      cycled === '2' && (await headingButton.getAttribute('data-level')) === '0',
      `${cycled} then ${await headingButton.getAttribute('data-level')}`,
    );
    await pane.locator('[data-testid="page-title"]').click();
    await page.waitForSelector('[data-testid="note-rendered"]');
    check(
      'pressing a heading level the line already has takes it off — B-4',
      (await rendered.locator('h3').count()) === 0 &&
        (await rendered.locator('p strong').last().innerText()).trim() === 'Tick',
      (await rendered.innerText()).replace(/\s+/g, ' '),
    );
    await page.screenshot({ path: join(shots, 'note-formatted.png'), fullPage: true });
    await landed(page, '**Tick**ets printed.');

    // --- a reload rebuilds it all from the folder — S-21 ------------------
    await page.reload();
    await page.waitForSelector('[data-testid="note-body"]');
    check(
      'the note body survived a reload, marks and all — B-2',
      (await page.locator('[data-testid="note-body"]').inputValue()).endsWith(
        '\n**Tick**ets printed.',
      ),
      (await page.locator('[data-testid="note-body"]').inputValue()).split('\n').at(-1),
    );
    await page.goto(BASE_URL);
    await page.waitForSelector('[data-testid="tree"]');
    const afterReload = await titlesUnder(page, 'Shopping');
    check(
      'the edits survived a reload, folded back out of the op log',
      afterReload.join('|') === 'Milk|Coffee beans',
      afterReload.join('|'),
    );
    // --- B-8, B-9: code, as a box and inside a line ----------------------
    // The box is the one thing on the rendered half that is not a second
    // drawing of the text, so it is checked as a control: it has to be clicked
    // through the transparent field B-3 keeps over it.
    await page.goto(`${BASE_URL}#/n/n_seed0012`);
    await page.waitForSelector('[data-testid="note-body"]');
    const codeField = page.locator('[data-testid="note-body"]');
    await codeField.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nRun:\n');
    await page.locator('[data-testid="mark-code"]').click();
    await page.keyboard.type('npm run dev');
    check(
      'the code control opens a box on an empty line and leaves the caret in it — B-8',
      (await codeField.inputValue()).endsWith('Run:\n```\nnpm run dev\n```'),
      (await codeField.inputValue()).split('\n').slice(-3).join(' / '),
    );

    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nThe short one is docker up.');
    const line = (await codeField.inputValue()).length;
    await codeField.evaluate((el, at) => el.setSelectionRange(at - 10, at - 1), line);
    await page.locator('[data-testid="selection-code"]').waitFor({ state: 'visible' });
    await page.locator('[data-testid="selection-code"]').click();
    check(
      'and a run inside one line becomes inline code instead — B-9',
      (await codeField.inputValue()).endsWith('The short one is `docker up`.'),
      (await codeField.inputValue()).split('\n').at(-1),
    );

    await page.locator('[data-testid="page-title"]').first().click();
    await page.waitForSelector('[data-testid="note-rendered"]');
    const noteView = page.locator('[data-testid="note-rendered"]');
    check(
      'a fenced block draws as one box and an inline run as one word — B-8, B-9',
      (await page.locator('[data-testid="code-block"]').count()) === 1 &&
        (await noteView.locator('code').count()) === 2 &&
        !(await noteView.innerText()).includes('`'),
      (await noteView.innerText()).replace(/\s+/g, ' '),
    );
    await page.screenshot({ path: join(shots, 'note-code.png'), fullPage: true });

    // The click has to reach a button that sits under B-3's transparent field.
    await page.locator('[data-testid="code-copy"]').click();
    check(
      'and Copy puts the block on the clipboard through the field over it — B-8',
      (await page.evaluate(() => navigator.clipboard.readText())) === 'npm run dev',
      await page.locator('[data-testid="code-copy"]').innerText(),
    );
    // --- B-11: bold reads inside code too ----------------------------------
    // The box holds `npm run dev`; the last three characters of it are what
    // gets marked, which is the line-in-a-box case the mark exists for.
    await codeField.click();
    const boxed = (await codeField.inputValue()).indexOf('npm run dev');
    await codeField.evaluate(
      (el, at) => el.setSelectionRange(at + 8, at + 11),
      boxed,
    );
    await page.locator('[data-testid="mark-bold"]').click();
    check(
      'bold is written inside a box as the two characters it is anywhere — B-11',
      (await codeField.inputValue()).includes('npm run **dev**'),
      (await codeField.inputValue()).split('\n').slice(-4).join(' / '),
    );

    await page.locator('[data-testid="page-title"]').first().click();
    await page.waitForSelector('[data-testid="note-rendered"]');
    const box = page.locator('[data-testid="code-block"]').first();
    check(
      'and it draws as bold in the box rather than as four characters — B-11',
      (await box.locator('strong').count()) === 1 &&
        (await box.locator('strong').innerText()).trim() === 'dev' &&
        !(await box.innerText()).includes('*'),
      (await box.innerText()).replace(/\s+/g, ' '),
    );
    await page.locator('[data-testid="code-copy"]').first().click();
    check(
      'and Copy takes the box as it is drawn, without the marks — B-8, B-11',
      (await page.evaluate(() => navigator.clipboard.readText())) === 'npm run dev',
      await page.evaluate(() => navigator.clipboard.readText()),
    );

    // An inline run is cut into spans by the marks in it, and it still has to
    // draw as one pill: a `<code>` per span would put a gap where the space is.
    await codeField.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nand `npm **test**` inline.');
    await page.locator('[data-testid="page-title"]').first().click();
    await page.waitForSelector('[data-testid="note-rendered"]');
    const inline = page.locator('[data-testid="note-rendered"] p code');
    check(
      'a marked inline run is one element with the bold inside it — B-9, B-11',
      (await inline.filter({ has: page.locator('strong') }).count()) === 1 &&
        (await inline.filter({ has: page.locator('strong') }).innerText()).trim() === 'npm test',
      await inline.filter({ has: page.locator('strong') }).innerText(),
    );

    // --- B-10: a list is typed, and Enter is what carries it ---------------
    await codeField.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n- Socks\nBoots\n');
    check(
      'Enter carries a bullet onto the next line — B-10',
      (await codeField.inputValue()).endsWith('- Socks\n- Boots\n- '),
      (await codeField.inputValue()).split('\n').slice(-3).join(' / '),
    );
    await page.keyboard.press('Enter');
    check(
      'and Enter on an item with nothing in it ends the list — B-10',
      (await codeField.inputValue()).endsWith('- Socks\n- Boots\n'),
      (await codeField.inputValue()).split('\n').slice(-3).join(' / '),
    );
    await page.keyboard.type('1. Ferry ticket\nPassport');
    check(
      'a numbered list counts up from the number that was typed — B-10',
      (await codeField.inputValue()).endsWith('1. Ferry ticket\n2. Passport'),
      (await codeField.inputValue()).split('\n').at(-1),
    );

    await page.locator('[data-testid="page-title"]').first().click();
    await page.waitForSelector('[data-testid="note-rendered"]');
    check(
      'and the markers are drawn rather than left on screen — B-10',
      (await noteView.innerText()).replace(/\s+/g, ' ').includes('• Socks • Boots 1. Ferry ticket'),
      (await noteView.innerText()).replace(/\s+/g, ' '),
    );
    await page.screenshot({ path: join(shots, 'note-lists.png'), fullPage: true });

    // --- B-12: a table is typed, and Enter carries the row -----------------
    // The parser owns what a pipe means; what only a browser can show is that
    // the cells are drawn as columns that line up, which is the whole reason
    // to type the pipes rather than to pad them.
    await codeField.click();
    await page.keyboard.press('Control+End');
    // Out of the numbered list above by B-10's own way out, since a line that
    // opens `3. ` is an item whatever else is typed on it.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('| Day | Ferry |');
    await page.keyboard.press('Enter');
    check(
      'Enter opens the next row with the cells the row had — B-12',
      (await codeField.inputValue()).endsWith('| Day | Ferry |\n|  |  |'),
      (await codeField.inputValue()).split('\n').slice(-2).join(' / '),
    );
    // The caret is left between the two spaces of the first cell, so the row is
    // typed rather than navigated to.
    await page.keyboard.type('---');
    for (const _ of [0, 1, 2]) await page.keyboard.press('ArrowRight');
    await page.keyboard.type('---');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Mon');
    for (const _ of [0, 1, 2]) await page.keyboard.press('ArrowRight');
    await page.keyboard.type('07:40');
    check(
      'and the caret lands in the first cell, so the row is typed straight in — B-12',
      (await codeField.inputValue()).endsWith(
        '| Day | Ferry |\n| --- | --- |\n| Mon | 07:40 |',
      ),
      (await codeField.inputValue()).split('\n').slice(-3).join(' / '),
    );

    await page.locator('[data-testid="page-title"]').first().click();
    await page.waitForSelector('[data-testid="note-rendered"]');
    const table = noteView.locator('[data-testid="table-block"]');
    check(
      'the rows draw as one table, with the dashes taken as its header — B-12',
      (await table.count()) === 1 &&
        (await table.locator('th').allInnerTexts()).join('/') === 'Day/Ferry' &&
        (await table.locator('tbody td').allInnerTexts()).join('/') === 'Mon/07:40',
      `${await table.count()} tables, ${(await table.locator('th').allInnerTexts()).join('/')}`,
    );
    const column = await table.evaluate((el) => {
      const head = el.querySelectorAll('th')[1].getBoundingClientRect();
      const cell = el.querySelectorAll('tbody td')[1].getBoundingClientRect();
      return { head: Math.round(head.left), cell: Math.round(cell.left) };
    });
    check(
      'and the second column lines up under its heading, which the pipes never did — B-12',
      column.head === column.cell,
      JSON.stringify(column),
    );
    await page.screenshot({ path: join(shots, 'note-table.png'), fullPage: true });

    // The way out is the one B-10 gave a list: a row with nothing in it.
    await codeField.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    check(
      'and Enter on a row with nothing in it ends the table — B-12',
      (await codeField.inputValue()).endsWith('| Mon | 07:40 |\n'),
      (await codeField.inputValue()).split('\n').slice(-2).join(' / '),
    );

    // B-4's rule applied to a block: the control writes characters a person
    // could have typed, and one button is both directions.
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="mark-table"]').click();
    check(
      'the ▦ control writes a starter table on an empty line — B-12',
      (await codeField.inputValue()).endsWith('|  |  |\n| --- | --- |\n|  |  |'),
      (await codeField.inputValue()).split('\n').slice(-3).join(' / '),
    );
    await page.keyboard.type('Tue');
    check(
      'and leaves the caret in the first cell of it — B-12',
      (await codeField.inputValue()).endsWith('| Tue |  |\n| --- | --- |\n|  |  |') &&
        (await page.locator('[data-testid="mark-table"]').getAttribute('data-in-table')) ===
          'true',
      (await codeField.inputValue()).split('\n').slice(-3).join(' / '),
    );
    await page.locator('[data-testid="mark-table"]').click();
    check(
      'and pressing it from inside takes the pipes off again — B-12',
      (await codeField.inputValue()).endsWith('| Mon | 07:40 |\n\nTue\n'),
      (await codeField.inputValue()).split('\n').slice(-3).join(' / '),
    );

    // --- B-3: the rendered half keeps the spacing the field holds ---------
    await codeField.click();
    await page.keyboard.press('Control+End');
    for (const typed of ['spec:', '  type: NodePort   three between', '    - name: http']) {
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type(typed);
    }
    await page.locator('[data-testid="page-title"]').first().click();
    await page.waitForSelector('[data-testid="note-rendered"]');
    const indented = await noteView
      .locator('p', { hasText: 'type: NodePort' })
      .first()
      .evaluate((el) => el.textContent);
    check(
      'an indented line is drawn where the field put it, spaces and all — B-3',
      indented === '  type: NodePort   three between',
      JSON.stringify(indented),
    );
    const marker = await noteView
      .locator('p', { hasText: 'name: http' })
      .first()
      .evaluate((el) => el.firstElementChild.textContent);
    check(
      "and a list item's indent is the characters it is, in front of the marker — B-10",
      marker === '    \u2022',
      JSON.stringify(marker),
    );
    await page.screenshot({ path: join(shots, 'note-indent.png'), fullPage: true });

    // The body is one JSON string in the op, so a newline in it is `\n` in the
    // file — the run of code is what is looked for rather than the fences.
    await landed(page, 'npm run dev');

    await page.goto(BASE_URL);
    await page.waitForSelector('[data-testid="tree"]');
    await page.locator('[data-testid="done-link"]').click();
    await page.waitForSelector('[data-testid="done-page"]');
    check(
      'and so did the Done view, which is derived rather than stored — T-12',
      (await archivedTitles(page)).join('|') === 'Oat milk|Old receipts|Bread',
      (await archivedTitles(page)).join('|'),
    );

    // --- T-13: restoring, which M1 and M2 could not do --------------------
    // One op, and the subtree comes with it: T-7 never tombstoned the child
    // individually, so clearing the top of the run is the whole operation.
    await archivedRowByTitle(page, 'Old receipts').locator('[data-testid="restore"]').click();
    check(
      'restoring a deleted row takes it out of the archive — T-13',
      (await archivedTitles(page)).join('|') === 'Oat milk|Bread',
      (await archivedTitles(page)).join('|'),
    );
    await landed(page, '"op":"restore"');
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
    // B-5. The body holds `**Tick**ets`, so a term that spans the mark is one
    // only the stripped text can answer — requirements.md §4.3.
    await page.locator('[data-testid="search-input"]').fill('tickets');
    check(
      'a term reaching across a mark still finds the note — B-5',
      (await searchHitTitles(page)).includes('Trip notes'),
      (await searchHitTitles(page)).join('|'),
    );
    check(
      'and the snippet shows the text without its marks',
      !(await page.locator('[data-testid="hit-snippet"]').first().innerText()).includes('**'),
      await page.locator('[data-testid="hit-snippet"]').first().innerText(),
    );
    await page.locator('[data-testid="search-input"]').fill('bread');
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

    // --- X-15, X-16: the sync folder section ----------------------------------
    // This run reaches its folder through `local-folder`, which is the browser
    // itself: there is no folder to show, so what is asserted is that the
    // section names what this device writes to and that a capability this shell
    // does not have is an absent button rather than a dead one —
    // requirements.md §10.2.
    const folderSection = await page.locator('[data-testid="settings-folder-label"]').innerText();
    // The sidebar keeps one line about the folder and only while it is the
    // unsynced fallback, which is what this run is — architecture.md §4.
    const footerWarning = await page.locator('[data-testid="not-synced"]').innerText();
    check(
      'settings names the folder this device syncs through — X-15',
      folderSection.trim() === 'local browser storage' && footerWarning.trim() === 'Local storage',
      `${folderSection} / ${footerWarning}`,
    );
    check(
      'a browser that cannot open a folder offers no button, only the picker — §10.2',
      (await page.locator('[data-testid="open-folder"]').count()) === 0 &&
        (await page.locator('[data-testid="change-folder"]').isVisible()),
    );
    // X-17 was withdrawn: the screen names no cloud app at all, and nothing on
    // it starts one — past_decision.md §16.
    check(
      'the settings screen names no cloud app — X-17 withdrawn',
      (await page.locator('[data-testid="provider"]').count()) === 0 &&
        (await page.locator('[data-testid="open-provider"]').count()) === 0,
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

    // --- X-25: the sidebar's type size --------------------------------------
    // Three things a unit test cannot reach: that the multiplier arrives at the
    // rule rather than only at the attribute, that it survives a reload, and —
    // the one that matters most — that it leaves X-20's width alone.
    const sizeIds = await page
      .locator('[data-testid="sidebar-size-option"]')
      .evaluateAll((buttons) => buttons.map((button) => button.dataset.sidebarSize));
    check(
      'every sidebar size in the catalog is offered — X-25',
      sizeIds.join('|') === 'small|normal|large|maximal',
      sizeIds.join('|'),
    );
    const sidebarType = () =>
      page
        .locator('[data-testid="settings-link"]')
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const sidebarBox = async () =>
      Math.round((await page.locator('[data-testid="sidebar"]').boundingBox()).width);
    const normalType = await sidebarType();
    const widthBefore = await sidebarBox();

    await page.locator('[data-testid="sidebar-size-option"][data-sidebar-size="maximal"]').click();
    await page.waitForTimeout(100);
    const maximalType = await sidebarType();
    check(
      'picking a size sets it on the document root and scales the type — X-25',
      (await page.evaluate(() => document.documentElement.dataset.sidebarSize)) === 'maximal' &&
        Math.abs(maximalType - normalType * 1.4) < 0.5,
      `${normalType} -> ${maximalType}`,
    );
    // §10.4: the type only. The width is the grip's, and a setting that moved it
    // would undo a drag the reader made by hand.
    check(
      'the sidebar type size leaves the dragged width alone — X-25',
      (await sidebarBox()) === widthBefore,
      `${widthBefore} -> ${await sidebarBox()}`,
    );
    await page.screenshot({ path: join(shots, 'sidebar-size-maximal.png'), fullPage: true });

    await page.locator('[data-testid="sidebar-size-option"][data-sidebar-size="small"]').click();
    await page.waitForTimeout(100);
    const smallType = await sidebarType();
    check(
      'small is a fifth under normal — X-25',
      Math.abs(smallType - normalType * 0.8) < 0.5,
      `${normalType} -> ${smallType}`,
    );
    await page.screenshot({ path: join(shots, 'sidebar-size-small.png'), fullPage: true });

    await page.goto(`${BASE_URL}#/settings`);
    await page.waitForSelector('[data-testid="settings-page"]');
    check(
      'the sidebar size survives a reload, and is set before the first paint — X-25',
      (await page.evaluate(() => document.documentElement.dataset.sidebarSize)) === 'small' &&
        (await page.locator('[data-testid="sidebar-size-option"][data-sidebar-size="small"]').getAttribute('aria-pressed')) === 'true',
    );
    await page.locator('[data-testid="sidebar-size-option"][data-sidebar-size="normal"]').click();
    await page.waitForTimeout(100);
    check(
      'normal is X-19s own size, returned to — X-25',
      Math.abs((await sidebarType()) - normalType) < 0.5,
      `${normalType} -> ${await sidebarType()}`,
    );

    // --- X-35: a colour picked over the theme -------------------------------
    // The half a unit test cannot reach: that a pick arrives at the *rule*
    // rather than only at the attribute, that the three tokens it does not name
    // are derived from it, and that clearing one gives the theme its colour
    // back — test.md §3.5.
    //
    // Every colour here is compared as bytes rather than as text: the browser
    // computes `color-mix` to whichever spelling it likes, and the question
    // being asked is what the pixel is.
    const bytesOf = (value) =>
      page.evaluate((colour) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = colour;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
      }, value);
    const sameColour = async (a, b) => {
      const [left, right] = [await bytesOf(a), await bytesOf(b)];
      return left.every((byte, i) => Math.abs(byte - right[i]) <= 2);
    };
    const roleColour = (role) =>
      page
        .locator(`[data-colour-role="${role}"] [data-testid="colour-swatch"]`)
        .evaluate((el) => getComputedStyle(el).backgroundColor);
    const inkFaint = () =>
      page
        .locator('[data-colour-role="ink"] .text-ink-faint')
        .evaluate((el) => getComputedStyle(el).color);
    const themeAccent = await roleColour('accent');
    const themeFaint = await inkFaint();

    check(
      'the picker opens on the colour the app is wearing, not on black — X-35',
      await sameColour(
        await page
          .locator('[data-colour-role="accent"] [data-testid="colour-picker"]')
          .inputValue(),
        themeAccent,
      ),
      `${await page.locator('[data-colour-role="accent"] [data-testid="colour-picker"]').inputValue()} for ${themeAccent}`,
    );

    await page.locator('[data-colour-role="accent"] [data-testid="colour-hex"]').fill('#c81e5a');
    await page.waitForTimeout(100);
    const pickedAccent = await roleColour('accent');
    check(
      'a picked theme colour reaches the rule, not only the attribute — X-35',
      (await page.evaluate(() => document.documentElement.dataset.accentPick)) === '#c81e5a' &&
        !(await sameColour(pickedAccent, themeAccent)) &&
        (await sameColour(pickedAccent, '#c81e5a')),
      `${themeAccent} -> ${pickedAccent}`,
    );

    await page.locator('[data-colour-role="ink"] [data-testid="colour-hex"]').fill('#3a2a55');
    await page.waitForTimeout(100);
    const pickedFaint = await inkFaint();
    check(
      'the tokens a pick does not name are mixed from it, not set to it — X-35',
      (await sameColour(await roleColour('ink'), '#3a2a55')) &&
        !(await sameColour(pickedFaint, themeFaint)) &&
        !(await sameColour(pickedFaint, '#3a2a55')),
      `${themeFaint} -> ${pickedFaint}`,
    );
    await page.screenshot({ path: join(shots, 'settings-picked.png'), fullPage: true });

    // A pick sits on top of a theme rather than replacing one, and the six
    // swatches declare their own accent, so each still previews itself — §10.1.
    check(
      'the theme swatches still preview themselves under a pick — X-35',
      !(await sameColour(
        await page
          .locator('[data-theme-id="green"] .bg-accent')
          .evaluate((el) => getComputedStyle(el).backgroundColor),
        '#c81e5a',
      )),
    );

    await page.goto(`${BASE_URL}#/settings`);
    await page.waitForSelector('[data-testid="settings-page"]');
    check(
      'a pick survives a reload, and is applied before the first paint — X-35',
      (await sameColour(await roleColour('accent'), '#c81e5a')) &&
        (await page
          .locator('[data-colour-role="accent"] [data-testid="colour-hex"]')
          .inputValue()) === '#c81e5a',
    );

    for (const role of ['accent', 'ink']) {
      await page.locator(`[data-colour-role="${role}"] [data-testid="colour-clear"]`).click();
    }
    await page.waitForTimeout(100);
    check(
      'clearing a pick gives the theme its colour back — X-35',
      (await page.evaluate(() => document.documentElement.hasAttribute('data-accent-pick'))) ===
        false &&
        (await sameColour(await roleColour('accent'), themeAccent)) &&
        (await sameColour(await inkFaint(), themeFaint)) &&
        (await page
          .locator('[data-colour-role="accent"] [data-testid="colour-clear"]')
          .count()) === 0,
    );

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
    await landed(page, '"name":"the laptop"');
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
    // X-27. The bar the name used to sit in is the add group's, and the page
    // header is not drawn a second time under it.
    const bar = await page.evaluate(() => {
      const topbar = document.querySelector('[data-testid="topbar"]');
      const header = document.querySelector('[data-testid="page-header"]');
      return {
        holdsTheGroup: topbar.querySelectorAll('[data-testid="add-row"]').length,
        named: /checklist/i.test(topbar.innerText),
        headerDrawn: header !== null && header.getClientRects().length > 0,
        pinned: getComputedStyle(topbar).position,
      };
    });
    check(
      'the phone’s top bar holds the add group and no longer names the app — X-27',
      bar.holdsTheGroup === 1 && !bar.named && !bar.headerDrawn,
      `${bar.holdsTheGroup} groups, named ${bar.named}, page header ${bar.headerDrawn}`,
    );
    check('and it is pinned there, as the page header is above `md` — X-26', bar.pinned === 'sticky', bar.pinned);
    const phoneQuickAdd = page.locator('[data-testid="topbar"] [data-testid="quick-add"]');
    await phoneQuickAdd.fill('Torch batteries');
    await page.keyboard.press('Enter');
    check(
      'and typing in it adds to the list under it — K-8, X-27',
      (await topLevelTitles(page)).includes('Torch batteries'),
      (await topLevelTitles(page)).join('|'),
    );

    // R-1 and R-8 at this width: Timely is one of the routes X-27 fills the bar
    // for, and the line it fills it with is the task-only one — the two kind
    // buttons would offer a folder in a list that holds check items.
    await page.locator('[data-testid="drawer-button"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="timely-link"]').click();
    await page.waitForSelector('[data-testid="timely-page"]');
    // The link closes the drawer on its way out (X-2), and the drawer slides:
    // without this the picture below catches it half gone.
    await page.waitForTimeout(300);
    const phoneTimely = page.locator('[data-testid="topbar"] [data-testid="quick-add"]');
    check(
      'the phone’s bar carries Timely’s line, and it offers no other kind — R-1, X-27',
      (await phoneTimely.count()) === 1 &&
        (await page.locator('[data-testid="topbar"] [data-testid="add-folder"]').count()) === 0,
    );
    await phoneTimely.fill('Rinse the filter');
    await page.keyboard.press('Enter');
    check(
      'and typing in it files a chore that already repeats — R-2',
      (await (await rowByTitle(page, 'Rinse the filter'))
        .locator('[data-testid="repeat-chip"]')
        .innerText()) === '↻ 1d',
      (await titlesOf(page)).join('|'),
    );
    await page.screenshot({ path: join(shots, 'phone-timely.png'), fullPage: true });

    await page.locator('[data-testid="drawer-button"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="all-lists-link"]').click();
    await page.waitForSelector('[data-testid="timely-page"]', { state: 'detached' });

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

    // X-25 on a phone, which is the half the settings screen cannot show: the
    // drawer *is* the sidebar below `md`, so the multiplier has to reach it —
    // the requirement was asked for desktop and Android alike. The width is the
    // drawer's own `w-64` here and X-20 does not apply, so this is the one place
    // "the type only" has to be checked against a width nobody can drag.
    const drawerType = () =>
      page
        .locator('[data-testid="settings-link"]')
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const drawerBox = async () =>
      Math.round((await page.locator('[data-testid="sidebar"]').boundingBox()).width);
    const phoneNormal = await drawerType();
    const phoneWidth = await drawerBox();
    await page.evaluate(() => document.documentElement.setAttribute('data-sidebar-size', 'maximal'));
    await page.waitForTimeout(100);
    check(
      'the drawer scales with the sidebar size too, and keeps its width — X-25',
      Math.abs((await drawerType()) - phoneNormal * 1.4) < 0.5 && (await drawerBox()) === phoneWidth,
      `${phoneNormal} -> ${await drawerType()} at ${await drawerBox()}px`,
    );
    await page.screenshot({ path: join(shots, 'phone-drawer-maximal.png') });
    await page.evaluate(() =>
      document.documentElement.setAttribute('data-sidebar-size', 'normal'),
    );
    // Away from the drawer itself, which sits above the backdrop on purpose.
    await page.locator('[data-testid="drawer-backdrop"]').click({ position: { x: 340, y: 500 } });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(shots, 'phone.png'), fullPage: true });

    // --- X-22: the note as a sheet over the list, sized to what is in it ----
    // Three numbers and a tap, and none of them is reachable below the browser:
    // the height is a `max-height` over rendered content, and the tap target
    // exists only while the sheet is peeked — requirements.md §10.3.
    await (await rowByTitle(page, 'Trip notes')).locator('[data-testid="open"]').click();
    await page.waitForSelector('[data-testid="note-pane"]');
    await page.waitForTimeout(300);
    const sheet = page.locator('[data-testid="note-pane"]');
    const cap = Math.round(844 * 0.6);
    const peeked = await sheet.boundingBox();
    const whole = await sheet.evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
    check(
      'a short note is shown whole, under the 60% cap — X-22',
      Math.round(peeked.height) < cap && whole,
      `${Math.round(peeked.height)} of ${cap}, ${whole ? 'whole' : 'clipped'}`,
    );
    check(
      'and the list it is over is still behind it — X-22',
      await page.locator('[data-testid="tree"] [data-testid="row"]').first().isVisible(),
    );

    // X-36. Which corner the way out is in, at the width where the pane is a
    // sheet: first in the header row and drawn as an arrow, rather than last
    // and drawn as a ✕. Both are one control, so this reads the one element.
    const close = page.locator('[data-testid="note-close"]');
    const closeBox = await close.boundingBox();
    const addBox = await page.locator('[data-testid="note-pane"] [data-testid="add-row"]').boundingBox();
    check(
      'the sheet\'s way out is the arrow in its top left corner — X-36',
      closeBox.x < addBox.x && (await close.innerText()).includes('←'),
      `at x=${Math.round(closeBox.x)} against the add line at ${Math.round(addBox.x)}, reading ${JSON.stringify(await close.innerText())}`,
    );

    // X-37. A peek cannot be typed into — the tap layer above it swallows every
    // tap — so B-4's controls are not drawn on it, and nothing is drawn in
    // their place either.
    check(
      'a peeked sheet draws no format controls and no tag line — X-37',
      !(await sheet.locator('[data-testid="note-controls"]').isVisible()) &&
        !(await sheet.locator('[data-testid="tag-input"]').isVisible()),
    );

    // The tap that opens it, and the thing it must not do on the way: B-3 keeps
    // a transparent textarea over the rendered body, so a bare tap would put a
    // caret and a keyboard into text the reader can see 60% of.
    await page.locator('[data-testid="note-expand"]').click({ position: { x: 195, y: 120 } });
    await page.waitForTimeout(300);
    const opened = await sheet.boundingBox();
    const focused = await page.evaluate(() => document.activeElement?.dataset?.testid ?? 'none');
    check(
      'a second tap opens it fully, and does not land in the field — X-22, B-3',
      Math.round(opened.height) === 844 && focused !== 'note-body',
      `${Math.round(opened.height)}px, focus ${focused}`,
    );
    check(
      'and an open sheet is still the editor alone, list and path on the page under it — X-31',
      (await sheet.locator('[data-testid="tree"]').count()) === 0 &&
        (await sheet.locator('[data-testid="note-body"]').isVisible()),
    );
    await page.screenshot({ path: join(shots, 'phone-note-open.png') });
    check(
      'and an opened one has the controls and the tag line back — X-37',
      (await sheet.locator('[data-testid="note-controls"]').isVisible()) &&
        (await sheet.locator('[data-testid="tag-input"]').isVisible()),
    );

    // X-38. The other way in and the only way back: the grip takes a swipe down
    // and the peek's own layer takes a swipe up, both over pointer events —
    // which is why a mouse drives them here exactly as a finger would.
    const grip = await page.locator('[data-testid="sheet-grip"]').boundingBox();
    await swipe(page, grip.x + grip.width / 2, grip.y + grip.height / 2, 120);
    await page.waitForTimeout(300);
    const swipedDown = await sheet.boundingBox();
    check(
      'a swipe down the grip puts an open sheet back to its peek — X-38',
      Math.round(swipedDown.height) === Math.round(peeked.height),
      `${Math.round(swipedDown.height)}px against the peek's ${Math.round(peeked.height)}px`,
    );
    await swipe(page, 195, swipedDown.y + 40, -120);
    await page.waitForTimeout(300);
    const swipedUp = await sheet.boundingBox();
    check(
      'and a swipe up the peek opens it, exactly as the tap did — X-38',
      Math.round(swipedUp.height) === 844,
      `${Math.round(swipedUp.height)}px`,
    );
    // A drag is not the tap it ends on. The peek's layer answers both, so a
    // swipe *down* on it — which means nothing, since a peek has no down —
    // must not arrive at the tap that would open it.
    await swipe(page, grip.x + grip.width / 2, grip.y + grip.height / 2, 120);
    await page.waitForTimeout(300);
    const back = await sheet.boundingBox();
    await swipe(page, 195, back.y + 40, 120);
    await page.waitForTimeout(300);
    check(
      'and a swipe down the peek does not fall through to the tap that opens it — X-38',
      Math.round((await sheet.boundingBox()).height) === Math.round(peeked.height),
      `${Math.round((await sheet.boundingBox()).height)}px`,
    );
    await swipe(page, 195, (await sheet.boundingBox()).y + 40, -120);
    await page.waitForTimeout(300);
    // And it *slides*: the collapse is sampled every frame, and one frame in
    // between the two heights is the whole claim. Sampling rather than reading
    // one height at a guessed instant, because the guess is what would be flaky.
    const frames = await page.evaluate(async () => {
      const pane = document.querySelector('[data-testid="note-pane"]');
      const grip = document.querySelector('[data-testid="sheet-grip"]');
      const seen = [];
      const from = performance.now();
      grip.click();
      await new Promise((done) => {
        const tick = () => {
          seen.push(Math.round(pane.getBoundingClientRect().height));
          if (performance.now() - from < 400) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      });
      return seen;
    });
    const between = frames.filter((h) => h > Math.round(peeked.height) + 8 && h < 836);
    check(
      'and the sheet slides between the two heights rather than jumping — X-38',
      between.length > 0 && frames[frames.length - 1] === Math.round(peeked.height),
      `${between.length} frames in between, ending at ${frames[frames.length - 1]}px`,
    );
    await swipe(page, 195, (await sheet.boundingBox()).y + 40, -120);
    await page.waitForTimeout(300);

    // The other half of the rule, which is what makes it a rule rather than a
    // fixed height: a body too long to fit stops at the cap.
    const longBody = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of a much longer note.`);
    await page.locator('[data-testid="note-body"]').fill(longBody.join('\n'));
    await page.locator('[data-testid="note-close"]').click();
    await page.waitForTimeout(300);
    await (await rowByTitle(page, 'Trip notes')).locator('[data-testid="open"]').click();
    await page.waitForSelector('[data-testid="note-pane"]');
    await page.waitForTimeout(300);
    const tall = await sheet.boundingBox();
    check(
      'and a long one stops at 60% of the viewport rather than taking it — X-22',
      Math.round(tall.height) === cap,
      `${Math.round(tall.height)} of ${cap}`,
    );
    await page.screenshot({ path: join(shots, 'phone-note-peek.png') });
    await page.locator('[data-testid="note-close"]').click();
    await page.waitForTimeout(200);

    // X-30 stops at the breakpoint: a sheet raised by putting the caret in a
    // title would cover the row being typed into, with the keyboard under it.
    await (await rowByTitle(page, 'Trip notes')).locator('[data-testid="title"]').click();
    await page.waitForTimeout(200);
    check(
      'the caret raises no sheet on a phone — X-30, X-22',
      (await page.locator('[data-testid="note-pane"]').count()) === 0 ||
        !(await page.locator('[data-testid="note-pane"]').isVisible()),
    );
    await page.locator('[data-testid="topbar"] [data-testid="quick-add"]').click();
    await page.keyboard.press('Escape');

    // X-39 at the width the chip exists for. The caret raises nothing here, so
    // the chip is a task's only way into its own body — it is a link, so what it
    // opens is the same route the desktop opened, drawn as X-22's sheet.
    await page.goto(`${BASE_URL}#/n/n_seed0006`);
    await page.waitForSelector('[data-testid="tree"]');
    await (await rowByTitle(page, 'Descale the kettle'))
      .locator('[data-testid="body-chip"]')
      .click();
    await page.waitForSelector('[data-testid="note-pane"]');
    await page.waitForTimeout(300);
    const phoneChip = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="note-pane"]');
      return {
        title: pane?.querySelector('[data-testid="page-title"]')?.value,
        peeked: pane?.dataset.expanded,
        height: Math.round(pane?.getBoundingClientRect().height ?? 0),
      };
    });
    check(
      'the chip is the phone’s way into a task’s body, and it opens as the sheet — X-39, X-22',
      phoneChip.title === 'Descale the kettle' &&
        phoneChip.peeked === 'false' &&
        phoneChip.height <= 844 * 0.6 + 1,
      `${phoneChip.title} at ${phoneChip.height}px, expanded ${phoneChip.peeked}`,
    );
    await page.screenshot({ path: join(shots, 'phone-task-body.png') });

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
    // K-1. The peer's file names a kind this build no longer has. It has to fold
    // to a folder rather than to a line that will not parse — past_decision.md §11.
    const garage = await rowByTitle(page, 'Garage');
    check(
      'a row a peer created as a list arrives as a folder — K-1',
      (await garage.getAttribute('data-kind')) === 'folder',
      String(await garage.getAttribute('data-kind')),
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
    await landed(page, peer.device);
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
    await landed(page, '"title":"Coffee beans"');
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

    // --- press and hold, on a touch screen — T-16 --------------------------
    // Its own context: `hasTouch` is settled when a context is made, and the
    // rest of this run is a mouse. Playwright's touchscreen can only tap, so
    // the hold itself is dispatched over CDP.
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    await seedInto(phone);
    try {
      const touch = await phone.newPage();
      await touch.goto(BASE_URL);
      await touch.waitForSelector('[data-testid="tree"]');
      const finger = await phone.newCDPSession(touch);

      check(
        'a touch screen is what the app thinks it has',
        await touch.evaluate(() => matchMedia('(pointer: coarse)').matches),
      );
      check(
        'there is no grip to reach for — T-16',
        await touch.evaluate(() => {
          const grip = document.querySelector('[data-testid="drag-handle"]');
          return grip !== null && getComputedStyle(grip).display === 'none';
        }),
      );

      const milk = await (await rowByTitle(touch, 'Milk')).boundingBox();
      const beans = await (await rowByTitle(touch, 'Coffee beans')).boundingBox();
      const held = { x: milk.x + milk.width / 2, y: milk.y + milk.height / 2 };

      await fingerAt(finger, 'touchStart', held.x, held.y);
      await touch.waitForTimeout(600);
      check(
        'a finger held on the row picks it up — T-16',
        (await (await rowByTitle(touch, 'Milk')).getAttribute('data-dragging')) === 'true',
      );
      await touch.screenshot({ path: join(shots, 'phone-drag.png') });

      // Two moves again: one to leave the row, one to land in the bottom
      // quarter of the target, which is "after" — src/ui/drag.svelte.ts.
      const landing = beans.y + beans.height - 3;
      await fingerAt(finger, 'touchMove', held.x, (held.y + landing) / 2);
      await fingerAt(finger, 'touchMove', held.x, landing);
      await fingerAt(finger, 'touchEnd', held.x, landing);
      check(
        'and letting go drops it where the finger was — T-16, T-14',
        (await titlesUnder(touch, 'Shopping')).join('|') === 'Coffee beans|Milk',
        (await titlesUnder(touch, 'Shopping')).join('|'),
      );

      // A finger that moves is scrolling the page, not carrying a row.
      await fingerAt(finger, 'touchStart', held.x, held.y);
      await fingerAt(finger, 'touchMove', held.x, held.y + 60);
      await touch.waitForTimeout(600);
      const scrolled = await touch.evaluate(() =>
        [...document.querySelectorAll('[data-testid="row"]')].some(
          (row) => row.dataset.dragging === 'true',
        ),
      );
      await fingerAt(finger, 'touchEnd', held.x, held.y + 60);
      check('a finger that travels is a scroll and picks nothing up — T-16', !scrolled);
    } finally {
      await phone.close();
    }

    // --- G-3: the day turns, and the rollover costs no write ----------------
    // Its own context because it owns the clock: the whole claim is that an
    // item filed for tomorrow is in Today tomorrow *without anything being
    // written*, and the only way to see that is to move the clock and read the
    // folder on both sides of midnight.
    const midnight = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      await midnight.clock.install({ time: new Date('2026-09-08T10:00:00') });
      const { device } = seedLog();
      await seedInto(midnight);
      const day = await midnight.newPage();
      await day.goto(`${BASE_URL}#/tomorrow`);
      await day.waitForSelector('[data-testid="agenda-page"][data-agenda="tomorrow"]');
      await day.locator('[data-testid="quick-add"]:visible').fill('Collect the parcel');
      await day.keyboard.press('Enter');
      // The write debounce is a timer, and the clock is this test's now.
      await day.clock.runFor(500);
      check(
        'an item filed for tomorrow is in Tomorrow and not in Today — G-3',
        (await titlesOf(day)).includes('Collect the parcel'),
        (await titlesOf(day)).join('|'),
      );

      const fileKey = `checklist:folder:checklist.${device}.ops.jsonl`;
      const before = await day.evaluate((key) => localStorage.getItem(key), fileKey);

      await day.clock.setFixedTime(new Date('2026-09-09T10:00:00'));
      await day.locator('[data-testid="agenda-link"][data-agenda="today"]').click();
      await day.waitForSelector('[data-testid="agenda-page"][data-agenda="today"]');
      check(
        'the next day it is in Today, with nothing having happened — G-3',
        (await titlesOf(day)).includes('Collect the parcel'),
        (await titlesOf(day)).join('|'),
      );

      await day.locator('[data-testid="agenda-link"][data-agenda="tomorrow"]').click();
      await day.waitForSelector('[data-testid="agenda-page"][data-agenda="tomorrow"]');
      const after = await day.evaluate((key) => localStorage.getItem(key), fileKey);
      check(
        'and Tomorrow is empty again, with the device file byte-identical — G-3',
        (await day.locator('[data-testid="agenda-empty"]').count()) === 1 && after === before,
        after === before ? 'unchanged' : 'the folder changed',
      );
    } finally {
      await midnight.close();
    }

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
        'and declining still gets a working app, which names the fallback it is on',
        (await firstRun.locator('[data-testid="not-synced"]').innerText()).includes(
          'Local storage',
        ),
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

/**
 * One touch point, dispatched over CDP — Playwright's own touchscreen can only
 * tap, and T-16 is about how long the finger stays down. `touchEnd` carries the
 * points that are *still* down, which for one finger is none.
 */
function fingerAt(session, type, x, y) {
  return session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1, id: 1 }],
  });
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

/**
 * X-38. One pointer drag, in steps rather than in one jump: the sheet reads
 * `pointerdown`, `pointermove` and `pointerup`, and a single move would tell it
 * the pointer had never travelled.
 */
async function swipe(page, x, y, dy) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (const part of [0.25, 0.5, 0.75, 1]) await page.mouse.move(x, y + dy * part);
  await page.mouse.up();
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

/** The archive's rows, in the order it renders them — newest first, T-12. */
async function archivedTitles(page) {
  const titles = await page
    .locator('[data-testid="archived-row"] [data-testid="archived-title"]')
    .allInnerTexts();
  return titles.map((title) => title.trim());
}

/** Exact, because one list now holds both "Milk" and "Oat milk". */
function archivedRowByTitle(page, title) {
  return page.locator('[data-testid="archived-row"]', {
    has: page.locator(`[data-testid="archived-title"]:text-is("${title}")`),
  });
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
