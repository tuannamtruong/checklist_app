// D-4 — this device's op log, in the vocabulary of the tree rather than of the
// encoding. requirements.md §8.
//
// Nothing here is stored and nothing here writes: an entry is a read of ops the
// session already holds, the same way the Done view is a read of the tree. The
// module exists because an op on disk names a node id and a counter, and a
// person reading their own log wants the row's title and what the op did to it.
//
// What it cannot show is what compaction dropped — sync-flow.md §4.8 rewrites
// this device's file, so the ops here are the survivors rather than the history.
// The page says so; this module only reports what it was handed.

import { ROOT, type DeviceId, type NodeId, type NodeMap, type Op, type ParentId } from './types';

export interface LogEntry {
  /** This device's counter for the op — its own position in the version vector. */
  c: number;
  /** Wall clock at the moment it was written. Formatting is the view's. */
  at: number;
  op: Op['op'];
  id: NodeId;
  /** The row's title as the merged tree has it now, or '' when it has none. */
  title: string;
  /** The tree no longer holds this node at all — a fold this log outlived. */
  gone: boolean;
  /** What the op did, in one phrase. */
  detail: string;
  /** Peers this op carried a receipt for, if any — sync-flow.md §4.2. */
  seen: readonly DeviceId[];
}

/** Long enough to recognise a row, short enough to stay on one line. */
const MAX_QUOTED = 60;

function quote(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean === '') return '(empty)';
  return clean.length <= MAX_QUOTED ? `“${clean}”` : `“${clean.slice(0, MAX_QUOTED)}…”`;
}

function labelOfParent(parent: ParentId, nodes: NodeMap): string {
  if (parent === ROOT) return 'All lists';
  return quote(nodes[parent]?.title ?? parent);
}

/**
 * What a `set` changed, field by field. A `set` carries only the fields that
 * changed (S-2), so listing the ones present is listing the edit itself.
 */
function setDetail(op: Extract<Op, { op: 'set' }>): string {
  const parts: string[] = [];
  if (op.title !== undefined) parts.push(`title ${quote(op.title)}`);
  if (op.done !== undefined) parts.push(op.done ? 'ticked' : 'un-ticked');
  if (op.kind !== undefined) parts.push(`turned into a ${op.kind}`);
  if (op.body !== undefined) {
    const body = op.body ?? '';
    parts.push(body === '' ? 'body cleared' : `body, ${body.length} characters`);
  }
  // A-3. The whole set is the write, so the whole set is what the line says.
  if (op.tags !== undefined) {
    parts.push(op.tags.length === 0 ? 'tags cleared' : `tags ${op.tags.join(', ')}`);
  }
  if (op.priority !== undefined) {
    parts.push(op.priority === 'none' ? 'flag cleared' : `flagged ${op.priority}`);
  }
  // An op that reached the file with nothing in it should be impossible — S-10
  // drops a no-op edit before it is written — so say what was seen rather than
  // render a blank cell.
  return parts.length === 0 ? 'set nothing' : parts.join(', ');
}

function detailOf(op: Op, nodes: NodeMap, parents: Map<NodeId, ParentId>): string {
  switch (op.op) {
    case 'create':
      return `new ${op.kind} in ${labelOfParent(op.parent, nodes)}`;
    case 'set':
      return setDetail(op);
    case 'move':
      // Moving among siblings (T-4) and moving to another parent (T-3) are one
      // op, and they read as different edits. The previous parent is only known
      // from this device's own ops, so an unseen one reads as the move it is.
      return parents.get(op.id) === op.parent
        ? `reordered in ${labelOfParent(op.parent, nodes)}`
        : `moved into ${labelOfParent(op.parent, nodes)}`;
    case 'delete':
      return 'deleted, with everything inside it';
    case 'restore':
      return 'restored';
  }
}

/**
 * The log as a person reads it: newest first, because the question a log answers
 * is almost always "what just happened" — the opposite of every other list in
 * the app, which reads in tree order from the top.
 *
 * `limit` caps the rows built, not the ops walked: the walk has to run forward
 * from the first op to know what a move moved away from.
 */
export function logEntries(
  ops: readonly Op[],
  nodes: NodeMap,
  limit = Number.POSITIVE_INFINITY,
): LogEntry[] {
  const parents = new Map<NodeId, ParentId>();
  const entries: LogEntry[] = [];
  for (const op of ops) {
    const node = nodes[op.id];
    entries.push({
      c: op.c,
      at: op.at,
      op: op.op,
      id: op.id,
      title: node?.title ?? '',
      gone: node === undefined,
      detail: detailOf(op, nodes, parents),
      seen: Object.keys(op.seen ?? {}),
    });
    if (op.op === 'create' || op.op === 'move') parents.set(op.id, op.parent);
  }
  entries.reverse();
  return entries.length > limit ? entries.slice(0, limit) : entries;
}
