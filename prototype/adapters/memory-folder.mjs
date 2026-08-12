// Folder adapter backed by a plain object. Lets the UI be exercised without a
// real folder — the demo mode in the browser, and the peer-injection the UI
// test needs.

export function memoryFolder(files = {}) {
  return {
    files,
    async list() {
      return Object.keys(files);
    },
    async read(name) {
      return files[name] ?? null;
    },
    async write(name, content) {
      files[name] = content;
    },
  };
}
