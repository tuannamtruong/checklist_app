// The read-time repair, and every walk that depends on it.
//
// A merged tree may not be a tree: two devices can concurrently move A under B
// and B under A, and neither wrote an illegal move — sync-flow.md §6. This
// module is the one place that turns the node map into something a walk can
// terminate on, and every ancestor walk in the application goes through it.
// Breadcrumbs and the tombstone walk climb the *resolved* parent; climbing the
// raw one hangs.
//
// Nothing here writes. The repair is a pure function of merged state, so every
// device drops the same edge without agreeing with anyone — sync-flow.md §6.2.

import { compareSiblings } from './order';
import { ROOT, SIDEBAR_KINDS, type Node, type NodeId, type NodeMap, type ParentId } from './types';

export type RepairReason = 'cycle' | 'missing-parent';

/** What C-2 needs to tell the user, derived rather than stored — C-6. */
export interface Repair {
  id: NodeId;
  /** The parent the node claims on disk, and no longer renders under. */
  from: ParentId;
  reason: RepairReason;
}

export interface ResolvedTree {
  nodes: NodeMap;
  /** Only the nodes whose parent the repair overrode. */
  repaired: ReadonlyMap<NodeId, ParentId>;
  children: ReadonlyMap<ParentId, readonly NodeId[]>;
  /** Tombstoned, or under something tombstoned — T-7. */
  deleted: ReadonlySet<NodeId>;
  repairs: readonly Repair[];
}

/** The loser of a cycle is the member whose parent was set longest ago. */
function oldestParentEdge(cycle: readonly Node[]): Node {
  let loser = cycle[0]!;
  for (const node of cycle.slice(1)) {
    if (node.parentSetAt !== loser.parentSetAt) {
      if (node.parentSetAt < loser.parentSetAt) loser = node;
    } else if (node.parentSetBy !== loser.parentSetBy) {
      // Two devices can stamp one millisecond, so device id closes it, and node
      // id after that makes the choice unconditional.
      if (node.parentSetBy < loser.parentSetBy) loser = node;
    } else if (node.id < loser.id) loser = node;
  }
  return loser;
}

export function resolveTree(nodes: NodeMap): ResolvedTree {
  const repaired = new Map<NodeId, ParentId>();
  const repairs: Repair[] = [];
  const settled = new Set<NodeId>();
  const onPath = new Set<NodeId>();

  for (const id of Object.keys(nodes)) {
    if (settled.has(id)) continue;
    const path: NodeId[] = [];
    let cursor: NodeId | null = id;

    while (cursor !== null) {
      if (settled.has(cursor)) break;
      if (onPath.has(cursor)) {
        const cycle = path.slice(path.indexOf(cursor)).map((member) => nodes[member]!);
        const loser = oldestParentEdge(cycle);
        repaired.set(loser.id, ROOT);
        repairs.push({ id: loser.id, from: loser.parent, reason: 'cycle' });
        break;
      }
      onPath.add(cursor);
      path.push(cursor);

      const parent: ParentId = nodes[cursor]!.parent;
      if (parent === ROOT) break;
      if (nodes[parent] === undefined) {
        // A half-synced folder can hold a child whose parent has not arrived.
        // Re-rooting shows it rather than hiding it, and the next fold puts it
        // back when the file lands — architecture.md §2.
        repaired.set(cursor, ROOT);
        repairs.push({ id: cursor, from: parent, reason: 'missing-parent' });
        break;
      }
      cursor = parent;
    }

    for (const member of path) {
      onPath.delete(member);
      settled.add(member);
    }
  }

  const effectiveParent = (id: NodeId): ParentId => repaired.get(id) ?? nodes[id]!.parent;

  // T-7: a tombstone covers the whole subtree, so the answer for one node is the
  // answer for its resolved ancestors. The chain is acyclic by now, which is
  // exactly why this walk terminates.
  const deleted = new Set<NodeId>();
  const known = new Map<NodeId, boolean>();
  const isDeleted = (start: NodeId): boolean => {
    const chain: NodeId[] = [];
    let cursor: ParentId = start;
    let answer = false;
    while (cursor !== ROOT) {
      const cached = known.get(cursor);
      if (cached !== undefined) {
        answer = cached;
        break;
      }
      chain.push(cursor);
      if (nodes[cursor]!.deleted) {
        answer = true;
        break;
      }
      cursor = effectiveParent(cursor);
    }
    for (const member of chain) {
      known.set(member, answer);
      if (answer) deleted.add(member);
    }
    return answer;
  };
  for (const id of Object.keys(nodes)) isDeleted(id);

  // Two filters, and they are not the same shape. T-7's tombstone is inherited,
  // so a whole subtree leaves at once. T-11's tick is not: a finished row leaves
  // its parent's list, but its own children stay under it, which is what lets
  // the Done view open a finished list and find something inside — core/done.ts.
  //
  // Filtering here rather than in the views is what keeps an edit honest. Every
  // caller of childrenOf sees exactly what the user sees, so `Alt-↓` cannot walk
  // a row past a hidden one and `Backspace` is not refused by invisible children.
  const children = new Map<ParentId, NodeId[]>();
  for (const id of Object.keys(nodes)) {
    if (deleted.has(id) || nodes[id]!.done) continue;
    const parent = effectiveParent(id);
    const bucket = children.get(parent);
    if (bucket) bucket.push(id);
    else children.set(parent, [id]);
  }
  for (const bucket of children.values()) {
    bucket.sort((a, b) => compareSiblings(nodes[a]!, nodes[b]!));
  }

  return { nodes, repaired, children, deleted, repairs };
}

export function nodeOf(tree: ResolvedTree, id: NodeId): Node | undefined {
  return tree.nodes[id];
}

/** The parent as rendered — the only legal reading of a node's parent. */
export function parentOf(tree: ResolvedTree, id: NodeId): ParentId {
  const node = tree.nodes[id];
  if (!node) return ROOT;
  return tree.repaired.get(id) ?? node.parent;
}

export function childrenOf(tree: ResolvedTree, parent: ParentId): readonly NodeId[] {
  return tree.children.get(parent) ?? [];
}

/** Root first, the node's own parent last — the path T-9 renders. */
export function ancestorsOf(tree: ResolvedTree, id: NodeId): NodeId[] {
  const path: NodeId[] = [];
  let cursor: ParentId = parentOf(tree, id);
  while (cursor !== ROOT) {
    path.push(cursor);
    cursor = parentOf(tree, cursor);
  }
  return path.reverse();
}

/** T-5's question: would this move put a node inside itself? */
export function isAncestorOrSelf(tree: ResolvedTree, candidate: NodeId, id: ParentId): boolean {
  let cursor: ParentId = id;
  while (cursor !== ROOT) {
    if (cursor === candidate) return true;
    cursor = parentOf(tree, cursor);
  }
  return false;
}

export function siblingsOf(tree: ResolvedTree, id: NodeId): readonly NodeId[] {
  return childrenOf(tree, parentOf(tree, id));
}

export function siblingAt(tree: ResolvedTree, id: NodeId, offset: number): NodeId | undefined {
  const siblings = siblingsOf(tree, id);
  const index = siblings.indexOf(id);
  if (index === -1) return undefined;
  return siblings[index + offset];
}

/**
 * X-21. The nearest ancestor that is not a `note`, or `ROOT`.
 *
 * The list a note is drawn beside, and a walk rather than one `parentOf`
 * because a note's children may be notes: opening one is a click inside the
 * pane, and the pane is what should answer it — the column on the left keeps
 * the list it was already showing. requirements.md §10.3.
 */
export function listAbove(tree: ResolvedTree, id: NodeId): ParentId {
  let cursor: ParentId = parentOf(tree, id);
  while (cursor !== ROOT && tree.nodes[cursor]?.kind === 'note') {
    cursor = parentOf(tree, cursor);
  }
  return cursor;
}

/**
 * T-10. The children of `parent` the sidebar draws: the `folder` and `note`
 * ones, in tree order, and never a task — tasks are the bulk of a checklist and
 * would bury the two kinds that are navigation.
 *
 * `childrenOf` has already dropped the tombstoned (T-7) and the ticked (T-11),
 * so a row leaves the nav at the same moment it leaves the page.
 */
export function sidebarChildren(tree: ResolvedTree, parent: ParentId): readonly NodeId[] {
  return childrenOf(tree, parent).filter((id) => {
    const kind = tree.nodes[id]?.kind;
    return kind !== undefined && SIDEBAR_KINDS.includes(kind);
  });
}

/** Present and not tombstoned — what a route may open, per X-11. */
export function isVisible(tree: ResolvedTree, id: NodeId): boolean {
  return tree.nodes[id] !== undefined && !tree.deleted.has(id);
}
