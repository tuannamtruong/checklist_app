// The sync cycle, generic over the folder it is handed.
//
// Both the Node tests and the browser app run *this* code — only the adapter
// underneath differs. That is deliberate: a scenario proved headlessly is a
// statement about the real app, not about a test double.
//
// A Folder adapter is three methods, all any storage can offer:
//   list()               -> Promise<string[]>
//   read(name)           -> Promise<string | null>
//   write(name, content) -> Promise<void>

import {
  applyPeers,
  deviceIdFrom,
  fileNameFor,
  localEdit,
  resolveWith,
} from "./device.mjs";

/** @typedef {import("./merge.mjs").Snapshot} Snapshot */

export function createDevice({
  deviceId,
  folder,
  now = () => new Date().toISOString(),
  onChange = () => {},
}) {
  /** @type {Snapshot | null} */
  let state = null;
  /** @type {Snapshot[] | null} */
  let conflict = null;
  /** Our own file is the only path we ever write. */
  const myFile = fileNameFor(deviceId);

  const notify = () => onChange({ state, conflict });

  async function writeMine() {
    await folder.write(myFile, `${JSON.stringify(state, null, 2)}\n`);
  }

  async function readPeers() {
    const names = await folder.list();
    const peers = [];
    for (const name of names) {
      const owner = deviceIdFrom(name);
      if (!owner || owner === deviceId) continue;
      try {
        const raw = await folder.read(name);
        if (raw) peers.push(JSON.parse(raw));
      } catch {
        // A half-written file is normal: the cloud client may be mid-download.
        // Skipping it costs one cycle; the next pass picks it up whole.
      }
    }
    return peers;
  }

  return {
    get state() {
      return state;
    },
    get conflict() {
      return conflict;
    },

    /** Read our own file back — this is what "start the app" does. */
    async load() {
      const raw = await folder.read(myFile).catch(() => null);
      if (raw) state = JSON.parse(raw);
      notify();
      return state;
    },

    /** The user typed. Local first, always: the folder is not in this path. */
    async edit(text) {
      state = localEdit(state, deviceId, text, now());
      await writeMine();
      notify();
    },

    /**
     * One sync cycle. Everything the cloud client has delivered gets folded in;
     * if we learned something, our own file is updated to record it.
     */
    async sync() {
      const peers = await readPeers();
      const result = applyPeers(state, peers);
      state = result.state;
      conflict = result.conflict;
      if (result.changed) await writeMine();
      notify();
      return result;
    },

    /** End a conflict by choosing a text. Writes only our own file. */
    async resolve(text) {
      if (!conflict) return;
      state = resolveWith(conflict, deviceId, text, now());
      conflict = null;
      await writeMine();
      notify();
    },
  };
}
