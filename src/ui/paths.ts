// What to call the place a row hangs under.
//
// G-1 and R-1 gave the app two more roots, so "the top level" is four answers
// rather than one: a row in the tree comes from `All`, an agenda item from Today
// or Tomorrow — which of the two is the same question the two pages ask, asked
// of one row — and a chore from Timely. Three views print a path (breadcrumbs,
// the Done view and search), and this is the one place that knows the answer.

import { dayKey } from '../core/agenda';
import { ancestorsOf, rootOf, type ResolvedTree } from '../core/tree';
import { AGENDA, TIMELY, type NodeId } from '../core/types';
import { TIMELY_HREF, TODAY_HREF, TOMORROW_HREF } from '../app/router.svelte';

export interface RootLabel {
  label: string;
  href: string;
}

export function rootLabelOf(tree: ResolvedTree, id: NodeId, now: number): RootLabel {
  const root = rootOf(tree, id);
  // R-1. The third list has one name whichever day the item is next due on: the
  // day is a countdown rather than a place, so it names no second list here.
  if (root === TIMELY) return { label: 'Timely', href: TIMELY_HREF };
  if (root !== AGENDA) return { label: 'All', href: '#/' };
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
