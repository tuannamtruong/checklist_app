// What to call the place a row hangs under.
//
// G-1 gave the app a second root, so "the top level" is two answers rather than
// one: a row in the tree comes from `All`, and an agenda item comes from Today
// or Tomorrow — which of the two is the same question the two pages ask, asked
// of one row. Three views print a path (breadcrumbs, the Done view and search),
// and this is the one place that knows the answer.

import { dayKey } from '../core/agenda';
import { ancestorsOf, rootOf, type ResolvedTree } from '../core/tree';
import { AGENDA, type NodeId } from '../core/types';
import { TODAY_HREF, TOMORROW_HREF } from '../app/router.svelte';

export interface RootLabel {
  label: string;
  href: string;
}

export function rootLabelOf(tree: ResolvedTree, id: NodeId, now: number): RootLabel {
  if (rootOf(tree, id) !== AGENDA) return { label: 'All', href: '#/' };
  // The day belongs to the item at the top of the agenda, not to a child of it:
  // a sub-row is in the list its parent is in — `core/agenda.ts`.
  const top = ancestorsOf(tree, id)[0] ?? id;
  const day = tree.nodes[top]?.day ?? null;
  return day === null || day <= dayKey(now)
    ? { label: 'Today', href: TODAY_HREF }
    : { label: 'Tomorrow', href: TOMORROW_HREF };
}

/** The Done view's and search's one-line path, root included when it is not `All`. */
export function pathLabelOf(
  tree: ResolvedTree,
  id: NodeId,
  path: readonly NodeId[],
  now: number,
): string {
  const root = rootLabelOf(tree, id, now);
  const names = path.map((ancestor) => tree.nodes[ancestor]?.title || 'Untitled');
  if (root.label !== 'All') names.unshift(root.label);
  return names.length === 0 ? root.label : names.join(' / ');
}
