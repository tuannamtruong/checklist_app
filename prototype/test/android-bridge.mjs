// Drives the Android code path in a desktop browser by standing in for the
// Java bridge with a synchronous in-page stub — the same shape
// @JavascriptInterface produces: plain sync methods, strings in and out.
//
//   NODE_PATH=/home/nam/.npm/_npx/e41f203b7505f1fb/node_modules node prototype/test/android-bridge.mjs
//
// What this covers: adapters/android-folder.mjs, the startup branch in app.js
// that prefers Android over the picker and the helper, and the sync loop
// running on top of it.
//
// What it cannot cover, and what therefore remains unverified until the APK is
// on a real phone: that the WebView serves .mjs with a JavaScript MIME type
// (MimeCorrectAssetHandler), and every line of Java.

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://localhost:38531";
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

// The stub. Mirrors FolderBridge.java exactly: synchronous, string returns,
// null for an absent file, and a name filter matching NAME_PATTERN.
const STUB = `
  window.__files = {};
  window.__granted = true;
  window.AndroidFolder = {
    hasFolder: () => window.__granted,
    folderName: () => "checklist",
    pickFolder: () => { window.__picked = true; },
    list: () => JSON.stringify(
      Object.keys(window.__files).filter((n) => /^checklist\\.[0-9a-f]{8}\\.json$/.test(n))
    ),
    read: (name) => (name in window.__files ? window.__files[name] : null),
    write: (name, content) => {
      if (!/^checklist\\.[0-9a-f]{8}\\.json$/.test(name)) return "refused: " + name;
      window.__files[name] = content;
      return null;
    },
  };
`;

const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  const expected = /status of (400|404)/.test(m.text());
  if (m.type() === "error" && !expected) errors.push(m.text());
});
// Watch for any attempt to reach the loopback helper. On Android there is no
// helper to reach, so the startup path must not even ask.
const helperRequests = [];
page.on(
  "request",
  (r) => r.url().includes("/folder/") && helperRequests.push(r.url()),
);

await page.addInitScript(STUB);
await page.goto(`${BASE}/?device=phone`);

console.log("\n1. the app boots through the Android bridge");
await expectEventually(
  "editor is live without any picker",
  async () => (await page.locator("#text").isVisible()) === true,
);
await expectEventually(
  "the granted folder name is shown",
  async () => (await page.locator("#folder").textContent()) === "checklist",
);
// bridgeInfo() must be skipped entirely on Android, not merely fall through:
// inside the WebView that request would 404 against the asset loader.
if (helperRequests.length === 0) ok("the loopback helper was never consulted");
else fail("the loopback helper was never consulted", helperRequests.join(", "));

console.log("\n2. edits reach the folder through the bridge");
// The device is identified by a generated id, not by the name in the header,
// so the test has to ask the page which id it minted.
const phoneId = await page.evaluate(() =>
  localStorage.getItem("proto.deviceId"),
);
const myFile = `checklist.${phoneId}.json`;
const LAPTOP = "77777777";
if (/^[0-9a-f]{8}$/.test(phoneId)) ok(`minted a device id (${phoneId})`);
else fail("minted a device id", String(phoneId));

await page.locator("#text").fill("Buy milk");
await expectEventually("the bridge received our file", async () => {
  const files = await page.evaluate(() => Object.keys(window.__files));
  return files.join() === myFile;
});
await expectEventually("the file holds a valid snapshot", async () => {
  const snap = await page.evaluate(
    (f) => JSON.parse(window.__files[f]),
    myFile,
  );
  return (
    snap.text === "Buy milk" &&
    snap.device === phoneId &&
    snap.label === "phone" &&
    snap.sClock[phoneId] === 1
  );
});
await page.screenshot({
  path: `${SHOTS}/android-1-edited.png`,
  fullPage: true,
});

console.log("\n3. a laptop's file appearing in the folder is picked up");
await page.evaluate(
  ([id, laptop]) => {
    window.__files[`checklist.${laptop}.json`] = JSON.stringify({
      device: laptop,
      label: "laptop",
      author: laptop,
      text: "Buy milk and eggs",
      sClock: { [id]: 1, [laptop]: 1 },
      updatedAt: new Date().toISOString(),
    });
  },
  [phoneId, LAPTOP],
);
await expectEventually(
  "text arrives from the laptop",
  async () =>
    (await page.locator("#text").inputValue()) === "Buy milk and eggs",
);
await expectEventually(
  "no conflict — it was causally later",
  async () => (await page.locator("#conflict").isHidden()) === true,
);

console.log(
  "\n4. a concurrent laptop edit raises the conflict, on the phone only",
);
await page.locator("#text").fill("Buy oat milk");
await expectEventually("our edit lands", async () => {
  const snap = await page.evaluate(
    (f) => JSON.parse(window.__files[f]),
    myFile,
  );
  return snap.text === "Buy oat milk";
});
await page.evaluate(
  ([id, laptop]) => {
    window.__files[`checklist.${laptop}.json`] = JSON.stringify({
      device: laptop,
      label: "laptop",
      author: laptop,
      text: "Buy milk, eggs and bread",
      sClock: { [id]: 1, [laptop]: 2 },
      updatedAt: new Date().toISOString(),
    });
  },
  [phoneId, LAPTOP],
);
await expectEventually(
  "conflict panel appears",
  async () => (await page.locator("#conflict").isVisible()) === true,
);
await expectEventually("both sides are offered", async () => {
  const texts = await page.locator("#sides pre").allTextContents();
  return (
    texts.length === 2 &&
    texts.includes("Buy oat milk") &&
    texts.includes("Buy milk, eggs and bread")
  );
});
await expectEventually("nothing was written while conflicted", async () => {
  const snap = await page.evaluate(
    (f) => JSON.parse(window.__files[f]),
    myFile,
  );
  return snap.text === "Buy oat milk"; // still ours, untouched
});
await page.screenshot({
  path: `${SHOTS}/android-2-conflict.png`,
  fullPage: true,
});

console.log("\n5. resolving writes a version that dominates both");
await page.locator("#sides button").first().click();
await expectEventually(
  "conflict clears",
  async () => (await page.locator("#conflict").isHidden()) === true,
);
await expectEventually(
  "the written sClock dominates the laptop's",
  async () => {
    const snap = await page.evaluate(
      (f) => JSON.parse(window.__files[f]),
      myFile,
    );
    return snap.sClock[LAPTOP] >= 2 && snap.sClock[phoneId] >= 2;
  },
);
await page.screenshot({
  path: `${SHOTS}/android-3-resolved.png`,
  fullPage: true,
});

console.log("\n6. layout at phone size");
const overflow = await page.evaluate(
  () => document.body.scrollWidth - window.innerWidth,
);
if (overflow <= 0) ok("no horizontal overflow");
else fail("no horizontal overflow", `overflows by ${overflow}px`);

console.log("\n7. first run, before a folder is granted");
const fresh = await browser.newPage({ viewport: { width: 390, height: 844 } });
fresh.on("pageerror", (e) => errors.push(`fresh: ${e.message}`));
await fresh.addInitScript(`${STUB} window.__granted = false;`);
await fresh.goto(`${BASE}/?device=phone2`);
await expectEventually(
  "the setup screen is shown",
  async () => (await fresh.locator("#setup").isVisible()) === true,
);
await expectEventually(
  "the picker button is enabled",
  async () => (await fresh.locator("#pick").isEnabled()) === true,
);
await fresh.locator("#pick").click();
await expectEventually(
  "tapping it calls the system picker, not the web one",
  async () => (await fresh.evaluate(() => window.__picked === true)) === true,
);

if (errors.length) fail("no console/page errors", errors.join("\n       "));
else ok("no console/page errors");

await browser.close();
console.log(
  `\n${failures ? `${failures} failure(s)` : "all checks passed"} — screenshots in ${SHOTS}`,
);
process.exit(failures ? 1 : 0);
