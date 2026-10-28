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

import { isPictureName, PICTURES, refuseUnlessPicture, type FolderAdapter } from '../core/folder';

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
  /**
   * The directory a name lives in, and its name there. A picture is one level
   * down, in `pictures/` — the only directory this adapter ever opens.
   */
  const place = async (
    name: string,
    create: boolean,
  ): Promise<[FileSystemDirectoryHandle, string]> =>
    isPictureName(name)
      ? [await handle.getDirectoryHandle(PICTURES.slice(0, -1), { create }), name.slice(PICTURES.length)]
      : [handle, name];

  return {
    async list() {
      const names: string[] = [];
      for await (const [name, entry] of handle.entries()) {
        if (entry.kind === 'file') names.push(name);
      }
      try {
        const pictures = await handle.getDirectoryHandle(PICTURES.slice(0, -1));
        for await (const [name, entry] of pictures.entries()) {
          if (entry.kind === 'file') names.push(PICTURES + name);
        }
      } catch {
        // No picture has been written yet, which is a folder and not an error.
      }
      return names;
    },

    async read(name) {
      try {
        const [dir, file] = await place(name, false);
        const content = await (await dir.getFileHandle(file)).getFile();
        return isPictureName(name) ? content : await content.text();
      } catch {
        // Absent, or being rewritten by the provider's client right now. Both
        // are "nothing to read this cycle" rather than errors — S-7.
        return null;
      }
    },

    async write(name, content) {
      try {
        const [dir, fileName] = await place(name, true);
        const file = await dir.getFileHandle(fileName, { create: true });
        // The writable is a swap file until `close`, which is what keeps a
        // reader from ever seeing half of this — S-8.
        const writable = await file.createWritable();
        await writable.write(content);
        await writable.close();
      } catch (cause) {
        throw new FsaaFolderError('writing', name, cause);
      }
    },

    async remove(name) {
      refuseUnlessPicture(name);
      try {
        const [dir, file] = await place(name, false);
        await dir.removeEntry(file);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'NotFoundError') return;
        throw new FsaaFolderError('removing', name, cause);
      }
    },
  };
}
