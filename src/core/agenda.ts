// G-1 to G-4: Today and Tomorrow, derived.
//
// The two lists are one parent — `AGENDA`, a second root beside `root` — and a
// date comparison. Which list an item is in is not stored anywhere: an item
// records the day it is filed for, Today asks for the days that have come and
// Tomorrow for the ones that have not, so an item filed for tomorrow is in
// Today tomorrow with nothing written and nothing to merge. That is the whole
// of G-3 — past_decision.md §18.
//
// No clock here either. `now` is a parameter, exactly as it is everywhere else
// in this layer, which is what lets a test assert the day boundary rather than
// wait for one.

import { childrenOf, type ResolvedTree } from './tree';
import { AGENDA, type NodeId } from './types';

/** The two lists, and the one thing that tells them apart. */
export type AgendaList = 'today' | 'tomorrow';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * The local day a timestamp falls in, as `YYYY-MM-DD`.
 *
 * Local rather than UTC because the day this names is the user's: a row filed
 * at 23:30 is filed for that evening's date, not for the next one. Two devices
 * in different zones can disagree for a few hours, and nothing comes of it —
 * the comparison is a read, so neither device writes the other's answer down.
 */
export function dayKey(now: number): string {
  const at = new Date(now);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** The day after the one `now` falls in — what Tomorrow's line files under. */
export function nextDayKey(now: number): string {
  const at = new Date(now);
  at.setDate(at.getDate() + 1);
  return dayKey(at.getTime());
}

/** G-5. The day a page files its new items under. */
export function dayOfList(list: AgendaList, now: number): string {
  return list === 'today' ? dayKey(now) : nextDayKey(now);
}

/**
 * G-3 and G-4. The items one of the two lists shows, in T-2's sibling order.
 *
 * The cut is `day <= today` rather than `day === today`, so a day nobody got to
 * does not empty itself: an item stays in Today until it is ticked or deleted,
 * which is the only ending a checklist item has. An item carrying no day at all
 * — a hand-edited file, a peer writing a field this build did not — is shown in
 * Today rather than nowhere, for the reason every other read here is forgiving.
 */
export function agendaRows(
  tree: ResolvedTree,
  list: AgendaList,
  now: number,
): readonly NodeId[] {
  const today = dayKey(now);
  return childrenOf(tree, AGENDA).filter((id) => {
    const day = tree.nodes[id]?.day ?? null;
    if (day === null) return list === 'today';
    return list === 'today' ? day <= today : day > today;
  });
}

/**
 * The same rows plus everything they hold, which is what the view renders.
 *
 * An agenda item may own children like any other row (K-1), and the day is the
 * top row's business only — a child of an item filed for tomorrow is in
 * Tomorrow because its parent is, not because it carries a day of its own. The
 * set is the shape A-4's tag filter already hands the tree view.
 */
export function agendaIds(
  tree: ResolvedTree,
  list: AgendaList,
  now: number,
): ReadonlySet<NodeId> {
  const allowed = new Set<NodeId>();
  const walk = (id: NodeId): void => {
    if (allowed.has(id)) return;
    allowed.add(id);
    for (const child of childrenOf(tree, id)) walk(child);
  };
  for (const id of agendaRows(tree, list, now)) walk(id);
  return allowed;
}
