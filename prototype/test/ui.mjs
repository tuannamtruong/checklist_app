// Checks the browser shell: that it renders, that a peer file appearing in the
// folder is picked up, and that a concurrent one raises the conflict UI.
//
//   NODE_PATH=/home/nam/.npm/_npx/e41f203b7505f1fb/node_modules node prototype/test/ui.mjs
//
// It runs in demo mode against an in-memory folder. The real folder path cannot
// be automated — showDirectoryPicker() opens an OS dialog Playwright cannot
// drive — so correctness of the merge is proved by scenario.mjs instead. What
// this covers is the wiring: DOM in, DOM out.

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

// `import` ignores NODE_PATH; CommonJS resolution honours it.
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://localhost:5175";
const SHOTS = process.env.SHOTS ?? "/tmp/checklist-proto";
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const fail = (name, why) => {
  failures++;
  console.log(`  FAIL ${name}\n       ${why}`);
};

async function expectEventually(name, fn, timeout = 8000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      if ((last = await fn()) === true) return ok(name);
    } catch (err) {
      last = err.message;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  fail(name, `timed out (last: ${last})`);
}

const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(`${BASE}/?device=laptop&demo=1`);

console.log("\n1. starts up in demo mode");
await expectEventually(
  "editor is shown",
  async () => (await page.locator("#text").isVisible()) === true,
);
await expectEventually(
  "status is synced",
  async () => (await page.locator("#status").textContent()) === "synced",
);

console.log("\n2. a local edit writes exactly one file — ours");
await page.locator("#text").fill("Buy milk");
await expectEventually(
  "our file appears in the folder",
  async () =>
    (await page.locator("#files li").allTextContents()).join() ===
    "checklist.laptop.json",
);
await expectEventually(
  "the version vector counts our edit",
  async () => (await page.locator("#m-clock").textContent()) === '{"laptop":1}',
);
await page.screenshot({ path: `${SHOTS}/1-edited.png`, fullPage: true });

console.log("\n3. a peer file that is causally newer is adopted silently");
// The phone saw our edit (laptop:1) and then made its own.
await page.evaluate(() =>
  window.__injectPeer("phone", "Buy milk and eggs", { laptop: 1, phone: 1 }),
);
await expectEventually(
  "text updates from the peer",
  async () =>
    (await page.locator("#text").inputValue()) === "Buy milk and eggs",
);
await expectEventually(
  "no conflict raised",
  async () => (await page.locator("#conflict").isHidden()) === true,
);
await expectEventually(
  "author is attributed to the phone",
  async () => (await page.locator("#m-author").textContent()) === "phone",
);

console.log("\n4. a peer file that raced raises the conflict UI");
await page.locator("#text").fill("Buy milk, eggs and bread");
await expectEventually(
  "our edit lands",
  async () =>
    (await page.locator("#m-clock").textContent())?.includes('"laptop":2') ===
    true,
);
// The phone edited from the state before ours — neither vector dominates.
await page.evaluate(() =>
  window.__injectPeer("phone", "Buy oat milk", { laptop: 1, phone: 2 }),
);
await expectEventually(
  "conflict panel appears",
  async () => (await page.locator("#conflict").isVisible()) === true,
);
await expectEventually("both sides are offered", async () => {
  const texts = await page.locator("#sides pre").allTextContents();
  return (
    texts.length === 2 &&
    texts.includes("Buy milk, eggs and bread") &&
    texts.includes("Buy oat milk")
  );
});
await expectEventually(
  "status shows conflict",
  async () => (await page.locator("#status").textContent()) === "conflict",
);
await page.screenshot({ path: `${SHOTS}/2-conflict.png`, fullPage: true });

console.log("\n5. resolving clears it and dominates both sides");
await page.locator(".conflict details summary").click();
await page.locator("#merged").fill("Buy oat milk, eggs and bread");
await page.locator("#keep-merged").click();
await expectEventually(
  "conflict clears",
  async () => (await page.locator("#conflict").isHidden()) === true,
);
await expectEventually(
  "text is the merge",
  async () =>
    (await page.locator("#text").inputValue()) ===
    "Buy oat milk, eggs and bread",
);
await expectEventually("the resolution dominates both", async () => {
  const clock = JSON.parse(await page.locator("#m-clock").textContent());
  return clock.laptop >= 3 && clock.phone >= 2;
});
await page.screenshot({ path: `${SHOTS}/3-resolved.png`, fullPage: true });

console.log("\n6. layout");
const overflow = await page.evaluate(
  () => document.body.scrollWidth - window.innerWidth,
);
if (overflow <= 0) ok("no horizontal overflow");
else fail("no horizontal overflow", `overflows by ${overflow}px`);

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(`${BASE}/?device=phone&demo=1`);
await phone.locator("#text").fill("Buy milk");
const phoneOverflow = await phone.evaluate(
  () => document.body.scrollWidth - window.innerWidth,
);
if (phoneOverflow <= 0) ok("no horizontal overflow at phone width");
else
  fail(
    "no horizontal overflow at phone width",
    `overflows by ${phoneOverflow}px`,
  );
await phone.screenshot({ path: `${SHOTS}/4-phone-width.png`, fullPage: true });

if (errors.length) fail("no console/page errors", errors.join("\n       "));
else ok("no console/page errors");

await browser.close();
console.log(
  `\n${failures ? `${failures} failure(s)` : "all checks passed"} — screenshots in ${SHOTS}`,
);
process.exit(failures ? 1 : 0);
