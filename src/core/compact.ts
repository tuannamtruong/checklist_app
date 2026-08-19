// S-14, and the whole of it — sync-flow.md §4.8.
//
// A device drops those of its own ops that a later op of its own already
// overwrites. Nothing else is dropped, no snapshot is written, and no peer is
// consulted, because a device may only write its own file and its own ops are
// the only ops it can reason about without agreeing with anyone.
//
// The safety argument is one sentence: the fold applies every op in one total
// order and the last write to a field wins, so an op with a later op of the
// same device between it and everything above it can never win, whatever peers
// arrive later and in whatever order. That is a property of the order rather
// than of the delivery, which is why it needs no coordination — and it is why
// the fold of a compacted set is *identical* to the fold of the original rather
// than merely equivalent.

import { compareOps } from './materialise';
import { receiptDelta } from './merge';
import { join } from './sclock';
import type { NodeMap, Op, SClock, SetOp } from './types';

/**
 * The fields an op writes, as keys the "who wrote this last" map is built over.
 *
 * `create` writes none: it is the node's existence rather than a value, and
 * `applyOp` ignores a second one, so it is never a candidate to drop.
 * `move` writes `parent` and `order` together, so they are one key — the last
 * move of a node carries both. `delete` and `restore` are the two writers of
 * one field, which is what T-13 made them — sync-flow.md §4.9.
 */
function keysOf(op: Op): string[] {
  switch (op.op) {
    case 'create':
      return [];
    case 'move':
      return [`${op.id}:parent`];
    case 'delete':
    case 'restore':
      return [`${op.id}:deleted`];
    case 'set': {
      const keys: string[] = [];
      if (op.title !== undefined) keys.push(`${op.id}:title`);
      if (op.done !== undefined) keys.push(`${op.id}:done`);
      if (op.body !== undefined) keys.push(`${op.id}:body`);
      if (op.kind !== undefined) keys.push(`${op.id}:kind`);
      if (op.tags !== undefined) keys.push(`${op.id}:tags`);
      if (op.priority !== undefined) keys.push(`${op.id}:priority`);
      return keys;
    }
  }
}

/** A `set` carrying only the fields it is still the last writer of. */
function trimmedSet(op: SetOp, keeps: (key: string) => boolean): SetOp | null {
  const kept: SetOp = { op: 'set', id: op.id, c: op.c, at: op.at, dev: op.dev };
  let any = false;
  if (op.title !== undefined && keeps(`${op.id}:title`)) {
    kept.title = op.title;
    any = true;
  }
  if (op.done !== undefined && keeps(`${op.id}:done`)) {
    kept.done = op.done;
    any = true;
  }
  if (op.body !== undefined && keeps(`${op.id}:body`)) {
    kept.body = op.body;
    any = true;
  }
  if (op.kind !== undefined && keeps(`${op.id}:kind`)) {
    kept.kind = op.kind;
    any = true;
  }
  if (op.tags !== undefined && keeps(`${op.id}:tags`)) {
    kept.tags = op.tags;
    any = true;
  }
  if (op.priority !== undefined && keeps(`${op.id}:priority`)) {
    kept.priority = op.priority;
    any = true;
  }
  return any ? kept : null;
}

/**
 * One device's ops, with everything superseded removed.
 *
 * Every op must come from one device; this is a device compacting its own file,
 * and it has no business rewriting anyone else's.
 */
export function compactOps(ops: readonly Op[]): Op[] {
  if (ops.length === 0) return [];

  // "Last" is in the fold's order, not in counter order. A device whose clock
  // steps backwards can write c=6 with an earlier `at` than c=5, and then c=5
  // is the op that wins — comparing by counter here would drop a live value.
  const last = new Map<string, Op>();
  for (const op of [...ops].sort(compareOps)) {
    for (const key of keysOf(op)) last.set(key, op);
  }

  // The highest counter must survive. sync-flow.md §4.7 step 3 skips a peer
  // file holding fewer of that peer's own ops than are already held, reading it
  // as a partial download — so a compaction that lowered this device's top
  // counter would make every peer skip its file forever.
  const inOrder = [...ops].sort((a, b) => a.c - b.c);
  const highest = inOrder[inOrder.length - 1]!;

  const kept: Op[] = [];
  for (const op of inOrder) {
    const keeps = (key: string): boolean => last.get(key) === op;
    if (op.op === 'create' || op === highest) {
      kept.push(op);
      continue;
    }
    if (op.op === 'set') {
      const trimmed = trimmedSet(op, keeps);
      if (trimmed !== null) kept.push(trimmed);
      continue;
    }
    if (keysOf(op).some(keeps)) kept.push(op);
  }

  return withRebuiltReceipts(inOrder, kept);
}

/**
 * The receipts of dropped ops, merged onto the op that survives them.
 *
 * `opVectors` reconstructs each op's vector by replaying the file forward and
 * accumulating every `seen`, so dropping an op would otherwise drop a receipt
 * and make this device read as further behind than it is. Rebuilding the deltas
 * leaves every retained op reconstructing exactly the vector it had before,
 * which is what keeps requirements.md §9 honest across a compaction.
 */
function withRebuiltReceipts(all: readonly Op[], kept: readonly Op[]): Op[] {
  const keptIds = new Set(kept.map((op) => op.c));
  const out: Op[] = [];
  let accumulated: SClock = {};
  let written: SClock = {};
  let next = 0;

  for (const op of all) {
    if (op.seen) accumulated = join(accumulated, op.seen);
    if (!keptIds.has(op.c)) continue;

    const rebuilt: Op = { ...kept[next++]! };
    const delta = receiptDelta(written, accumulated);
    written = accumulated;
    if (Object.keys(delta).length === 0) delete rebuilt.seen;
    else rebuilt.seen = delta;
    out.push(rebuilt);
  }
  return out;
}

/** Bytes a serialised tree costs, which is what the trigger weighs history against. */
export function treeBytes(nodes: NodeMap): number {
  return JSON.stringify(nodes).length;
}

/**
 * sync-flow.md §4.6's trigger, unchanged: compact when the folder's logs cost
 * more than one materialised tree per device would. Both numbers are in hand at
 * the end of a cycle — the files were just read and the tree was just folded —
 * so this is measured rather than predicted.
 *
 * Every device evaluates it against roughly the same numbers and compacts its
 * own file, which is how a fleet compacts with no message passing.
 */
export function compactionDue(logBytes: number, deviceCount: number, nodes: NodeMap): boolean {
  if (deviceCount === 0) return false;
  return logBytes > deviceCount * treeBytes(nodes);
}
