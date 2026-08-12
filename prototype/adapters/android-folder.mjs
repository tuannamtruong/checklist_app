// Folder adapter over Android's Storage Access Framework.
//
// Android has no File System Access API and cannot run the loopback helper, so
// the folder is handed in by the app shell: MainActivity picks it with
// ACTION_OPEN_DOCUMENT_TREE, keeps the permission across restarts, and exposes
// it to the page as `window.AndroidFolder`.
//
// The bridge is synchronous on the Java side — @JavascriptInterface calls run
// on WebView's own binder thread, not the UI thread, so blocking file I/O there
// is fine. These wrappers are async only to match the other adapters.

export const available = () => typeof globalThis.AndroidFolder !== "undefined";

/** @returns {{ configured: boolean, name?: string }} */
export function androidInfo() {
  if (!available()) return { configured: false };
  return {
    configured: AndroidFolder.hasFolder(),
    name: AndroidFolder.folderName(),
  };
}

/** Opens the system folder picker. The page reloads once a folder is granted. */
export const pickAndroidFolder = () => AndroidFolder.pickFolder();

export function androidFolder() {
  return {
    async list() {
      return JSON.parse(AndroidFolder.list());
    },
    async read(name) {
      // The bridge returns null for absent — which arrives as JS null already.
      return AndroidFolder.read(name);
    },
    async write(name, content) {
      const err = AndroidFolder.write(name, content);
      if (err) throw new Error(err);
    },
  };
}
