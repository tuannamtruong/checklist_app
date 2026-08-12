// Folder adapter that talks to this device's own loopback helper.
//
// Firefox and Safari have no File System Access API and are not getting one —
// handing a web page a real folder on disk is authority they have decided not
// to grant. So the folder is handed over by the local process that served the
// page instead, over 127.0.0.1.
//
// This is still not a sync server. It is one device's own file bridge, bound to
// loopback, unreachable from the network, and the other device never touches
// it. Both devices could use completely different bridges — or none, on Chrome
// — and sync exactly the same, because the only shared thing is the folder.

const BASE = "/folder";

/** @returns {Promise<{configured: boolean, name?: string, path?: string}>} */
export async function bridgeInfo() {
  try {
    const res = await fetch(`${BASE}/info`);
    return res.ok ? await res.json() : { configured: false };
  } catch {
    return { configured: false }; // opened from somewhere without the helper
  }
}

export function httpFolder() {
  return {
    async list() {
      const res = await fetch(`${BASE}/files`);
      if (!res.ok) throw new Error(`list failed: ${res.status}`);
      return res.json();
    },
    async read(name) {
      const res = await fetch(`${BASE}/file/${encodeURIComponent(name)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`read failed: ${res.status}`);
      return res.text();
    },
    async write(name, content) {
      const res = await fetch(`${BASE}/file/${encodeURIComponent(name)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: content,
      });
      if (!res.ok) throw new Error(`write failed: ${res.status}`);
    },
  };
}
