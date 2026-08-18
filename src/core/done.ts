// The Done view's two lists — T-12.
//
// Both are derived from state resolveTree already holds, so nothing here is
// stored and nothing here writes: a finished row is one whose own `done` is set,
// a deleted one is a T-7 tombstone, and the view is a read-time filter over the
// two — sync-flow.md §7, item 3.
//
// Each list names only the *top* of its run. A finished task inside a finished
// list is one thing the user finished rather than two, and a row inside a
// tombstoned subtree was never deleted on its own — listing the descendants
// would turn one delete into a page of them.

import { compareSiblings } from './order';
import { ancestorsOf, parentOf, type ResolvedTree } from './tree';
import { ROOT, type NodeId, type ParentId } from './types';

export interface ArchivedRow {
  id: NodeId;
  /** Root first, the row's own parent last — the path T-9 renders. */
  path: readonly NodeId[];
}

/** Tree order for rows the tree no longer holds: compare the paths, step by step. */
function comparePaths(tree: ResolvedTree, a: NodeId, b: NodeId): number {
  const left = [...ancestorsOf(tree, a), a];
  const right = [...ancestorsOf(tree, b), b];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] === right[i]) continue;
    return compareSiblings(tree.nodes[left[i]!]!, tree.nodes[right[i]!]!);
  }
  return left.length - right.length;
}

/** True when some resolved ancestor already answers for this row. */
function coveredByAncestor(tree: ResolvedTree, id: NodeId, holds: (of: NodeId) => boolean): boolean {
  let cursor = parentOf(tree, id);
  while (cursor !== ROOT) {
    if (holds(cursor)) return true;
    cursor = parentOf(tree, cursor);
  }
  return false;
}

/**
 * Finished rows, in the order the tree would have shown them.
 *
 * A tombstoned row is not one of these however its tick stands: it belongs to
 * the deleted list, and appearing in both would ask the user to reason about a
 * row that is gone twice over.
 */
export function finishedRows(tree: ResolvedTree): ArchivedRow[] {
  const ids = Object.keys(tree.nodes).filter(
    (id) =>
      tree.nodes[id]!.done &&
      !tree.deleted.has(id) &&
      !coveredByAncestor(tree, id, (of) => tree.nodes[of]!.done),
  );
  ids.sort((a, b) => comparePaths(tree, a, b));
  return ids.map((id) => ({ id, path: ancestorsOf(tree, id) }));
}

/**
 * How many of one parent's rows T-11 is holding back.
 *
 * An empty list and a list the user has finished are different states, and
 * saying "nothing here yet" about the second one reads as data loss.
 */
export function finishedChildCount(tree: ResolvedTree, parent: ParentId): number {
  return Object.keys(tree.nodes).filter(
    (id) => tree.nodes[id]!.done && !tree.deleted.has(id) && parentOf(tree, id) === parent,
  ).length;
}

/**
 * Tombstoned rows, newest deletion first — which is the order an undo wants, and
 * the only one the data supports: `deletedAt` is recorded, a "finished at" is
 * not.
 */
export function deletedRows(tree: ResolvedTree): ArchivedRow[] {
  const ids = Object.keys(tree.nodes).filter(
    (id) =>
      tree.nodes[id]!.deleted && !coveredByAncestor(tree, id, (of) => tree.nodes[of]!.deleted),
  );
  ids.sort((a, b) => {
    const at = (tree.nodes[b]!.deletedAt ?? 0) - (tree.nodes[a]!.deletedAt ?? 0);
    return at !== 0 ? at : a < b ? -1 : 1;
  });
  return ids.map((id) => ({ id, path: ancestorsOf(tree, id) }));
}
