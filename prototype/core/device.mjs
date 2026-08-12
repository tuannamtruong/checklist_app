// What one device does with what it finds in the folder. Pure, and `now` is a
// parameter — same rule as `core/` in the real app, so the tests can be exact.

import { bump, emptyClock, equal, join, reconcile } from "./merge.mjs";

/** @typedef {import("./merge.mjs").Snapshot} Snapshot */

/** One file per device is the whole safety argument — see README §2. */
export const fileNameFor = (deviceId) => `checklist.${deviceId}.json`;

export const deviceIdFrom = (fileName) =>
  fileName.match(/^checklist\.(.+)\.json$/)?.[1] ?? null;

/**
 * The user typed something. Only this device may increment its own slot, so a
 * local edit can never be confused with a peer's.
 * @returns {Snapshot}
 */
export function localEdit(mine, deviceId, text, now) {
  return {
    device: deviceId,
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
  // The file keeps our name; the text keeps its author's.
  const next = changed
    ? { ...state, device: mine?.device ?? state.device }
    : mine;
  return { state: next, conflict: null, changed };
}

/**
 * The user picked a text to end the conflict. Joining every racing clock and
 * then bumping ours makes the result strictly dominate all of them, so every
 * other device fast-forwards to it instead of re-raising the same conflict.
 * @returns {Snapshot}
 */
export function resolveWith(conflict, deviceId, text, now) {
  const clock = conflict.reduce((c, s) => join(c, s.clock), emptyClock());
  return {
    device: deviceId,
    author: deviceId,
    text,
    clock: bump(clock, deviceId),
    updatedAt: now,
  };
}
