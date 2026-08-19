// The flat list of rows the tree is actually rendering, which is what the
// keyboard model moves through: `↑` and `↓` follow what the user can see, not
// what the tree contains, so a collapsed subtree is skipped rather than walked.

import { childrenOf, type ResolvedTree } from '../core/tree';
import type { NodeId, ParentId } from '../core/types';

export interface VisibleRow {
  id: NodeId;
  depth: number;
}

/**
 * A-4: the ids a tag filter allows, or `null` when nothing is filtered. A row
 * outside the set is not rendered at all — and since every edit reads these
 * rows, `↑` and `Alt-↓` move through what the filter left exactly as they move
 * through what T-11 left.
 */
export function visibleRows(
  tree: ResolvedTree,
  parent: ParentId,
  isCollapsed: (id: NodeId) => boolean,
  allowed: ReadonlySet<NodeId> | null = null,
  depth = 0,
): VisibleRow[] {
  const rows: VisibleRow[] = [];
  for (const id of childrenOf(tree, parent)) {
    if (allowed !== null && !allowed.has(id)) continue;
    rows.push({ id, depth });
    if (!isCollapsed(id)) rows.push(...visibleRows(tree, id, isCollapsed, allowed, depth + 1));
  }
  return rows;
}

export function rowAbove(rows: readonly VisibleRow[], id: NodeId): NodeId | null {
  const index = rows.findIndex((row) => row.id === id);
  return index > 0 ? rows[index - 1]!.id : null;
}

export function rowBelow(rows: readonly VisibleRow[], id: NodeId): NodeId | null {
  const index = rows.findIndex((row) => row.id === id);
  return index !== -1 && index < rows.length - 1 ? rows[index + 1]!.id : null;
}
