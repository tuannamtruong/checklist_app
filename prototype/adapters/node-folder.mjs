// Folder adapter over the real filesystem. Used by the tests and the CLI, and
// on a desktop this is genuinely all the app needs: point it at
// C:\Users\you\Dropbox\checklist and the Dropbox client does the rest.

import { readFile, readdir, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

export function nodeFolder(dir) {
  return {
    async list() {
      await mkdir(dir, { recursive: true });
      return readdir(dir);
    },
    async read(name) {
      return readFile(join(dir, name), "utf8").catch(() => null);
    },
    async write(name, content) {
      await mkdir(dir, { recursive: true });
      // Write-then-rename. A cloud client watching the folder must never see a
      // half-written file and upload it; rename is atomic, so it sees only the
      // complete version or nothing.
      const tmp = join(dir, `.${name}.tmp`);
      await writeFile(tmp, content);
      await rename(tmp, join(dir, name));
    },
  };
}
