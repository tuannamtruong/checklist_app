// Folder adapter over the browser's File System Access API.
//
// This is the Windows-laptop half: Chrome/Edge can hold a handle to a real
// folder on disk — including one inside Dropbox/OneDrive/Drive — and read and
// write it directly. No API keys, no OAuth, no network code in the app at all.
// The cloud client that is already installed does the syncing.
//
// Not available in Android Chrome (see README §4), which is why the phone half
// needs a wrapper app with the same three methods over Android's SAF.

const DB = "checklist-proto";
const STORE = "handles";

export const supported = () =>
  typeof globalThis.showDirectoryPicker === "function";

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbOp(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error);
  });
}

/** Directory handles survive a reload, so "start the app" does not re-prompt. */
export const saveHandle = (h) => idbOp("readwrite", (s) => s.put(h, "folder"));
export const loadHandle = () => idbOp("readonly", (s) => s.get("folder"));
export const forgetHandle = () => idbOp("readwrite", (s) => s.delete("folder"));

export async function pickFolder() {
  const handle = await showDirectoryPicker({
    mode: "readwrite",
    id: "checklist-proto",
  });
  await saveHandle(handle);
  return handle;
}

/**
 * Chrome re-checks permission on every visit even for a stored handle.
 * `prompt` must be false outside a user gesture, or the call throws.
 */
export async function ensurePermission(handle, { prompt = false } = {}) {
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if (!prompt) return false;
  return (await handle.requestPermission(opts)) === "granted";
}

export function fsaaFolder(handle) {
  return {
    async list() {
      const names = [];
      for await (const name of handle.keys()) names.push(name);
      return names;
    },
    async read(name) {
      try {
        const file = await (await handle.getFileHandle(name)).getFile();
        return await file.text();
      } catch {
        return null; // absent, or being rewritten by the cloud client right now
      }
    },
    async write(name, content) {
      const file = await handle.getFileHandle(name, { create: true });
      const w = await file.createWritable();
      await w.write(content);
      await w.close();
    },
  };
}
