// Folder adapter that talks to this device's own loopback helper.
//
// Firefox and Safari have no File System Access API and are not getting one --
// handing a web page a real folder on disk is authority they have decided not
// to grant. So the folder is handed over by the local process that served the
// page instead, over 127.0.0.1.
//
// This is still not a sync server. It is one device's own file bridge, bound to
// loopback, unreachable from the network, and the other device never touches
// it. Both devices could use completely different bridges -- or none, on Chrome
// -- and sync exactly the same, because the only shared thing is the folder.
//
// The wire format is `RemoteStore` (src/sync/remote-store.ts): paths, bytes and
// FileMeta. This file is the shim down to the three flat methods the prototype
// core uses today; when the op log arrives the shim goes and the calls below
// are already the right shape.

const BASE = "/folder";

/** @returns {Promise<{configured: boolean, name?: string, path?: string, exists?: boolean}>} */
export async function bridgeInfo() {
  try {
    const res = await fetch(`${BASE}/info`);
    return res.ok ? await res.json() : { configured: false };
  } catch {
    return { configured: false }; // opened from somewhere without the helper
  }
}

/**
 * The four operations the sync engine will need. `list` returns FileMeta, whose
 * `rev` the engine compares to know whether a peer's chunk has changed --
 * never parses.
 */
export function remoteStore() {
  const file = (path) =>
    `${BASE}/file/${path.split("/").map(encodeURIComponent).join("/")}`;

  return {
    async list(prefix = "") {
      const res = await fetch(
        `${BASE}/list?prefix=${encodeURIComponent(prefix)}`,
      );
      if (!res.ok) throw new Error(`list failed: ${res.status}`);
      return res.json();
    },
    async read(path) {
      const res = await fetch(file(path));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`read failed: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async write(path, bytes) {
      const res = await fetch(file(path), {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: bytes,
      });
      if (!res.ok) throw new Error(`write failed: ${res.status}`);
      return res.json();
    },
    async remove(path) {
      const res = await fetch(file(path), { method: "DELETE" });
      if (!res.ok) throw new Error(`remove failed: ${res.status}`);
    },
  };
}

/** The prototype's flat view: names in, text out. */
export function httpFolder() {
  const store = remoteStore();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return {
    async list() {
      return (await store.list()).map((meta) => meta.path);
    },
    async read(name) {
      const bytes = await store.read(name);
      return bytes === null ? null : decoder.decode(bytes);
    },
    async write(name, content) {
      await store.write(name, encoder.encode(content));
    },
  };
}
