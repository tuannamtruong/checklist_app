// Proves the no-File-System-Access path: the browser reaches the folder through
// the local helper using nothing but fetch(). That is what makes Firefox and
// Safari work, so this test deliberately touches no Chromium-only API.
//
//   NODE_PATH=/home/nam/.npm/_npx/e41f203b7505f1fb/node_modules node prototype/test/bridge.mjs
//
// It starts its own helper on a spare port over a temp folder, then drives two
// browser contexts against it — plus a Node CLI device in the same folder, to
// show a device using a completely different adapter still converges.

import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5199);
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const fail = (name, why) => {
  failures++;
  console.log(`  FAIL ${name}\n       ${why}`);
};

async function expectEventually(name, fn, timeout = 10_000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      if ((last = await fn()) === true) return ok(name);
    } catch (err) {
      last = err.message;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  fail(name, `timed out (last: ${last})`);
}

const folder = await mkdtemp(join(tmpdir(), "checklist-bridge-"));

const helper = spawn(
  process.execPath,
  [join(HERE, "..", "install", "serve.mjs"), "--folder", folder],
  { env: { ...process.env, PORT: String(PORT) }, stdio: "pipe" },
);
await new Promise((resolve, reject) => {
  helper.stdout.on("data", (d) => String(d).includes("app on") && resolve());
  helper.on("error", reject);
  setTimeout(() => reject(new Error("helper did not start")), 5000);
});

const browser = await chromium.launch();
const errors = [];

async function device(name) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => {
    // The browser logs every non-2xx fetch. 404 is a device reading its own
    // file before it has written one; 400 is the traversal probe in step 5.
    const expected = /status of (400|404)/.test(m.text());
    if (m.type() === "error" && !expected) errors.push(`${name}: ${m.text()}`);
  });
  // Hide the Chromium-only API so this exercises exactly the code path Firefox
  // would take. If anything here depended on it, the test would fail.
  await ctx.addInitScript(() => {
    delete window.showDirectoryPicker;
  });
  await page.goto(`${BASE}/?device=${name}`);
  return page;
}

const textOf = (page) => page.locator("#text").inputValue();

console.log("\n1. the helper hands the folder over — no picker involved");
const laptop = await device("laptop");
await expectEventually(
  "no File System Access API is present",
  async () =>
    (await laptop.evaluate(() => typeof window.showDirectoryPicker)) ===
    "undefined",
);
await expectEventually(
  "the editor is live anyway",
  async () => (await laptop.locator("#text").isVisible()) === true,
);
await expectEventually(
  "the folder name is shown",
  async () =>
    (await laptop.locator("#folder").textContent()) === folder.split("/").pop(),
);

console.log("\n2. an edit reaches the real folder on disk");
await laptop.locator("#text").fill("Buy milk");
await expectEventually("checklist.laptop.json exists on disk", async () =>
  (await readdir(folder)).includes("checklist.laptop.json"),
);

console.log("\n3. a second browser device in the same folder converges");
const phone = await device("phone");
await expectEventually(
  "phone reads the laptop's text",
  async () => (await textOf(phone)) === "Buy milk",
);
await phone.locator("#text").fill("Buy milk and eggs");
await expectEventually(
  "laptop picks up the phone's edit",
  async () => (await textOf(laptop)) === "Buy milk and eggs",
);

console.log("\n4. a device on a different adapter converges too");
// The CLI uses the Node fs adapter directly — no browser, no helper.
await new Promise((resolve, reject) => {
  const cli = spawn(
    process.execPath,
    [join(HERE, "..", "install", "cli.mjs"), folder, "tablet", "Buy oat milk"],
    { stdio: "pipe" },
  );
  cli.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error(`cli exited ${code}`)),
  );
});
await expectEventually(
  "both browsers pick up the CLI device's edit",
  async () => {
    return (
      (await textOf(laptop)) === "Buy oat milk" &&
      (await textOf(phone)) === "Buy oat milk"
    );
  },
);
await expectEventually("three files, one per device", async () => {
  const names = (await readdir(folder))
    .filter((n) => n.startsWith("checklist."))
    .sort();
  return (
    names.join() ===
    "checklist.laptop.json,checklist.phone.json,checklist.tablet.json"
  );
});

console.log("\n5. the bridge refuses paths that are not ours");
for (const [label, name] of [
  ["traversal", "../../../etc/passwd"],
  ["arbitrary file", "secrets.txt"],
]) {
  const status = await laptop.evaluate(
    (n) => fetch(`/folder/file/${encodeURIComponent(n)}`).then((r) => r.status),
    name,
  );
  if (status === 400) ok(`rejects ${label} (400)`);
  else fail(`rejects ${label}`, `got ${status}`);
}

if (errors.length) fail("no console/page errors", errors.join("\n       "));
else ok("no console/page errors");

await browser.close();
helper.kill();
await rm(folder, { recursive: true, force: true });
console.log(`\n${failures ? `${failures} failure(s)` : "all checks passed"}`);
process.exit(failures ? 1 : 0);
