// The browser shell. All the sync logic lives in ../core, which is the same
// code the headless scenario test drives — this file only wires it to a DOM and
// to a folder handle.

import { createDevice } from "../core/folder-sync.mjs";
import { fileNameFor } from "../core/device.mjs";
import {
  ensurePermission,
  forgetHandle,
  fsaaFolder,
  loadHandle,
  pickFolder,
  supported,
} from "../adapters/fsaa-folder.mjs";
import { memoryFolder } from "../adapters/memory-folder.mjs";
import { bridgeInfo, httpFolder } from "../adapters/http-folder.mjs";
import {
  androidFolder,
  androidInfo,
  available as androidAvailable,
  pickAndroidFolder,
} from "../adapters/android-folder.mjs";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const POLL_MS = 3000;
const DEBOUNCE_MS = 600;

let device = null;
/** True between a keystroke and the debounced write that commits it. */
let pendingEdit = false;
let deviceId =
  params.get("device") ||
  localStorage.getItem("proto.device") ||
  `device-${Math.random().toString(36).slice(2, 6)}`;
let polling = null;

// ------------------------------------------------------------------- view

function log(msg, kind = "") {
  const li = document.createElement("li");
  li.className = kind;
  li.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  $("log").prepend(li);
  while ($("log").children.length > 40) $("log").lastChild.remove();
}

function setStatus(text, kind) {
  $("status").textContent = text;
  $("status").className = `pill ${kind}`;
}

function renderConflict(conflict) {
  $("conflict").hidden = !conflict;
  if (!conflict) {
    $("sides").replaceChildren();
    $("merged").value = "";
    return;
  }
  $("sides").replaceChildren(
    ...conflict.map((s) => {
      const box = document.createElement("div");
      const h = document.createElement("h3");
      h.textContent = s.author === deviceId ? "Yours" : `From ${s.author}`;
      const pre = document.createElement("pre");
      pre.textContent = s.text;
      const btn = document.createElement("button");
      btn.textContent = "Keep this one";
      btn.onclick = () => resolve(s.text);
      box.append(h, pre, btn);
      return box;
    }),
  );
  if (!$("merged").value)
    $("merged").value = conflict.map((s) => s.text).join(" / ");
}

function render({ state, conflict }) {
  if (conflict) setStatus("conflict", "bad");
  else setStatus("synced", "ok");

  // Never stomp keystrokes that have not been committed yet. Focus alone is not
  // the test — a focused but idle box must still show incoming edits, or the
  // display quietly contradicts the state behind it.
  if (!pendingEdit) $("text").value = state?.text ?? "";

  $("m-file").textContent = fileNameFor(deviceId);
  $("m-author").textContent = state?.author ?? "—";
  $("m-clock").textContent = state ? JSON.stringify(state.clock) : "—";
  $("m-sync").textContent = new Date().toLocaleTimeString();
  renderConflict(conflict);
}

async function renderFiles(folder) {
  const names = await folder.list();
  $("files").replaceChildren(
    ...names
      .filter((n) => !n.startsWith("."))
      .map((n) => {
        const li = document.createElement("li");
        li.textContent = n;
        if (n === fileNameFor(deviceId)) li.className = "mine";
        return li;
      }),
  );
}

// ------------------------------------------------------------------ actions

async function start(folder, label) {
  device = createDevice({ deviceId, folder, onChange: render });
  await device.load();
  await cycle(folder);

  $("setup").hidden = true;
  $("work").hidden = false;
  $("folder").textContent = label;
  log(`watching ${label} as ${deviceId}`, "ok");

  clearInterval(polling);
  // Polling is the only option: a synced folder has no change notification, and
  // the cloud client writes to it behind our back.
  polling = setInterval(() => cycle(folder), POLL_MS);
  window.addEventListener("focus", () => cycle(folder));
}

async function cycle(folder) {
  try {
    const before = device.state?.text;
    const result = await device.sync();
    if (result.conflict)
      log(`conflict with ${result.conflict.length} versions`, "bad");
    else if (device.state?.text !== before)
      log(
        `picked up "${device.state?.text}" from ${device.state?.author}`,
        "in",
      );
    await renderFiles(folder);
  } catch (err) {
    log(`folder error: ${err.message}`, "bad");
    setStatus("folder unreachable", "warn");
  }
}

async function resolve(text) {
  await device.resolve(text);
  log(`resolved to "${text}"`, "ok");
}

// ------------------------------------------------------------------- wiring

let debounce;
$("text").addEventListener("input", (e) => {
  const text = e.target.value;
  pendingEdit = true;
  clearTimeout(debounce);
  // One file write per keystroke would mean one cloud upload per keystroke.
  debounce = setTimeout(async () => {
    await device.edit(text);
    pendingEdit = false;
    log(`wrote "${text}" to my file`, "out");
  }, DEBOUNCE_MS);
});

$("device").addEventListener("change", (e) => {
  deviceId = e.target.value.trim().replace(/[^\w-]/g, "-") || "device";
  localStorage.setItem("proto.device", deviceId);
  location.reload(); // the device id names our file; simplest to restart clean
});

$("pick").addEventListener("click", async () => {
  // On Android the button is wired to the system picker instead; this
  // listener stays attached, so it has to stand aside.
  if (androidAvailable()) return;
  try {
    const handle = await pickFolder();
    await start(fsaaFolder(handle), handle.name);
  } catch (err) {
    if (err.name !== "AbortError")
      log(`could not open folder: ${err.message}`, "bad");
  }
});

$("keep-merged").addEventListener("click", () => resolve($("merged").value));

$("demo").addEventListener("click", async () => {
  // In-memory folder plus a fake peer, so the merge and the conflict UI can be
  // exercised anywhere — including browsers with no folder access at all.
  const folder = memoryFolder();
  await start(folder, "demo (in memory)");
  window.__injectPeer = async (peer, text, clock) => {
    await folder.write(
      fileNameFor(peer),
      JSON.stringify({
        device: peer,
        author: peer,
        text,
        clock,
        updatedAt: new Date().toISOString(),
      }),
    );
    await cycle(folder);
  };
  log(
    "demo mode: no folder, no network. window.__injectPeer(id, text, clock)",
    "warn",
  );
});

$("device").value = deviceId;

// How this device reaches the folder, best first.
//
// 1. The Android shell handed us one through the Storage Access Framework.
// 2. The local helper was started with --folder. It already holds the folder,
//    so every desktop browser works — the only path Firefox and Safari have.
// 3. Chrome/Edge with a handle we stored earlier: start straight up.
// 4. Chrome/Edge with nothing stored: the user picks a folder.
//
// Which one a device uses is a local detail. Two devices can differ, and sync
// is unaffected, because the folder is the only thing they share.
const android = androidInfo();
const bridge =
  android.configured || androidAvailable()
    ? { configured: false }
    : await bridgeInfo();

if (androidAvailable() && !params.has("demo")) {
  if (android.configured) {
    $("pick").textContent = "Change folder…";
    $("pick").onclick = pickAndroidFolder;
    await start(androidFolder(), android.name);
    log("folder granted through Android's file picker", "ok");
  } else {
    // No folder yet: the picker is the whole first-run experience.
    $("unsupported").hidden = true;
    $("pick").textContent = "Choose folder…";
    $("pick").onclick = pickAndroidFolder;
  }
} else if (bridge.configured && !params.has("demo")) {
  $("pick").hidden = true;
  await start(httpFolder(), bridge.name);
  log(`folder supplied by the local helper: ${bridge.path}`, "ok");
} else {
  if (!supported()) {
    $("unsupported").hidden = false;
    $("unsupported-cmd").hidden = false;
    $("pick").disabled = true;
  }

  // A stored handle makes "start the app" mean start the app, not re-pick the
  // folder. Chrome still asks once to re-grant permission after a restart.
  const stored = supported() ? await loadHandle().catch(() => null) : null;
  if (stored) {
    if (await ensurePermission(stored)) {
      await start(fsaaFolder(stored), stored.name);
    } else {
      $("pick").textContent = `Reopen "${stored.name}"`;
      $("pick").onclick = async () => {
        if (await ensurePermission(stored, { prompt: true }))
          await start(fsaaFolder(stored), stored.name);
        else {
          await forgetHandle();
          location.reload();
        }
      };
    }
  }
}

if (params.has("demo")) $("demo").click();
