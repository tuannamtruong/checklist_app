// Every device's log, read as one tree — sync-flow.md §4.7.
//
// There is no merge algorithm here in the usual sense, and that is the point of
// the payload: ops from every device are one set, `foldOps` sorts it into the
// total order every device derives identically, and the newest write to a field
// is simply the last one applied. Commutativity, associativity and idempotence
// (S-4) are consequences of sorting rather than properties to defend.
//
// What this module does own is the other half of the vector story. The fold
// needs no vectors at all; telling the user *which* writes raced needs one per
// op, and that is what a file's `seen` receipts reconstruct.

import { foldOps } from './materialise';
import { clockOf } from './op-log';
import { join, withCounter } from './sclock';
import type { DeviceId, NodeMap, Op, SClock } from './types';

/** One device's file, decoded. The device id is the header's, never a line's. */
export interface DeviceOps {
  device: DeviceId;
  ops: readonly Op[];
}

export function allOps(logs: readonly DeviceOps[]): Op[] {
  return logs.flatMap((log) => [...log.ops]);
}

/** The tree every device agrees on, from the files this one currently holds. */
export function mergeTree(logs: readonly DeviceOps[]): NodeMap {
  return foldOps(allOps(logs));
}

/**
 * What this device has actually read, as a vector — sync-flow.md §4.2.
 *
 * Counted from the ops in hand rather than joined out of a peer's header. A
 * receipt copied from peer B for peer A would claim edits this device does not
 * hold, and the claim would silence a race that really happened. Undercounting
 * only ever raises a notice.
 */
export function receiptsOf(logs: readonly DeviceOps[]): SClock {
  return clockOf(allOps(logs));
}

/**
 * The vector each op was written under, reconstructed by replaying its own
 * file forward: accumulate every `seen`, then raise the writer's counter to
 * `c`. Two ops are concurrent when neither vector dominates the other, which is
 * S-5 and the whole input to requirements.md §9.
 *
 * Keyed by op identity, which is safe because an op is never copied on the way
 * in — `decodeLog` mints one object per line and this map is built from those.
 */
export function opVectors(logs: readonly DeviceOps[]): Map<Op, SClock> {
  const vectors = new Map<Op, SClock>();
  for (const log of logs) {
    let clock: SClock = {};
    for (const op of [...log.ops].sort((a, b) => a.c - b.c)) {
      if (op.seen) clock = join(clock, op.seen);
      clock = withCounter(clock, log.device, op.c);
      vectors.set(op, clock);
    }
  }
  return vectors;
}

/**
 * The counters in `next` that `base` has not reached — what an op has to carry
 * as `seen` so that replaying the file forward lands on the same vector.
 */
export function receiptDelta(base: SClock, next: SClock): SClock {
  const delta: Record<DeviceId, number> = {};
  for (const device of Object.keys(next)) {
    if ((next[device] ?? 0) > (base[device] ?? 0)) delta[device] = next[device]!;
  }
  return delta;
}
