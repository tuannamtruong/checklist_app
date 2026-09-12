// The fold: ops in, tree out. The store calls this once at load and then keeps
// the tree — sync-flow.md §4 forbids a projection per read, and that is a rule
// about this module's callers rather than about this module.
//
// Applying ops in one total order is what makes last-writer-wins per field
// correct without a stamp on every field: sort once, fold once, and the newest
// write to a field is simply the last one applied.

import { hasBody, isRoot, type Node, type NodeId, type NodeMap, type Op } from './types';

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
    doneAt: null,
    // K-12. Both body-carrying kinds open with an empty one; a folder's stays
    // null, which is what tells "has no body" from "has an empty body".
    body: hasBody(op.kind) ? '' : null,
    tags: [],
    priority: 'none',
    // G-2. Null on a tree row and set by the `set` that follows the create on
    // an agenda one, exactly as a title is.
    day: null,
    // R-2. Null here as well: the page that creates a timely row is what gives
    // it a period, in the `set` that follows the create — exactly as a day is.
    every: null,
    order: op.order,
    orderBy: op.dev,
    deleted: false,
    deletedAt: null,
  };
}

/**
 * What one op makes of one node, or `undefined` for "this op changes nothing".
 *
 * The map is not its business, which is what lets `foldOps` build one map for
 * a whole log and `applyOp` copy the map for one edit — the same rules, read
 * once. An op naming a node this replica has never seen changes nothing rather
 * than being half-applied: the create is in a file that has not arrived, and
 * the next fold — which sorts the create back in front of this op — is what
 * applies it.
 */
function nodeAfter(existing: Node | undefined, op: Op): Node | undefined {
  if (op.op === 'create') {
    // Idempotent, so replaying a log twice cannot clobber the sets that
    // followed the create — S-4.
    return existing ? undefined : created(op);
  }

  if (!existing) return undefined;

  switch (op.op) {
    case 'set': {
      const next: Node = { ...existing };
      if (op.title !== undefined) next.title = op.title;
      // `doneAt` is `done`'s timestamp in the way `deletedAt` is `deleted`'s,
      // and it is derived here rather than carried on the op: a build that
      // predates T-12's one archive wrote the same `set`, so its rows date
      // themselves the moment this fold reads them — sync-flow.md §4.9.
      if (op.done !== undefined) {
        next.done = op.done;
        next.doneAt = op.done ? op.at : null;
      }
      if (op.body !== undefined) next.body = op.body;
      if (op.tags !== undefined) next.tags = op.tags;
      if (op.priority !== undefined) next.priority = op.priority;
      if (op.day !== undefined) next.day = op.day;
      if (op.every !== undefined) next.every = op.every;
      if (op.kind !== undefined) {
        next.kind = op.kind;
        // A row turned into a note or a task owes the editor a body to open
        // on. Turning it back leaves the body in place, so the conversion is
        // reversible — and since K-12 the two body-carrying kinds convert into
        // each other with the text untouched.
        if (hasBody(op.kind) && next.body === null) next.body = '';
      }
      return next;
    }
    case 'move':
      return {
        ...existing,
        parent: op.parent,
        parentSetAt: op.at,
        parentSetBy: op.dev,
        order: op.order,
        orderBy: op.dev,
      };
    // `delete` and `restore` are the two writers of one field, so the total
    // order settles them against each other with no precedence between the ops
    // — sync-flow.md §4.9. `deletedAt` is that field's timestamp.
    case 'delete':
      return { ...existing, deleted: true, deletedAt: op.at };
    case 'restore':
      return { ...existing, deleted: false, deletedAt: null };
  }
}

/**
 * One op onto one tree, returning a new map — the store's path, where a new map
 * is the change being published and the op count is one edit's worth.
 */
export function applyOp(nodes: NodeMap, op: Op): NodeMap {
  const next = nodeAfter(nodes[op.id], op);
  return next === undefined ? nodes : { ...nodes, [op.id]: next };
}

/**
 * Every op from every replica, folded into the tree they agree on.
 *
 * The map is built rather than copied per op, and that is a complexity class
 * rather than a micro-optimisation: a spread per op is O(ops × nodes), which is
 * a 3000-row tree spending two seconds of its startup copying a map nobody has
 * seen yet — and paying it again on every cycle that merges. The map is this
 * function's own until it returns, so nothing outside can observe the
 * difference; `applyOp` above is the same rules for a caller that has a map
 * already.
 */
export function foldOps(ops: readonly Op[]): NodeMap {
  const ordered = [...ops].sort(compareOps);
  // Mutable only in here: the type widens for the length of the fold and
  // narrows again on the way out, which is what says the map is nobody else's.
  const nodes: Record<NodeId, Node> = {};
  for (const op of ordered) {
    const next = nodeAfter(nodes[op.id], op);
    if (next !== undefined) nodes[op.id] = next;
  }
  return nodes;
}

/** True when the parent id names something that can hold children. */
export function parentExists(nodes: NodeMap, parent: string): boolean {
  return isRoot(parent) || nodes[parent] !== undefined;
}
