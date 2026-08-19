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
import { childrenOf, isAncestorOrSelf, parentOf, siblingsOf, type ResolvedTree } from './tree';
import {
  KINDS,
  ROOT,
  type EditContext,
  type Kind,
  type Node,
  type NodeId,
  type Op,
  type ParentId,
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
}

/** A new row directly below `id`, among its siblings — `Enter` on a leaf row. */
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
  return createAt(ctx, parent, keyAfter(siblings, index), options);
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

function createAt(ctx: EditContext, parent: ParentId, order: string, options: CreateOptions): Op[] {
  const id = ctx.mintId();
  const kind = options.kind ?? 'task';
  const ops: Op[] = [{ op: 'create', id, parent, kind, order, ...stamp(ctx) }];
  if (options.title) ops.push({ op: 'set', id, title: options.title, ...stamp(ctx) });
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

/** K-5 "Turn into", and K-6's promotion of a note to a checklist. */
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
    case 'parent':
      return [];
  }
}

function isKind(value: FieldValue): value is Kind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}

export function canIndent(tree: ResolvedTree, id: NodeId): boolean {
  const siblings = siblingsOf(tree, id);
  return siblings.indexOf(id) > 0;
}

/** T-3: become a child of the sibling above, at the end of its children. */
export function indent(tree: ResolvedTree, ctx: EditContext, id: NodeId): Op[] {
  const siblings = siblingsOf(tree, id);
  const index = siblings.indexOf(id);
  if (index <= 0) return [];
  const newParent = siblings[index - 1]!;
  return [
    { op: 'move', id, parent: newParent, order: keyAtEnd(siblingNodes(tree, newParent)), ...stamp(ctx) },
  ];
}

export function canOutdent(tree: ResolvedTree, id: NodeId): boolean {
  return parentOf(tree, id) !== ROOT;
}

/** T-3: become the parent's next sibling, directly below it. */
export function outdent(tree: ResolvedTree, ctx: EditContext, id: NodeId): Op[] {
  const parent = parentOf(tree, id);
  if (parent === ROOT) return [];
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
  if (newParent !== ROOT && !tree.nodes[newParent]) return false;
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
