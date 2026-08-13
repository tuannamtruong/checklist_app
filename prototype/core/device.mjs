// What one device does with what it finds in the folder. Pure, and `now` is a
// parameter — same rule as `core/` in the real app, so the tests can be exact.

import { bump, emptyClock, equal, join, reconcile } from "./merge.mjs";

/** @typedef {import("./merge.mjs").Snapshot} Snapshot */

/**
 * A device is identified by a generated id, never by the name the user typed.
 *
 * The id names the file, and one file per device is the entire safety argument.
 * A human label is not safe to name a file with: two devices both called
 * "phone" would write the same path, which is the one thing this design forbids
 * and the one situation the merge cannot untangle. The label is display only,
 * and it travels *inside* the file.
 *
 * Same shape as the real app's `db/device.ts`, so the two agree when the op log
 * arrives.
 */
export function newDeviceId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

/** Ids are hex, so this doubles as validation of anything found in the folder. */
export const isDeviceId = (value) => /^[0-9a-f]{8}$/.test(value);

export const fileNameFor = (deviceId) => `checklist.${deviceId}.json`;

export function deviceIdFrom(fileName) {
  const id = fileName.match(/^checklist\.([0-9a-f]{8})\.json$/)?.[1];
  return id ?? null;
}

/**
 * The user typed something. Only this device may increment its own slot, so a
 * local edit can never be confused with a peer's.
 * @returns {Snapshot}
 */
export function localEdit(mine, deviceId, label, text, now) {
  return {
    device: deviceId,
    label,
    author: deviceId,
    text,
    clock: bump(mine?.clock ?? emptyClock(), deviceId),
    updatedAt: now,
  };
}

/**
 * Fold in what the peers' files say.
 *
 * `changed` is what the caller writes on. Writing our own file after adopting a
 * peer's text is not busywork: it records that we have *seen* that edit. A
 * device that adopted the text but not the clock would look, on its next edit,
 * like it had edited concurrently — and raise a conflict that never happened.
 *
 * @param {Snapshot | null} mine
 * @param {Snapshot[]} peers
 * @returns {{ state: Snapshot | null, conflict: Snapshot[] | null, changed: boolean }}
 */
export function applyPeers(mine, peers) {
  const { state, conflict } = reconcile([mine, ...peers].filter(Boolean));

  // Hold our own state untouched while a conflict is open. Picking for the user
  // here is exactly the silent data loss the conflict exists to prevent.
  if (conflict) return { state: mine, conflict, changed: false };
  if (!state) return { state: mine, conflict: null, changed: false };

  const changed =
    !mine || state.text !== mine.text || !equal(state.clock, mine.clock);
  // The file keeps our identity and our label; the text keeps its author's.
  const next = changed
    ? {
        ...state,
        device: mine?.device ?? state.device,
        label: mine?.label ?? state.label,
      }
    : mine;
  return { state: next, conflict: null, changed };
}

/**
 * The user picked a text to end the conflict. Joining every racing clock and
 * then bumping ours makes the result strictly dominate all of them, so every
 * other device fast-forwards to it instead of re-raising the same conflict.
 * @returns {Snapshot}
 */
export function resolveWith(conflict, deviceId, label, text, now) {
  const clock = conflict.reduce((c, s) => join(c, s.clock), emptyClock());
  return {
    device: deviceId,
    label,
    author: deviceId,
    text,
    clock: bump(clock, deviceId),
    updatedAt: now,
  };
}

/**
 * Which device wrote a given piece of text, in words.
 *
 * Labels are not duplicated into every snapshot — each device declares its own
 * inside its own file, so the folder as a whole is the lookup table. One less
 * thing that can disagree with itself.
 */
export function labelFor(deviceId, snapshots) {
  const owner = snapshots.find((s) => s?.device === deviceId);
  return owner?.label || deviceId;
}
