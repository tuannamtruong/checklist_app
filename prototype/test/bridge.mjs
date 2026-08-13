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
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
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
/** A fixed id for the CLI device — it has no localStorage to mint one into. */
const TABLET = "33333333";

const helper = spawn(
  "python3",
  [
    join(HERE, "..", "install", "serve.py"),
    "--folder",
    folder,
    "--port",
    String(PORT),
    "--no-browser",
  ],
  { stdio: "pipe" },
);
await new Promise((resolve, reject) => {
  helper.stdout.on(
    "data",
    (d) => String(d).includes("checklist helper:") && resolve(),
  );
  helper.stderr.on("data", (d) => reject(new Error(String(d))));
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
// The id is generated per browser context, so ask the page which one it minted.
const laptopId = await laptop.evaluate(() => localStorage.getItem("proto.deviceId"));
await expectEventually("our file exists on disk, named by device id", async () =>
  (await readdir(folder)).includes(`checklist.${laptopId}.json`),
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
    [join(HERE, "..", "install", "cli.mjs"), folder, TABLET, "Buy oat milk", "--label", "tablet"],
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
  const phoneId = await phone.evaluate(() => localStorage.getItem("proto.deviceId"));
  return (
    names.join() ===
    [`checklist.${laptopId}.json`, `checklist.${phoneId}.json`, `checklist.${TABLET}.json`]
      .sort()
      .join()
  );
});

console.log("\n5. the bridge cannot be walked out of the folder");
// The guarantee is confinement to the folder, not a filename pattern: the op
// log needs `ops/<deviceId>/<seq>.jsonl`, so arbitrary nested paths are legal.
// What must never work is escaping the root.
for (const [label, name] of [
  ["traversal", "../../../etc/passwd"],
  ["absolute path", "/etc/passwd"],
  ["parent segment", "ops/../../escape.json"],
  ["backslash traversal", "..\\..\\windows\\system32"],
]) {
  // Encoded whole, so the separators survive as %2F. Encoding per segment
  // leaves literal dots and the *browser* collapses them before sending --
  // which would prove nothing about the server.
  const status = await laptop.evaluate(
    (n) => fetch(`/folder/file/${encodeURIComponent(n)}`).then((r) => r.status),
    name,
  );
  if (status === 400) ok(`refuses ${label} (400)`);
  else fail(`refuses ${label}`, `got ${status}`);
}

// A caller that is not a browser normalises nothing, which is the case that
// actually matters. Raw request line, literal dots.
const rawStatus = await new Promise((resolve, reject) => {
  const req = httpRequest(
    {
      host: "127.0.0.1",
      port: PORT,
      path: "/folder/file/../../../../etc/passwd",
    },
    (res) => {
      res.resume();
      resolve(res.statusCode);
    },
  );
  req.on("error", reject);
  req.end();
});
if (rawStatus === 400)
  ok("refuses an unnormalised traversal from a non-browser caller");
else
  fail(
    "refuses an unnormalised traversal from a non-browser caller",
    `got ${rawStatus}`,
  );

console.log("\n6. the RemoteStore shape the sync engine will use");
const store = async (fn, arg) => laptop.evaluate(fn, arg);

// Nested paths, which the flat prototype never exercises but the op log needs.
const meta = await store(async () => {
  const res = await fetch("/folder/file/ops/laptop/000001.jsonl", {
    method: "PUT",
    body: new TextEncoder().encode('{"op":1}\n'),
  });
  return res.json();
});
if (meta.path === "ops/laptop/000001.jsonl")
  ok("writes a nested path, creating directories");
else fail("writes a nested path", JSON.stringify(meta));

await expectEventually("it is on disk where it says it is", async () =>
  existsSync(join(folder, "ops", "laptop", "000001.jsonl")),
);

const listed = await store(() =>
  fetch("/folder/list?prefix=ops/").then((r) => r.json()),
);
if (listed.length === 1 && listed[0].path === "ops/laptop/000001.jsonl")
  ok("list(prefix) filters to that subtree");
else fail("list(prefix) filters to that subtree", JSON.stringify(listed));

const fields = Object.keys(listed[0] ?? {})
  .sort()
  .join();
if (fields === "modified,path,rev,size")
  ok("FileMeta carries path, size, rev, modified");
else fail("FileMeta carries path, size, rev, modified", fields);

// The rev is what the engine's cursors compare, so a changed file must change it.
const revBefore = listed[0].rev;
const revAfter = await store(async () => {
  const res = await fetch("/folder/file/ops/laptop/000001.jsonl", {
    method: "PUT",
    body: new TextEncoder().encode('{"op":1}\n{"op":2}\n'),
  });
  return (await res.json()).rev;
});
if (revAfter !== revBefore) ok("rev changes when the file changes");
else fail("rev changes when the file changes", `still ${revAfter}`);

const gone = await store(async () => {
  await fetch("/folder/file/ops/laptop/000001.jsonl", { method: "DELETE" });
  return fetch("/folder/file/ops/laptop/000001.jsonl").then((r) => r.status);
});
if (gone === 404) ok("remove deletes it");
else fail("remove deletes it", `got ${gone}`);

if (errors.length) fail("no console/page errors", errors.join("\n       "));
else ok("no console/page errors");

await browser.close();

console.log("\n7. the helper's own behaviour");

/** Raw request, so headers can be set that a browser would not allow. */
const raw = (options, body) =>
  new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: PORT, ...options },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end(body);
  });

// Another page in the browser must not be able to reach the folder. PUT and
// DELETE are already blocked by preflight; GET is not, so it is checked here.
const foreign = await raw({
  path: "/folder/list",
  headers: { Origin: "http://evil.example" },
});
if (foreign === 403) ok("refuses a folder request from a foreign origin");
else fail("refuses a folder request from a foreign origin", `got ${foreign}`);

const own = await raw({
  path: "/folder/list",
  headers: { Origin: `http://127.0.0.1:${PORT}` },
});
if (own === 200) ok("allows its own origin");
else fail("allows its own origin", `got ${own}`);

// Double-clicking the launcher twice must reopen the app, not fail to bind.
const second = await new Promise((resolve) => {
  const proc = spawn(
    "python3",
    [
      join(HERE, "..", "install", "serve.py"),
      "--folder",
      folder,
      "--port",
      String(PORT),
      "--no-browser",
    ],
    { stdio: "pipe" },
  );
  let out = "";
  proc.stdout.on("data", (d) => (out += d));
  proc.on("exit", (code) => resolve({ code, out }));
});
if (second.code === 0 && second.out.includes("already running"))
  ok("a second launch defers to the first");
else
  fail(
    "a second launch defers to the first",
    `exit ${second.code}: ${second.out.trim()}`,
  );

// Closing the tab does not stop the server, so there has to be a way out.
const quit = await raw({ path: "/api/quit", method: "POST" });
const stopped = await new Promise((resolve) => {
  helper.on("exit", () => resolve(true));
  setTimeout(() => resolve(false), 5000);
});
if (quit === 200 && stopped) ok("POST /api/quit stops the helper");
else
  fail("POST /api/quit stops the helper", `status ${quit}, exited ${stopped}`);

helper.kill();
await rm(folder, { recursive: true, force: true });
console.log(`\n${failures ? `${failures} failure(s)` : "all checks passed"}`);
process.exit(failures ? 1 : 0);
