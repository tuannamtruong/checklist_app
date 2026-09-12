// The vocabulary of the tree: what a node is, what an op is, and the context an
// edit needs. Everything here is data — requirements.md §2 Data model is the
// authority, and a field that is not in that table does not belong in this file.

/** Eight hex characters, minted on a device's first run — glossary.md. */
export type DeviceId = string;

export type NodeId = string;

/** The top of the tree. Nothing carries a node with this id. */
export const ROOT = 'root';

/**
 * G-1. The second parent that is not a node: Today and Tomorrow hang here
 * rather than in the tree, so nothing in `All` holds them and nothing in them
 * belongs to a folder. Which of the two lists an item is in is not stored — it
 * is `day` compared with today, which is what makes G-3's rollover a read
 * rather than a write. requirements.md §4.4.
 */
export const AGENDA = 'agenda';

/**
 * R-1. The third, and the same trick a third time: Timely's repeating check
 * items hang here rather than in the tree or in the agenda. What tells it from
 * `agenda` is not the parent but what a tick means — ticking an item under it
 * files it for its next due day instead of finishing it, so `done` is never
 * written and the row never leaves the list. requirements.md §4.5.
 */
export const TIMELY = 'timely';

export type ParentId = NodeId | typeof ROOT | typeof AGENDA | typeof TIMELY;

/**
 * The parents that are not nodes. Every walk that climbs a parent chain stops
 * at one of these, and `resolveTree` must not read one as a node that failed to
 * arrive — a missing-parent repair would put an agenda item in the tree.
 */
export const ROOTS: readonly ParentId[] = [ROOT, AGENDA, TIMELY];

export function isRoot(parent: ParentId): boolean {
  return parent === ROOT || parent === AGENDA || parent === TIMELY;
}

/**
 * K-1. Kind drives rendering, never structure: any kind may own children.
 *
 * There were four until M6. `list` and `folder` differed by an icon and by
 * nothing else — both were containers, both held any kind, and neither was
 * checkable — so a row read as a list on the device that made it and as a
 * folder on the one that looked at it later. A file written before that still
 * says `list`, and `core/op-log.ts` reads it as a folder.
 */
export type Kind = 'folder' | 'note' | 'task';

export const KINDS: readonly Kind[] = ['folder', 'note', 'task'];

/**
 * T-10. The kinds the sidebar shows, at the top level and one step under it —
 * `sidebarChildren` in `core/tree.ts` is the only reader. Two levels and no
 * more: it is the way back to the few places worth starting from rather than a
 * second copy of the tree, and the deeper nesting is what the tree view draws,
 * with breadcrumbs (T-9) as the way back up out of it. A task is left out at
 * both levels because tasks are the bulk of a checklist and would bury the two
 * kinds that are navigation.
 */
export const SIDEBAR_KINDS: readonly Kind[] = ['folder', 'note'];

/**
 * K-12. The kinds that carry a body, which is every kind but `folder`.
 *
 * A folder is a place rather than a thing and its page already draws what is
 * inside it, so a body there would be a note that is also a list — the one
 * distinction three kinds exist to make. A note had the only body until a check
 * item wanted one; the field, the op and the merge never knew whose it was, so
 * what changed is this predicate and the four places that ask it: the fold
 * (`core/materialise.ts`), the walk to the list above a body (`listAbove` in
 * `core/tree.ts`), the pane derivation (`ui/panes.ts`) and the caret that
 * raises it (`ui/focus.svelte.ts`). requirements.md §4.
 */
export const BODY_KINDS: readonly Kind[] = ['note', 'task'];

export function hasBody(kind: Kind): boolean {
  return BODY_KINDS.includes(kind);
}

/**
 * A-2. Four names rather than a number, because D-4 puts this in front of a
 * person: `high` is legible in a log line where `3` is a guess. `none` is a
 * value rather than an absent field, so clearing a flag can win a race against
 * setting one, exactly like un-ticking a box.
 */
export type Priority = 'none' | 'low' | 'medium' | 'high';

/** Lowest first, which is the order the flag cycles and the menus list. */
export const PRIORITIES: readonly Priority[] = ['none', 'low', 'medium', 'high'];

export interface Node {
  id: NodeId;
  /** Never read directly — resolveTree() is the only legal reader, per T-6. */
  parent: ParentId;
  /** The `at` of the create or move that set `parent`. The T-6 repair reads it. */
  parentSetAt: number;
  /** Tiebreak when two devices' moves carry the same `parentSetAt`. */
  parentSetBy: DeviceId;
  kind: Kind;
  title: string;
  /** Tasks only — K-2. Kept across a "Turn into", so turning back restores it. */
  done: boolean;
  /**
   * The `at` of the write that set `done`, in the way `deletedAt` is the
   * tombstone's — T-12 orders the archive by it. Null whenever `done` is false,
   * so clearing a tick clears the stamp with it and nothing has to reason about
   * a date attached to a row that is back in the tree.
   */
  doneAt: number | null;
  /** Notes only — K-3. */
  body: string | null;
  /** A-1. Normalised, sorted and deduplicated — `core/tags.ts` owns the shape. */
  tags: readonly string[];
  /** A-2. Never absent: an unflagged row carries `none`. */
  priority: Priority;
  /**
   * G-2. The day an agenda item is filed for, as `YYYY-MM-DD` in the writing
   * device's own local time, and null on every row in the tree. Today is every
   * agenda item whose day has come; Tomorrow is every one whose day has not —
   * `core/agenda.ts` is the only module that compares one.
   */
  day: string | null;
  /**
   * R-2. How often a timely item repeats — `<n>d` or `<n>m` — and null on every
   * other row. `core/timely.ts` is the only module that spells the shape, and
   * the period is read from the tick rather than from the day the item was
   * carrying, which is the whole of R-5.
   */
  every: string | null;
  /** Fractional index among siblings — T-2, sync-flow.md §5. */
  order: string;
  /** The device that minted `order`, and the sort tiebreak — sync-flow.md §5.3. */
  orderBy: DeviceId;
  /** T-7. Absence and deletion must stay distinguishable. */
  deleted: boolean;
  deletedAt: number | null;
}

export type NodeMap = Readonly<Record<NodeId, Node>>;

/** Device id to counter — glossary.md's version vector. */
export type SClock = Readonly<Record<DeviceId, number>>;

interface OpBase {
  /** This device's counter for this op. */
  c: number;
  /** Wall clock at the writing device when the op was written. */
  at: number;
  /**
   * The writing device. Implied by the log's header line rather than written on
   * every line — sync-flow.md §4.6 — so the encoder drops it and the decoder
   * puts it back.
   */
  dev: DeviceId;
  /** A receipt for a peer, carried only when that receipt changes. */
  seen?: SClock;
}

export interface CreateOp extends OpBase {
  op: 'create';
  id: NodeId;
  parent: ParentId;
  kind: Kind;
  order: string;
}

/** Only the fields that changed. Disjoint fields never interact when merged. */
export interface SetOp extends OpBase {
  op: 'set';
  id: NodeId;
  title?: string;
  done?: boolean;
  body?: string | null;
  kind?: Kind;
  /** A-3. The whole set, which is what makes it one field — past_decision.md §10. */
  tags?: readonly string[];
  priority?: Priority;
  /**
   * G-2, G-6. Moving an item between the two lists is this field and no other —
   * and R-3's tick is this field as well, carrying the day the item next comes
   * due rather than a tick that would take the row out of the list.
   */
  day?: string | null;
  /** R-2. The repeat period of a timely item. */
  every?: string | null;
}

export interface MoveOp extends OpBase {
  op: 'move';
  id: NodeId;
  parent: ParentId;
  order: string;
}

/** Tombstones the subtree at read time, per T-7 — this op names one node. */
export interface DeleteOp extends OpBase {
  op: 'delete';
  id: NodeId;
}

/**
 * T-13, the mirror of `delete`. It clears the node's *own* tombstone and never
 * an inherited one, so a row under a still-deleted ancestor stays out of the
 * tree — which is also what makes restoring a subtree one op rather than one
 * per node — sync-flow.md §4.9.
 */
export interface RestoreOp extends OpBase {
  op: 'restore';
  id: NodeId;
}

export type Op = CreateOp | SetOp | MoveOp | DeleteOp | RestoreOp;

/**
 * What an edit needs from outside itself. The logic layer has no clock and no
 * randomness of its own, so both arrive here — architecture.md §3.
 *
 * `nextCounter` advances this device's counter, which is state the op log owns;
 * an edit that mints no op must not call it.
 */
export interface EditContext {
  now(): number;
  deviceId: DeviceId;
  mintId(): NodeId;
  nextCounter(): number;
}
