// A folder reached through the browser's File System Access API — the Windows
// Chrome and Edge path, architecture.md §7.
//
// This is the adapter the design was drawn around: the page holds a handle to a
// real directory, that directory happens to sit inside the provider's synced
// folder, and the provider's own client does the networking. No API key, no
// OAuth, no server, and nothing in the app that knows a cloud exists.
//
// The handle is kept in IndexedDB rather than reissued, because the picker
// needs a user gesture and a startup that always prompted would be a startup
// the user learns to dread. Chrome still re-checks permission on every visit,
// which is why `ensurePermission` exists and why it will not prompt unasked.

import type { FolderAdapter } from '../core/folder';

const DB_NAME = 'checklist';
const STORE = 'handles';
const HANDLE_KEY = 'folder';

export class FsaaFolderError extends Error {
  constructor(action: string, name: string, cause: unknown) {
    super(`folder: ${action} ${name} failed: ${String(cause)}`);
    this.name = 'FsaaFolderError';
    this.cause = cause;
  }
}

export function supported(): boolean {
  return typeof globalThis.showDirectoryPicker === 'function';
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function saveHandle(handle: FileSystemDirectoryHandle): Promise<unknown> {
  return transact('readwrite', (store) => store.put(handle, HANDLE_KEY));
}

export function loadHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return transact<FileSystemDirectoryHandle>('readonly', (store) => store.get(HANDLE_KEY));
}

export function forgetHandle(): Promise<unknown> {
  return transact('readwrite', (store) => store.delete(HANDLE_KEY));
}

/** Only from a click: the picker throws outside a user gesture, by design. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  const handle = await showDirectoryPicker({ mode: 'readwrite', id: 'checklist' });
  await saveHandle(handle);
  return handle;
}

/**
 * `prompt` must stay false outside a user gesture or the call itself throws,
 * so startup asks without prompting and the setup screen's button asks again
 * with one — the `re-grant needed` branch of architecture.md §4.
 */
export async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  { prompt = false } = {},
): Promise<boolean> {
  const options: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };
  if ((await handle.queryPermission(options)) === 'granted') return true;
  if (!prompt) return false;
  return (await handle.requestPermission(options)) === 'granted';
}

export function fsaaFolder(handle: FileSystemDirectoryHandle): FolderAdapter {
  return {
    async list() {
      const names: string[] = [];
      for await (const name of handle.keys()) names.push(name);
      return names;
    },

    async read(name) {
      try {
        const file = await handle.getFileHandle(name);
        return await (await file.getFile()).text();
      } catch {
        // Absent, or being rewritten by the provider's client right now. Both
        // are "nothing to read this cycle" rather than errors — S-7.
        return null;
      }
    },

    async write(name, content) {
      try {
        const file = await handle.getFileHandle(name, { create: true });
        // The writable is a swap file until `close`, which is what keeps a
        // reader from ever seeing half of this — S-8.
        const writable = await file.createWritable();
        await writable.write(content);
        await writable.close();
      } catch (cause) {
        throw new FsaaFolderError('writing', name, cause);
      }
    },
  };
}
