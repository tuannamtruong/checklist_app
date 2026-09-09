// A-4. Finding rows by tag, as a pure question about the tree — requirements.md §4.2.
//
// Nothing is indexed and nothing is stored, for the same reason search is not
// (F-4): one person's checklist is thousands of nodes, and a scan per question
// costs less than an index that has to be kept true.
//
// This used to answer a *filter over the tree* — which ids a page may draw,
// with every match's ancestors added so a hit in a collapsed folder was
// reachable. It answers a list instead now: the tree is the tree, and `#/tags`
// is the one place a tag narrows anything (§4.2). A list needs matches and the
// path to each, which is the shape §6's search hits already have, so the two
// views read the same way.

import { hasEveryTag } from './tags';
import { ancestorsOf, childrenOf, type ResolvedTree } from './tree';
import { ROOT, type NodeId, type ParentId } from './types';

export interface TagCount {
  tag: string;
  /** How many rows in the tree carry it — what the entry shows. */
  count: number;
}

export interface TaggedRow {
  id: NodeId;
  /** Root first, the row's own parent last — the path T-9 and T-12 render. */
  path: readonly NodeId[];
}

/**
 * Every tag in the visible tree, with how many rows carry it, most used first
 * and alphabetical within a count. A tag that only a deleted or finished row
 * carries is not offered: the list is the tree's, and those rows are not in it.
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
 * Every row carrying *all* of `tags`, in tree order, each with the path it sits
 * on. AND rather than OR — A-4 — and the ancestors are the path rather than
 * results of their own: a list says where a row is, where a filtered tree had
 * to draw the ancestors as rows to have somewhere to hang the match.
 *
 * An empty selection matches nothing rather than everything: the caller is a
 * page asking "which rows carry these tags", and no tags is not a question.
 */
export function taggedRows(tree: ResolvedTree, tags: Iterable<string>): TaggedRow[] {
  const wanted = [...tags];
  if (wanted.length === 0) return [];

  const rows: TaggedRow[] = [];
  for (const id of visibleIds(tree)) {
    if (!hasEveryTag(tree.nodes[id]!.tags, wanted)) continue;
    rows.push({ id, path: ancestorsOf(tree, id) });
  }
  return rows;
}
