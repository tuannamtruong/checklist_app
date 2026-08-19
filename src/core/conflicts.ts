// What the merge decided without asking — requirements.md §9.
//
// Three different things land in one list, and conflating them would be wrong.
// A field the fold resolved by last-writer-wins states what it kept and offers
// the value it dropped (C-1, C-4). A T-6 re-rooting names the node it moved
// (C-2). A sibling order settled by device id says so (C-3).
//
// Every row is derived from merged state, never stored (C-6): this is a pure
// function of the ops in hand and the resolved tree, so two devices holding the
// same folder derive the same list, and nothing has to be written to record one.
//
// A row lives exactly as long as the state that produced it. Writing the field
// again from a device that has read both sides leaves nothing concurrent with
// the winner, so the row disappears — which is why the buttons on it are
// ordinary edits rather than a resolution protocol.

import { compareOps } from './materialise';
import { opVectors, type DeviceOps } from './merge';
import { concurrent } from './sclock';
import type { ResolvedTree } from './tree';
import { ROOT, type DeviceId, type NodeId, type Op, type ParentId } from './types';

/** The fields two devices can write independently. */
export type ConflictField = 'title' | 'done' | 'body' | 'kind' | 'parent';

export type FieldValue = string | boolean | null;

interface ConflictBase {
  /** Stable across cycles, because it is derived from the ops — the dismissal key. */
  id: string;
  node: NodeId;
  /** When the losing write happened, for ordering the list newest first. */
  at: number;
}

export interface FieldConflict extends ConflictBase {
  kind: 'field';
  field: ConflictField;
  kept: FieldValue;
  keptBy: DeviceId;
  keptAt: number;
  dropped: FieldValue;
  droppedBy: DeviceId;
}

/** T-6 re-rooted this node. Nothing was written to do it — sync-flow.md §6.2. */
export interface CycleConflict extends ConflictBase {
  kind: 'cycle';
  /** The parent the node still claims on disk and no longer renders under. */
  from: ParentId;
}

/** Two concurrently inserted rows landed in device-id order — §5.3. */
export interface OrderConflict extends ConflictBase {
  kind: 'order';
  other: NodeId;
  parent: ParentId;
}

export type Conflict = FieldConflict | CycleConflict | OrderConflict;

/**
 * A create cannot race: one device mints the id, so no other device can have
 * written the node's first version. A delete does not lose either — T-7 makes a
 * tombstone final rather than a value in a contest.
 */
function writesOf(op: Op): readonly (readonly [ConflictField, FieldValue])[] {
  if (op.op === 'move') return [['parent', op.parent]];
  if (op.op !== 'set') return [];
  const writes: (readonly [ConflictField, FieldValue])[] = [];
  if (op.title !== undefined) writes.push(['title', op.title]);
  if (op.done !== undefined) writes.push(['done', op.done]);
  if (op.body !== undefined) writes.push(['body', op.body]);
  if (op.kind !== undefined) writes.push(['kind', op.kind]);
  return writes;
}

interface Write {
  op: Op;
  value: FieldValue;
}

interface FieldWrites {
  field: ConflictField;
  writes: Write[];
}

function fieldConflicts(tree: ResolvedTree, logs: readonly DeviceOps[]): FieldConflict[] {
  const vectors = opVectors(logs);
  const groups = new Map<string, FieldWrites>();

  for (const log of logs) {
    for (const op of log.ops) {
      // A tombstoned row's history is not something to ask the user about, and
      // a node no file has created yet is not a row at all.
      if (tree.nodes[op.id] === undefined || tree.deleted.has(op.id)) continue;
      for (const [field, value] of writesOf(op)) {
        const key = `${op.id}:${field}`;
        const group = groups.get(key);
        if (group) group.writes.push({ op, value });
        else groups.set(key, { field, writes: [{ op, value }] });
      }
    }
  }

  const conflicts: FieldConflict[] = [];
  for (const { field, writes } of groups.values()) {
    if (writes.length < 2) continue;
    writes.sort((a, b) => compareOps(a.op, b.op));
    const winner = writes[writes.length - 1]!;
    const winnerClock = vectors.get(winner.op)!;

    // One row per losing device, and only its last word: a device that wrote
    // the field twice before hearing from anyone is not offering both values.
    const lastByDevice = new Map<DeviceId, Write>();
    for (const write of writes) {
      if (write === winner || write.op.dev === winner.op.dev) continue;
      if (write.value === winner.value) continue;
      if (!concurrent(vectors.get(write.op)!, winnerClock)) continue;
      lastByDevice.set(write.op.dev, write);
    }

    for (const loser of lastByDevice.values()) {
      conflicts.push({
        kind: 'field',
        id: `field:${winner.op.id}:${field}:${winner.op.dev}:${winner.op.c}:${loser.op.dev}:${loser.op.c}`,
        node: winner.op.id,
        field,
        at: winner.op.at,
        kept: winner.value,
        keptBy: winner.op.dev,
        keptAt: winner.op.at,
        dropped: loser.value,
        droppedBy: loser.op.dev,
      });
    }
  }
  return conflicts;
}

/**
 * A node the repair moved to the root. Only the cycle case: a missing parent is
 * a file that has not arrived yet, and the next cycle puts the node back — a
 * notice about it would be a notice about the provider's latency.
 */
function cycleConflicts(tree: ResolvedTree): CycleConflict[] {
  return tree.repairs
    .filter((repair) => repair.reason === 'cycle' && !tree.deleted.has(repair.id))
    .map((repair) => ({
      kind: 'cycle',
      id: `cycle:${repair.id}:${repair.from}`,
      node: repair.id,
      from: repair.from,
      at: tree.nodes[repair.id]!.parentSetAt,
    }));
}

/**
 * Two siblings holding one order key, minted by two devices. Equal keys are the
 * expected outcome of inserting into the same gap — §5.3 keeps the sort total
 * with the device id — and a device that had seen the other's key would have
 * minted a different one, so this pair is concurrent by construction.
 */
function orderConflicts(tree: ResolvedTree): OrderConflict[] {
  const conflicts: OrderConflict[] = [];
  for (const [parent, ids] of tree.children) {
    for (let i = 1; i < ids.length; i++) {
      const node = tree.nodes[ids[i]!]!;
      const previous = tree.nodes[ids[i - 1]!]!;
      if (node.order !== previous.order || node.orderBy === previous.orderBy) continue;
      conflicts.push({
        kind: 'order',
        id: `order:${previous.id}:${node.id}`,
        node: previous.id,
        other: node.id,
        parent,
        at: Math.max(node.parentSetAt, previous.parentSetAt),
      });
    }
  }
  return conflicts;
}

/** Newest first, because the one that just happened is the one being looked for. */
export function conflictsOf(tree: ResolvedTree, logs: readonly DeviceOps[]): Conflict[] {
  return [...fieldConflicts(tree, logs), ...cycleConflicts(tree), ...orderConflicts(tree)].sort(
    (a, b) => b.at - a.at || (a.id < b.id ? -1 : 1),
  );
}

/** What the row says it did, in the words the user's own edits use. */
export function describeField(field: ConflictField): string {
  switch (field) {
    case 'title':
      return 'title';
    case 'done':
      return 'tick';
    case 'body':
      return 'note body';
    case 'kind':
      return 'kind';
    case 'parent':
      return 'parent';
  }
}

export function describeValue(field: ConflictField, value: FieldValue, tree: ResolvedTree): string {
  if (field === 'done') return value === true ? 'ticked' : 'not ticked';
  if (field === 'parent') {
    if (value === ROOT || typeof value !== 'string') return 'the top level';
    return tree.nodes[value]?.title || 'an untitled row';
  }
  if (value === null || value === '') return 'empty';
  return String(value);
}
