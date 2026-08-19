// A folder reached through Android's Storage Access Framework — the phone path,
// architecture.md §7.2.
//
// No browser on Android can pick a folder, so the shell picks it: the activity
// fires ACTION_OPEN_DOCUMENT_TREE once, takes a *persistable* permission on the
// result so it survives a reboot, and exposes the tree to the page as
// `window.AndroidFolder`.
//
// The bridge is synchronous on the Java side — a @JavascriptInterface call runs
// on the WebView's binder thread rather than the UI thread, so blocking file
// I/O there is correct. These wrappers are async only because the contract is.

import type { FolderAdapter } from '../core/folder';

export interface AndroidBridge {
  hasFolder(): boolean;
  /** The folder's own name, for the shell to show — code-standard.md §1. */
  folderName(): string;
  /** Opens the system picker. The page reloads once a folder is granted. */
  pickFolder(): void;
  list(): string;
  read(name: string): string | null;
  /** An error message, or an empty string. The bridge cannot throw across it. */
  write(name: string, content: string): string;
}

export class AndroidFolderError extends Error {
  constructor(action: string, name: string, message: string) {
    super(`android folder: ${action} ${name} failed: ${message}`);
    this.name = 'AndroidFolderError';
  }
}

export function bridge(): AndroidBridge | null {
  return globalThis.AndroidFolder ?? null;
}

export function androidFolder(android: AndroidBridge): FolderAdapter {
  return {
    async list() {
      const names: unknown = JSON.parse(android.list());
      if (!Array.isArray(names)) throw new AndroidFolderError('listing', 'the folder', 'not a list');
      return names.filter((name): name is string => typeof name === 'string');
    },

    async read(name) {
      // Absent arrives as JS null through the bridge already.
      return android.read(name);
    },

    async write(name, content) {
      const failure = android.write(name, content);
      if (failure) throw new AndroidFolderError('writing', name, failure);
    },
  };
}
