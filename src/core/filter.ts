// A-4. The tag filter, as a pure question about the tree — requirements.md §4.2.
//
// Nothing is indexed and nothing is stored, for the same reason search is not
// (F-4): one person's checklist is thousands of nodes, and a scan per change of
// filter costs less than an index that has to be kept true.
//
// A row survives the filter when it carries *every* selected tag. Its ancestors
// survive with it, because a hit three levels down that nothing renders a path
// to is a hit the filter promised and did not deliver.

import { hasEveryTag } from './tags';
import { ancestorsOf, childrenOf, type ResolvedTree } from './tree';
import { ROOT, type NodeId, type ParentId } from './types';

export interface TagCount {
  tag: string;
  /** How many rows in the tree carry it — what the chip shows. */
  count: number;
}

/**
 * Every tag in the visible tree, with how many rows carry it, most used first
 * and alphabetical within a count. A tag that only a deleted or finished row
 * carries is not offered: the filter is the tree's, and those rows are not in it.
 */
export function tagsInTree(tree: ResolvedTree): TagCount[] {
  const counts = new Map<string, number>();
  for (const id of visibleIds(tree)) {
    for (const tag of tree.nodes[id]!.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1));
}

/** The rows the tree renders — T-7 and T-11 have already taken the rest out. */
function visibleIds(tree: ResolvedTree, parent: ParentId = ROOT, out: NodeId[] = []): NodeId[] {
  for (const id of childrenOf(tree, parent)) {
    out.push(id);
    visibleIds(tree, id, out);
  }
  return out;
}

/**
 * The ids a filtered tree may render: every row carrying all of `tags`, plus
 * every ancestor of one. An empty selection filters nothing, and says so with
 * `null` rather than with a set holding the whole tree — the caller renders the
 * unfiltered tree in that case and never walks it twice.
 */
export function filteredIds(tree: ResolvedTree, tags: Iterable<string>): ReadonlySet<NodeId> | null {
  const wanted = [...tags];
  if (wanted.length === 0) return null;

  const shown = new Set<NodeId>();
  for (const id of visibleIds(tree)) {
    if (!hasEveryTag(tree.nodes[id]!.tags, wanted)) continue;
    shown.add(id);
    // The ancestors are context rather than matches: they are drawn as ordinary
    // rows, because opening one is the whole point of showing it.
    for (const ancestor of ancestorsOf(tree, id)) shown.add(ancestor);
  }
  return shown;
}

/** How many rows the current filter actually matched, for the bar to report. */
export function matchCount(tree: ResolvedTree, tags: Iterable<string>): number {
  const wanted = [...tags];
  if (wanted.length === 0) return 0;
  let matched = 0;
  for (const id of visibleIds(tree)) {
    if (hasEveryTag(tree.nodes[id]!.tags, wanted)) matched++;
  }
  return matched;
}
