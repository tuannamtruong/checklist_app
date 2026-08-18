// A folder with no disk and no network, for UI tests — glossary.md's UI test
// mode. It is reachable only by explicit opt-in (`?uitest`), because a folder
// that forgets everything on reload is a bug everywhere else.

import type { FolderAdapter } from '../core/folder';

export function memoryFolder(seed: Readonly<Record<string, string>> = {}): FolderAdapter {
  const files = new Map<string, string>(Object.entries(seed));
  return {
    async list() {
      return [...files.keys()];
    },
    async read(name) {
      return files.get(name) ?? null;
    },
    async write(name, content) {
      files.set(name, content);
    },
  };
}
