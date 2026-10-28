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
//
// The bridge carries strings, so a picture crosses it as base64 both ways —
// architecture.md §7.2. If that is ever too slow to draw with, the shell
// serves `pictures/` through a path handler instead — past_decision.md §23.5.

import { isPictureName, refuseUnlessPicture, type FolderAdapter } from '../core/folder';

export interface AndroidBridge {
  hasFolder(): boolean;
  /** The folder's own name, for the shell to show — code-standard.md §1. */
  folderName(): string;
  /** Opens the system picker. The page reloads once a folder is granted. */
  pickFolder(): void;
  /**
   * X-15. Shows the granted folder in whatever app the system opens a folder
   * with. Returns an empty string, or a message the page can show — a bridge
   * cannot throw across into JavaScript.
   *
   * Optional: an APK built before X-15 does not have it, and the settings
   * screen feature-detects rather than assuming — architecture.md §4.1.
   */
  openFolder?(): string;
  list(): string;
  /** A picture's content is base64 — see the header. */
  read(name: string): string | null;
  /** An error message, or an empty string. The bridge cannot throw across it. */
  write(name: string, content: string): string;
  /** P-8. An error message, or an empty string; the Java side refuses a log too. */
  remove(name: string): string;
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
      const content = android.read(name);
      return content !== null && isPictureName(name) ? fromBase64(content) : content;
    },

    async write(name, content) {
      const text = typeof content === 'string' ? content : await toBase64(content);
      const failure = android.write(name, text);
      if (failure) throw new AndroidFolderError('writing', name, failure);
    },

    async remove(name) {
      refuseUnlessPicture(name);
      const failure = android.remove(name);
      if (failure) throw new AndroidFolderError('removing', name, failure);
    },
  };
}

/** A `String.fromCharCode` per chunk, since one call over 300 KB of arguments overflows the stack. */
async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Blob {
  return new Blob([Uint8Array.from(atob(text), (char) => char.charCodeAt(0))]);
}
