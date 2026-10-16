// Every edit the user can make, as a function from the tree to the ops that
// change it. Nothing here touches storage, a clock or the DOM: an edit returns
// ops and the caller decides what to do with them, which is what lets the whole
// keyboard model be tested without a browser.
//
// A refused or empty edit returns no ops at all. That is S-10 — a no-op edit is
// dropped before it reaches the log — and it is also what keeps `Escape` on an
// unchanged title from costing a write.

import type { ConflictField, FieldValue } from './conflicts';
import { keyBetween } from './order';
import { cleanTags, sameTags } from './tags';
import { dayKey } from './agenda';
import { isDue, nextDue, parsePeriod, periodOf } from './timely';
import {
  childrenOf,
  isAncestorOrSelf,
  parentOf,
  rootOf,
  siblingsOf,
  type ResolvedTree,
} from './tree';
import {
  isRoot,
  KINDS,
  PRIORITIES,
  TIMELY,
  type EditContext,
  type Kind,
  type Node,
  type NodeId,
  type Op,
  type ParentId,
  type Priority,
} from './types';

function stamp(ctx: EditContext): { c: number; at: number; dev: string } {
  return { c: ctx.nextCounter(), at: ctx.now(), dev: ctx.deviceId };
}

function siblingNodes(tree: ResolvedTree, parent: ParentId): Node[] {
  return childrenOf(tree, parent).map((id) => tree.nodes[id]!);
}

/**
 * A key that sorts after `siblings[index]`.
 *
 * Two concurrently inserted siblings can hold the *same* key — that is expected,
 * and sync-flow.md §5.3 keeps the order total with the device id. It does mean
 * "between these two" is sometimes unaskable, so the next *distinct* key is the
 * upper bound: the new row lands after the whole equal-key run, deterministically.
 */
function keyAfter(siblings: readonly Node[], index: number): string {
  const before = siblings[index]!.order;
  for (let i = index + 1; i < siblings.length; i++) {
    if (siblings[i]!.order > before) return keyBetween(before, siblings[i]!.order);
  }
  return keyBetween(before, null);
}

/** A key that sorts before `siblings[index]`, by the same rule. */
function keyBefore(siblings: readonly Node[], index: number): string {
  const after = siblings[index]!.order;
  for (let i = index - 1; i >= 0; i--) {
    if (siblings[i]!.order < after) return keyBetween(siblings[i]!.order, after);
  }
  return keyBetween(null, after);
}

function keyAtEnd(siblings: readonly Node[]): string {
  return siblings.length === 0 ? keyBetween(null, null) : keyAfter(siblings, siblings.length - 1);
}

function keyAtStart(siblings: readonly Node[]): string {
  return siblings.length === 0 ? keyBetween(null, null) : keyBefore(siblings, 0);
}

export interface CreateOptions {
  kind?: Kind;
  title?: string;
  /**
   * A-8. The tags typed in front of the title on the add line — `parseTagged`
   * in `src/core/tags.ts` is what reads them off it. It carried A-6's tag
   * filter until M11, and the field is the same field: a `create` and one
   * companion `set`.
   */
  tags?: readonly string[];
  /**
   * G-5. The day an agenda item is filed for — the page's own day, so a row
   * typed on Tomorrow is in Tomorrow rather than in Today for a moment.
   */
  day?: string | null;
  /**
   * R-2. The period a timely item repeats at, carried by the same companion
   * `set` the day is: a row created in Timely repeats from the moment it exists,
   * or its first tick would have nothing to add.
   */
  every?: string | null;
}

/**
 * A new row directly below `id`, among its siblings — `Enter` on a leaf row.
 * It is the kind `id` is unless asked otherwise: a run of notes is typed as
 * notes, exactly as a run of tasks always was — §3.1.
 */
export function createSiblingBelow(
  tree: ResolvedTree,
  ctx: EditContext,
  id: NodeId,
  options: CreateOptions = {},
): Op[] {
  const parent = parentOf(tree, id);
  const siblings = siblingNodes(tree, parent);
  const index = siblings.findIndex((node) => node.id === id);
  if (index === -1) return [];
  return createAt(ctx, parent, keyAfter(siblings, index), {
    kind: siblings[index]!.kind,
    ...options,
  });
}

/** `Enter` on an expanded parent means the user is filling it, not following it. */
export function createFirstChild(
  tree: ResolvedTree,
  ctx: EditContext,
  parent: ParentId,
  options: CreateOptions = {},
): Op[] {
  return createAt(ctx, parent, keyAtStart(siblingNodes(tree, parent)), options);
}

export function createLastChild(
  tree: ResolvedTree,
  ctx: EditContext,
  parent: ParentId,
  options: CreateOptions = {},
): Op[] {
  return createAt(ctx, parent, keyAtEnd(siblingNodes(tree, parent)), options);
}

/**
 * K-9. A pasted paragraph, as rows: one per title, in the order they were
 * written, all at the end of the list.
 *
 * It is one call rather than one `createLastChild` per line because the tree
 * this edit is given is the tree as it was before any of them: the second row's
 * key has to be minted against the first row's, which is not in the tree yet.
 * Each key is taken after the one before it, so the run lands in the pasted
 * order however many rows it holds — and every row is still an ordinary
 * `create`, so a paste merges exactly like fifteen separate ones would.
 */
export function createLastChildren(
  tree: ResolvedTree,
  ctx: EditContext,
  parent: ParentId,
  /**
   * A-8. Each row brings its own tags as well as its title, because each line
   * of a pasted block carries its own `#tag` prefix — the whole block is one
   * paste and no two lines of it need agree about anything.
   */
  rows: readonly { title: string; tags?: readonly string[] }[],
  options: CreateOptions = {},
): Op[] {
  const siblings = siblingNodes(tree, parent);
  const ops: Op[] = [];
  let order: string | null = null;
  for (const row of rows) {
    order = order === null ? keyAtEnd(siblings) : keyBetween(order, null);
    const tags = [...(options.tags ?? []), ...(row.tags ?? [])];
    ops.push(...createAt(ctx, parent, order, { ...options, title: row.title, tags }));
  }
  return ops;
}

function createAt(ctx: EditContext, parent: ParentId, order: string, options: CreateOptions): Op[] {
  const id = ctx.mintId();
  const kind = options.kind ?? 'task';
  const ops: Op[] = [{ op: 'create', id, parent, kind, order, ...stamp(ctx) }];
  const tags = cleanTags(options.tags ?? []);
  const day = options.day ?? null;
  const every = options.every ?? null;
  if (options.title || tags.length > 0 || day !== null || every !== null) {
    const set: Op = { op: 'set', id, ...stamp(ctx) };
    if (options.title) set.title = options.title;
    if (tags.length > 0) set.tags = tags;
    if (day !== null) set.day = day;
    if (every !== null) set.every = every;
    ops.push(set);
  }
  return ops;
}

/**
 * A field write to a tombstoned node is dropped.
 *
 * T-7 already says the tombstone wins over everything in the subtree, so the op
 * would cost bytes and change nothing. It is not a theoretical case: `Backspace`
 * on an empty row deletes it and then moves the caret, and the blur that follows
 * would otherwise commit the emptied title *after* the delete — which the Done
 * view of T-12 renders, so the row would be listed as "Untitled".
 */
function isWritable(node: Node | undefined): node is Node {
  return node !== undefined && !node.deleted;
}

export function setTitle(tree: ResolvedTree, ctx: EditContext, id: NodeId, title: string): Op[] {
  const node = tree.nodes[id];
  if (!isWritable(node) || node.title === title) return [];
  return [{ op: 'set', id, title, ...stamp(ctx) }];
}

/** K-2: only a task is checkable, so only a task can be ticked. */
export function toggleDone(tree: ResolvedTree, ctx: EditContext, id: NodeId): Op[] {
  const node = tree.nodes[id];
  if (!isWritable(node) || node.kind !== 'task') return [];
  return [{ op: 'set', id, done: !node.done, ...stamp(ctx) }];
}

export function setBody(tree: ResolvedTree, ctx: EditContext, id: NodeId, body: string): Op[] {
  const node = tree.nodes[id];
  if (!isWritable(node) || node.body === body) return [];
  return [{ op: 'set', id, body, ...stamp(ctx) }];
}

/**
 * A-1. The whole set, every time: `tags` is one field, so an add and a remove
 * are both "these are the tags now" — past_decision.md §10.
 */
export function setTags(
  tree: ResolvedTree,
  ctx: EditContext,
  id: NodeId,
  tags: readonly string[],
): Op[] {
  const node = tree.nodes[id];
  const next = cleanTags(tags);
  if (!isWritable(node) || sameTags(node.tags, next)) return [];
  return [{ op: 'set', id, tags: next, ...stamp(ctx) }];
}

export function addTag(tree: ResolvedTree, ctx: EditContext, id: NodeId, tag: string): Op[] {
  const node = tree.nodes[id];
  if (!isWritable(node)) return [];
  return setTags(tree, ctx, id, [...node.tags, tag]);
}

export function removeTag(tree: ResolvedTree, ctx: EditContext, id: NodeId, tag: string): Op[] {
  const node = tree.nodes[id];
  if (!isWritable(node)) return [];
  return setTags(
    tree,
    ctx,
    id,
    node.tags.filter((held) => held !== tag),
  );
}

/** A-2. `none` is a value, so clearing a flag is a write like setting one. */
export function setPriority(
  tree: ResolvedTree,
  ctx: EditContext,
  id: NodeId,
  priority: Priority,
): Op[] {
  const node = tree.nodes[id];
  if (!isWritable(node) || node.priority === priority) return [];
  return [{ op: 'set', id, priority, ...stamp(ctx) }];
}

/**
 * G-6. Moving an item between Today and Tomorrow, which is one field and not a
 * move at all: the two lists are a question about this day, so writing a new
 * one is the whole edit. It merges like a flag — last write wins, and a device
 * that filed it for a different day is a C-1 row rather than a lost item.
 */
export function setDay(tree: ResolvedTree, ctx: EditContext, id: NodeId, day: string | null): Op[] {
  const node = tree.nodes[id];
  if (!isWritable(node) || node.day === day) return [];
  return [{ op: 'set', id, day, ...stamp(ctx) }];
}

/**
 * R-2. How often a timely item repeats, as one last-writer-wins field.
 *
 * A period this build cannot read is refused rather than written as null: the
 * caller is `RepeatEditor`, which builds the string from a count and a unit, and
 * a value that got past it is a bug rather than a clearing.
 */
export function setEvery(
  tree: ResolvedTree,
  ctx: EditContext,
  id: NodeId,
  every: string | null,
): Op[] {
  const node = tree.nodes[id];
  if (!isWritable(node) || node.every === every) return [];
  if (every !== null && parsePeriod(every) === null) return [];
  return [{ op: 'set', id, every, ...stamp(ctx) }];
}

/**
 * R-3, R-5 and R-6: the box on a timely row, which writes a day rather than a
 * tick.
 *
 * A due item is filed for `now + every`, so it leaves the way it came back and
 * the countdown starts at the tick — the day the item was carrying is not an
 * input to that sum. A waiting item is filed for today, which is the same
 * control meaning "no, it is due": there is no third state to reach.
 *
 * `done` is never written here, and that is what keeps a chore out of T-11's
 * filter and out of T-12's archive without either of them learning about it.
 */
export function tickTimely(tree: ResolvedTree, ctx: EditContext, id: NodeId): Op[] {
  const node = tree.nodes[id];
  if (!isWritable(node) || node.kind !== 'task') return [];
  const now = ctx.now();
  return setDay(tree, ctx, id, isDue(node, now) ? nextDue(now, periodOf(node)) : dayKey(now));
}

/**
 * What the flag on the row does: one control, four states, highest first —
 * requirements.md §4.1. A menu of four entries would teach nothing this does not.
 */
export function nextPriority(current: Priority): Priority {
  const cycle: readonly Priority[] = ['none', 'high', 'medium', 'low'];
  const index = cycle.indexOf(current);
  return cycle[(index + 1) % cycle.length]!;
}

/** K-5 "Turn into", from the row menu, which is the only caller there is. */
export function turnInto(tree: ResolvedTree, ctx: EditContext, id: NodeId, kind: Kind): Op[] {
  const node = tree.nodes[id];
  if (!isWritable(node) || node.kind === kind) return [];
  return [{ op: 'set', id, kind, ...stamp(ctx) }];
}

/**
 * C-1: the value a concurrent write lost, written back by hand.
 *
 * It is an ordinary `set` and nothing more. Because the device doing it has read
 * both sides, its op dominates both and the conflict row that offered it stops
 * being derivable — which is the whole of "any device can settle any race",
 * S-6, with no resolution protocol anywhere.
 *
 * `parent` is not offered. Putting a row back under a parent is a move, and a
 * move needs an order key among siblings the losing device never saw; the user
 * drags it instead, which is the same corrective edit sync-flow.md §6.2 relies on.
 */
export function restoreValue(
  tree: ResolvedTree,
  ctx: EditContext,
  id: NodeId,
  field: ConflictField,
  value: FieldValue,
): Op[] {
  switch (field) {
    case 'title':
      return typeof value === 'string' ? setTitle(tree, ctx, id, value) : [];
    case 'body':
      return typeof value === 'string' ? setBody(tree, ctx, id, value) : [];
    case 'kind':
      return isKind(value) ? turnInto(tree, ctx, id, value) : [];
    case 'done': {
      const node = tree.nodes[id];
      if (typeof value !== 'boolean' || !isWritable(node) || node.done === value) return [];
      return [{ op: 'set', id, done: value, ...stamp(ctx) }];
    }
    // The one field where taking the dropped value is not a `set`, because the
    // field's two writers are `delete` and `restore` — T-13, sync-flow.md §4.9.
    // It is also the one case that may write to a tombstoned node, which is the
    // entire point of it.
    case 'deleted': {
      const node = tree.nodes[id];
      if (typeof value !== 'boolean' || !node || node.deleted === value) return [];
      return value ? remove(tree, ctx, id) : restore(tree, ctx, id);
    }
    case 'tags':
      return Array.isArray(value) ? setTags(tree, ctx, id, value) : [];
    case 'priority':
      return isPriority(value) ? setPriority(tree, ctx, id, value) : [];
    // G-2, and taking the dropped day back is what puts the item in the list
    // the other device filed it for.
    case 'day':
      return typeof value === 'string' || value === null ? setDay(tree, ctx, id, value) : [];
    // R-2. Taking the dropped period back is what makes the item repeat at the
    // rate the other device asked for, and it is the same `set` as setting one.
    case 'every':
      return typeof value === 'string' || value === null ? setEvery(tree, ctx, id, value) : [];
    case 'parent':
      return [];
  }
}

function isPriority(value: FieldValue): value is Priority {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value);
}

function isKind(value: FieldValue): value is Kind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}

export function canIndent(tree: ResolvedTree, id: NodeId): boolean {
  const siblings = siblingsOf(tree, id);
  const index = siblings.indexOf(id);
  // R-1. The sibling above may refuse to hold it: Timely is one level deep, and
  // the refusal belongs to the model rather than to the key that provokes it.
  return index > 0 && canMoveTo(tree, id, siblings[index - 1]!);
}

/** T-3: become a child of the sibling above, at the end of its children. */
export function indent(tree: ResolvedTree, ctx: EditContext, id: NodeId): Op[] {
  const siblings = siblingsOf(tree, id);
  const index = siblings.indexOf(id);
  if (index <= 0) return [];
  const newParent = siblings[index - 1]!;
  if (!canMoveTo(tree, id, newParent)) return [];
  return [
    { op: 'move', id, parent: newParent, order: keyAtEnd(siblingNodes(tree, newParent)), ...stamp(ctx) },
  ];
}

export function canOutdent(tree: ResolvedTree, id: NodeId): boolean {
  // G-1. Both roots stop it. Outdenting a top-level agenda item would ask for
  // the parent of `agenda`, which is nothing, and land the item in the tree.
  return !isRoot(parentOf(tree, id));
}

/** T-3: become the parent's next sibling, directly below it. */
export function outdent(tree: ResolvedTree, ctx: EditContext, id: NodeId): Op[] {
  const parent = parentOf(tree, id);
  if (isRoot(parent)) return [];
  const grandparent = parentOf(tree, parent);
  const uncles = siblingNodes(tree, grandparent);
  const index = uncles.findIndex((node) => node.id === parent);
  if (index === -1) return [];
  return [{ op: 'move', id, parent: grandparent, order: keyAfter(uncles, index), ...stamp(ctx) }];
}

export function canMoveUp(tree: ResolvedTree, id: NodeId): boolean {
  return siblingsOf(tree, id).indexOf(id) > 0;
}

export function canMoveDown(tree: ResolvedTree, id: NodeId): boolean {
  const siblings = siblingsOf(tree, id);
  const index = siblings.indexOf(id);
  return index !== -1 && index < siblings.length - 1;
}

/** T-4. Only the moved node is written — the siblings it passes are untouched. */
export function moveUp(tree: ResolvedTree, ctx: EditContext, id: NodeId): Op[] {
  const parent = parentOf(tree, id);
  const siblings = siblingNodes(tree, parent);
  const index = siblings.findIndex((node) => node.id === id);
  if (index <= 0) return [];
  return [{ op: 'move', id, parent, order: keyBefore(siblings, index - 1), ...stamp(ctx) }];
}

export function moveDown(tree: ResolvedTree, ctx: EditContext, id: NodeId): Op[] {
  const parent = parentOf(tree, id);
  const siblings = siblingNodes(tree, parent);
  const index = siblings.findIndex((node) => node.id === id);
  if (index === -1 || index === siblings.length - 1) return [];
  return [{ op: 'move', id, parent, order: keyAfter(siblings, index + 1), ...stamp(ctx) }];
}

/**
 * T-5. The check is a local ancestor walk, and against what this device can see
 * it is correct — it catches a user dropping a folder into its own child. It is
 * not what keeps the tree a tree: the merge case is T-6's, and no local check
 * can reach it — sync-flow.md §6.1.
 */
export function canMoveTo(tree: ResolvedTree, id: NodeId, newParent: ParentId): boolean {
  if (!tree.nodes[id]) return false;
  if (!isRoot(newParent) && !tree.nodes[newParent]) return false;
  // G-1 and R-1. The three roots are three lists and nothing crosses between
  // them: what is in Today was put there by hand and is not a row of any folder,
  // and a chore that repeats is not a row of one either.
  if (rootOf(tree, id) !== rootOf(tree, newParent)) return false;
  // R-1. Timely is one level deep, so no timely row holds anything — a chore
  // nested under a chore is a question about which of the two a tick belongs to.
  if (!isRoot(newParent) && rootOf(tree, newParent) === TIMELY) return false;
  return !isAncestorOrSelf(tree, id, newParent);
}

export function moveTo(
  tree: ResolvedTree,
  ctx: EditContext,
  id: NodeId,
  newParent: ParentId,
  afterId: NodeId | null,
): Op[] {
  if (!canMoveTo(tree, id, newParent)) return [];
  const siblings = siblingNodes(tree, newParent).filter((node) => node.id !== id);
  let order: string;
  if (afterId === null) order = keyAtStart(siblings);
  else {
    const index = siblings.findIndex((node) => node.id === afterId);
    order = index === -1 ? keyAtEnd(siblings) : keyAfter(siblings, index);
  }
  return [{ op: 'move', id, parent: newParent, order, ...stamp(ctx) }];
}

/** T-14. Where a drop lands, relative to the row it landed on. */
export type DropWhere = 'before' | 'after' | 'inside';

/**
 * T-5's question again, asked in the vocabulary of a drop: dropping *inside* a
 * row is a move into it, and dropping above or below one is a move into its
 * parent. A drop onto the dragged row itself is neither — it is the gesture
 * ending where it started.
 */
export function canDrop(tree: ResolvedTree, id: NodeId, target: NodeId, where: DropWhere): boolean {
  if (id === target) return false;
  return canMoveTo(tree, id, where === 'inside' ? target : parentOf(tree, target));
}

/**
 * T-14, and it is one `move` op — the same op `Tab` and `Alt-↓` write. The order
 * key is minted among the target's siblings by the same rule every other
 * insertion uses (T-2), so two devices dragging into one gap settle by
 * sync-flow.md §5.3 rather than by anything the drag knows.
 *
 * The dragged row is taken out of the sibling list before the key is minted,
 * because "below the row above me" must not mean "below myself".
 */
export function dropOnto(
  tree: ResolvedTree,
  ctx: EditContext,
  id: NodeId,
  target: NodeId,
  where: DropWhere,
): Op[] {
  if (!canDrop(tree, id, target, where)) return [];

  if (where === 'inside') {
    // Into the end of what is already there, which is where `Tab` puts a row
    // too — a drop onto a row is "put this in here", not "put this first".
    const children = childrenOf(tree, target).filter((child) => child !== id);
    return moveTo(tree, ctx, id, target, children[children.length - 1] ?? null);
  }

  const parent = parentOf(tree, target);
  const siblings = childrenOf(tree, parent).filter((sibling) => sibling !== id);
  const index = siblings.indexOf(target);
  if (index === -1) return [];
  const after = where === 'after' ? target : (siblings[index - 1] ?? null);
  return moveTo(tree, ctx, id, parent, after);
}

/**
 * `Backspace` on an empty row deletes it, and is refused if it has children —
 * requirements.md §3.1. The refusal is the keyboard's, not the model's: the row
 * menu's Delete removes a subtree deliberately.
 */
export function canBackspaceDelete(tree: ResolvedTree, id: NodeId, typedTitle?: string): boolean {
  const node = tree.nodes[id];
  if (!node) return false;
  // The title the user can see, which during an edit is the one in the input
  // rather than the one in the tree — the key fires before the commit does.
  const title = typedTitle ?? node.title;
  return title === '' && childrenOf(tree, id).length === 0;
}

/** T-7. One op; the subtree is tombstoned at read time, never rewritten. */
export function remove(tree: ResolvedTree, ctx: EditContext, id: NodeId): Op[] {
  const node = tree.nodes[id];
  if (!node || node.deleted) return [];
  return [{ op: 'delete', id, ...stamp(ctx) }];
}

/**
 * T-13, and the mirror of `remove` in every way that matters: one op, and the
 * subtree comes back with it because the subtree was never individually
 * tombstoned — T-7 inherits at read time, so clearing the top of the run is the
 * whole operation.
 *
 * A node whose tombstone is inherited is refused rather than written, because
 * the op would change nothing: it clears an own-`deleted` this node does not
 * have. The Done view lists only the top of a deleted run, so it cannot offer
 * one; a hand-typed `#/n/<id>` can, and this is what it gets.
 */
export function restore(tree: ResolvedTree, ctx: EditContext, id: NodeId): Op[] {
  const node = tree.nodes[id];
  if (!node || !node.deleted) return [];
  return [{ op: 'restore', id, ...stamp(ctx) }];
}

/**
 * T-12's one action, whichever way the row left.
 *
 * The archive draws no distinction between a ticked row and a deleted one, so
 * neither does the button on it: this clears the row's own tombstone, its own
 * tick, or both. Both are ops the Done view already wrote — a `restore` and an
 * ordinary `set` — so nothing here is a new kind of write, and a row that was
 * deleted while ticked comes back into its list rather than straight into the
 * archive again.
 *
 * `toggleDone` is not the caller's route to the second op: it refuses a
 * tombstoned node, which is exactly the node this is for.
 */
export function unarchive(tree: ResolvedTree, ctx: EditContext, id: NodeId): Op[] {
  const node = tree.nodes[id];
  if (!node) return [];
  const ops: Op[] = [];
  if (node.deleted) ops.push({ op: 'restore', id, ...stamp(ctx) });
  if (node.done) ops.push({ op: 'set', id, done: false, ...stamp(ctx) });
  return ops;
}

/** True when restoring this row would actually put it back in the tree. */
export function canRestore(tree: ResolvedTree, id: NodeId): boolean {
  const node = tree.nodes[id];
  if (!node || !node.deleted) return false;
  // An ancestor's tombstone outlives this one, so the row would stay gone.
  let cursor = parentOf(tree, id);
  while (!isRoot(cursor)) {
    if (tree.nodes[cursor]?.deleted) return false;
    cursor = parentOf(tree, cursor);
  }
  return true;
}
