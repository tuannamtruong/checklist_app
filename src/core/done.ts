// The archive — T-12, and it is one list.
//
// A finished row and a deleted one are the same answer to the same question:
// "where did that go?". They left the tree for different reasons, and the
// reason is the app's business rather than the reader's — a tick and a delete
// both mean the row is no longer in the way, and sorting them into two piles
// asked the reader to remember which kind of gone a row had been before they
// could find it. One list, newest first, is the order the question is actually
// asked in: the thing you are looking for is nearly always the thing you just
// did.
//
// Nothing here is stored and nothing here writes. A finished row is one whose
// own `done` is set, a deleted one is a T-7 tombstone, and both timestamps are
// fields the fold already carries — sync-flow.md §7, item 3.
//
// Each entry names only the *top* of its run. A finished task inside a finished
// folder is one thing the user finished rather than two, and a row inside a
// tombstoned subtree was never deleted on its own — listing the descendants
// would turn one delete into a page of them.

import { ancestorsOf, parentOf, type ResolvedTree } from './tree';
import { isRoot, type Node, type NodeId } from './types';

export interface ArchivedRow {
  id: NodeId;
  /** Root first, the row's own parent last — the path T-9 renders. */
  path: readonly NodeId[];
  /** When the row left the tree: its tombstone's stamp, or its tick's. */
  at: number | null;
}

/** True when the row is out of the normal view by its own doing, either way. */
function archived(node: Node): boolean {
  return node.done || node.deleted;
}

/**
 * When this row left, whichever way it left.
 *
 * A row that is both ticked and deleted is dated by the tombstone: the delete
 * is what is undone first, so it is the event the reader is looking for.
 */
function leftAt(node: Node): number | null {
  return node.deleted ? node.deletedAt : node.doneAt;
}

/** True when some resolved ancestor is already the entry that answers for this row. */
function coveredByAncestor(tree: ResolvedTree, id: NodeId): boolean {
  let cursor = parentOf(tree, id);
  // G-1 and R-1. Any of the three roots ends the walk: an agenda item's chain
  // stops at `agenda` and a chore's at `timely`, and reading either as a node
  // would be reading a node that does not exist. Nothing under `timely` reaches
  // here in practice — R-3's tick writes a day rather than `done` — but the walk
  // is the tree's and knows nothing about that.
  while (!isRoot(cursor)) {
    if (archived(tree.nodes[cursor]!)) return true;
    cursor = parentOf(tree, cursor);
  }
  return false;
}

/**
 * Every row the tree no longer shows, newest first.
 *
 * A row with no stamp at all sorts last rather than first: `doneAt` is a field
 * the fold derives, and a log compacted before it existed can leave a row
 * ticked with nothing saying when. Undated at the bottom is the honest place
 * for it — the alternative dates it 1970 and puts it under today's work.
 */
export function archivedRows(tree: ResolvedTree): ArchivedRow[] {
  const ids = Object.keys(tree.nodes).filter(
    (id) => archived(tree.nodes[id]!) && !coveredByAncestor(tree, id),
  );
  ids.sort((a, b) => {
    const left = leftAt(tree.nodes[a]!);
    const right = leftAt(tree.nodes[b]!);
    if (left === right) return a < b ? -1 : 1;
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left;
  });
  return ids.map((id) => ({ id, path: ancestorsOf(tree, id), at: leftAt(tree.nodes[id]!) }));
}
