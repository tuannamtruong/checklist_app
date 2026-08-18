// A folder backed by `localStorage`, one key per file — requirement S-21.
//
// It exists because M1 has one device and no Sync Folder, while the payload is
// already decided: the app writes the real `checklist.<device-id>.ops.jsonl`
// here, and M2 replaces this object with one that reaches a folder the
// provider's client syncs. Nothing above this file knows the difference, which
// is the whole point of holding the contract at three methods.
//
// It is not a sync adapter. `localStorage` is per-origin and nothing mirrors it
// anywhere — architecture.md §4.

import type { FolderAdapter } from '../core/folder';

const PREFIX = 'checklist:folder:';

export class LocalFolderError extends Error {
  constructor(name: string, cause: unknown) {
    super(`local folder: writing ${name} failed: ${String(cause)}`);
    this.name = 'LocalFolderError';
    this.cause = cause;
  }
}

export function localFolder(storage: Storage = window.localStorage): FolderAdapter {
  return {
    async list() {
      const names: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(PREFIX)) names.push(key.slice(PREFIX.length));
      }
      return names;
    },

    async read(name) {
      return storage.getItem(PREFIX + name);
    },

    async write(name, content) {
      try {
        storage.setItem(PREFIX + name, content);
      } catch (cause) {
        // A quota failure here is the log outgrowing the browser's allowance,
        // which is S-14's problem arriving early. Naming the file is what makes
        // it diagnosable — code-standard.md §4.
        throw new LocalFolderError(name, cause);
      }
    },
  };
}
