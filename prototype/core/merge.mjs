// Merge for a folder that some cloud client syncs. Pure: no I/O, no clock.
//
// There is no server to arbitrate and no conditional write to lean on — a
// synced folder only promises that bytes eventually show up. So ordering has to
// come from the data itself. That is what the version vector is for.
//
// A vector counts, per device, how many edits *that device* has made that this
// snapshot has incorporated. Comparing two vectors answers the only question
// that matters: did one of these edits happen after the other, or did they
// happen without knowing about each other?

/**
 * @typedef {Record<string, number>} SClock
 * @typedef {object} Snapshot
 * @property {string} device   owner of the file this came from — never changes
 * @property {string} author   who last changed the text (may be a peer)
 * @property {string} text
 * @property {SClock} sClock
 * @property {string} updatedAt
 */

export const emptySClock = () => ({});

const at = (sClock, device) => sClock[device] ?? 0;

const devices = (a, b) => new Set([...Object.keys(a), ...Object.keys(b)]);

/** Pointwise max: everything a knows about, plus everything b knows about. */
export function join(a, b) {
  const out = {};
  for (const d of devices(a, b)) out[d] = Math.max(at(a, d), at(b, d));
  return out;
}

/** One more edit by `device`. Only that device may ever increment its own counter. */
export function bump(sClock, device) {
  return { ...sClock, [device]: at(sClock, device) + 1 };
}

/** True when a has seen everything b has seen. */
export function dominates(a, b) {
  for (const d of devices(a, b)) if (at(a, d) < at(b, d)) return false;
  return true;
}

export function equal(a, b) {
  for (const d of devices(a, b)) if (at(a, d) !== at(b, d)) return false;
  return true;
}

/** Neither has seen the other: a genuine concurrent edit, the only real conflict. */
export function concurrent(a, b) {
  return !dominates(a, b) && !dominates(b, a);
}

/**
 * Reduce every snapshot in the folder to one answer, or to the set of edits
 * that genuinely raced.
 *
 * "Maximal" = nothing else strictly dominates it. If exactly one text survives
 * that filter, every other snapshot is an ancestor of it and there is nothing
 * to ask the user about. Two surviving texts means two devices edited without
 * seeing each other, which no merge rule can settle on its own.
 *
 * @param {Snapshot[]} snapshots
 * @returns {{ state: Snapshot | null, conflict: Snapshot[] | null }}
 */
export function reconcile(snapshots) {
  const live = snapshots.filter(Boolean);
  if (!live.length) return { state: null, conflict: null };

  const maximal = live.filter(
    (s) =>
      !live.some(
        (o) =>
          o !== s &&
          dominates(o.sClock, s.sClock) &&
          !equal(o.sClock, s.sClock),
      ),
  );

  const texts = [...new Set(maximal.map((s) => s.text))];
  if (texts.length > 1) return { state: null, conflict: maximal };

  // One text. Its sClock is the join of every snapshot that agrees on it, so
  // the result records everything the folder collectively knows.
  const sClock = maximal.reduce((c, s) => join(c, s.sClock), emptySClock());
  const newest = maximal.reduce((a, b) => (a.updatedAt >= b.updatedAt ? a : b));
  return { state: { ...newest, sClock }, conflict: null };
}
