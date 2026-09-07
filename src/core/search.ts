// requirements.md §6 — the flat view of the tree, and the only view that
// reaches what T-11 and T-7 have taken out of it.
//
// F-4: nothing is indexed. This is a scan of the materialised tree per query,
// which means there is no index to invalidate and a peer's merged edit is
// findable the moment the fold lands. What makes that affordable is the same
// thing that let sync-flow.md §4.6 defer compaction for years — one person's
// checklist is thousands of nodes, not millions.

import { compareSiblings } from './order';
import { ancestorsOf, type ResolvedTree } from './tree';
import type { NodeId } from './types';

export type MatchField = 'title' | 'body';

export interface SearchHit {
  id: NodeId;
  /** Root first, the row's own parent last — the path T-9 and T-12 render. */
  path: readonly NodeId[];
  /** Where the strongest match landed, which is also the ranking. */
  field: MatchField;
  /** The body around the first match, or the empty string for a title hit. */
  snippet: string;
  /** F-3: the tree does not show these, so the row has to say why. */
  done: boolean;
  deleted: boolean;
}

/** Characters either side of a body match, so the snippet reads as a phrase. */
const SNIPPET_PAD = 40;

/**
 * Whitespace-separated terms, all of which must match, each against either
 * field — "milk shop" finds a row titled "Milk" in a note whose body mentions
 * the shop, because the row is what is being looked for and the fields are
 * only where the words happen to live.
 */
export function termsOf(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== '');
}

/** The body around the first match, elided at both ends when it was cut. */
function snippetOf(body: string, term: string): string {
  const at = body.toLowerCase().indexOf(term);
  if (at === -1) return body.slice(0, SNIPPET_PAD * 2).trim();
  const from = Math.max(0, at - SNIPPET_PAD);
  const to = Math.min(body.length, at + term.length + SNIPPET_PAD);
  return (from > 0 ? '…' : '') + body.slice(from, to).trim() + (to < body.length ? '…' : '');
}

/**
 * F-1 and F-3. Every node is a candidate, including the ones the normal view
 * drops: a finished row and a deleted one are exactly what somebody searching
 * by name is trying to find, and the Done view only helps if they remember it
 * was finished.
 *
 * Ranking is a title before a body, then tree order — no score. A relevance
 * score is a thing to tune forever, and the path on every row is what actually
 * tells two "Milk"s apart.
 */
export function searchTree(tree: ResolvedTree, query: string): SearchHit[] {
  const terms = termsOf(query);
  if (terms.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const id of Object.keys(tree.nodes)) {
    const node = tree.nodes[id]!;
    const title = node.title.toLowerCase();
    const body = (node.body ?? '').toLowerCase();
    if (!terms.every((term) => title.includes(term) || body.includes(term))) continue;

    const inTitle = terms.find((term) => title.includes(term));
    const field: MatchField = inTitle !== undefined ? 'title' : 'body';
    const bodyTerm = terms.find((term) => body.includes(term));
    hits.push({
      id,
      path: ancestorsOf(tree, id),
      field,
      snippet: field === 'body' && bodyTerm ? snippetOf(node.body ?? '', bodyTerm) : '',
      done: node.done,
      deleted: tree.deleted.has(id),
    });
  }

  hits.sort((a, b) => {
    if (a.field !== b.field) return a.field === 'title' ? -1 : 1;
    return comparePaths(tree, a, b);
  });
  return hits;
}

/** Tree order for rows the tree may no longer hold: compare the paths, step by step. */
function comparePaths(tree: ResolvedTree, a: SearchHit, b: SearchHit): number {
  const left = [...a.path, a.id];
  const right = [...b.path, b.id];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] === right[i]) continue;
    return compareSiblings(tree.nodes[left[i]!]!, tree.nodes[right[i]!]!);
  }
  return left.length - right.length;
}
