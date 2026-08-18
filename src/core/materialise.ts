// The fold: ops in, tree out. The store calls this once at load and then keeps
// the tree — sync-flow.md §4 forbids a projection per read, and that is a rule
// about this module's callers rather than about this module.
//
// Applying ops in one total order is what makes last-writer-wins per field
// correct without a stamp on every field: sort once, fold once, and the newest
// write to a field is simply the last one applied.

import { ROOT, type Node, type NodeMap, type Op } from './types';

/**
 * The total order every device derives identically — sync-flow.md §4.6, rule 2.
 * `at` orders the writes, device id breaks a collision two devices can produce,
 * and the counter keeps one device's own ops in the order it wrote them.
 */
export function compareOps(a: Op, b: Op): number {
  if (a.at !== b.at) return a.at - b.at;
  if (a.dev !== b.dev) return a.dev < b.dev ? -1 : 1;
  return a.c - b.c;
}

function created(op: Extract<Op, { op: 'create' }>): Node {
  return {
    id: op.id,
    parent: op.parent,
    parentSetAt: op.at,
    parentSetBy: op.dev,
    kind: op.kind,
    title: '',
    done: false,
    body: op.kind === 'note' ? '' : null,
    order: op.order,
    orderBy: op.dev,
    deleted: false,
    deletedAt: null,
  };
}

/**
 * One op onto one tree, returning a new map. An op naming a node this replica
 * has never seen is dropped rather than half-applied: the create is in a file
 * that has not arrived, and the next fold — which sorts the create back in
 * front of this op — is what applies it.
 */
export function applyOp(nodes: NodeMap, op: Op): NodeMap {
  const existing = nodes[op.id];

  if (op.op === 'create') {
    // Idempotent, so replaying a log twice cannot clobber the sets that
    // followed the create — S-4.
    if (existing) return nodes;
    return { ...nodes, [op.id]: created(op) };
  }

  if (!existing) return nodes;

  switch (op.op) {
    case 'set': {
      const next: Node = { ...existing };
      if (op.title !== undefined) next.title = op.title;
      if (op.done !== undefined) next.done = op.done;
      if (op.body !== undefined) next.body = op.body;
      if (op.kind !== undefined) {
        next.kind = op.kind;
        // A row turned into a note owes the editor a body to open on. Turning
        // it back leaves the body in place, so the conversion is reversible.
        if (op.kind === 'note' && next.body === null) next.body = '';
      }
      return { ...nodes, [op.id]: next };
    }
    case 'move':
      return {
        ...nodes,
        [op.id]: {
          ...existing,
          parent: op.parent,
          parentSetAt: op.at,
          parentSetBy: op.dev,
          order: op.order,
          orderBy: op.dev,
        },
      };
    case 'delete':
      return {
        ...nodes,
        [op.id]: { ...existing, deleted: true, deletedAt: op.at },
      };
  }
}

/** Every op from every replica, folded into the tree they agree on. */
export function foldOps(ops: readonly Op[]): NodeMap {
  const ordered = [...ops].sort(compareOps);
  let nodes: NodeMap = {};
  for (const op of ordered) nodes = applyOp(nodes, op);
  return nodes;
}

/** True when the parent id names something that can hold children. */
export function parentExists(nodes: NodeMap, parent: string): boolean {
  return parent === ROOT || nodes[parent] !== undefined;
}
