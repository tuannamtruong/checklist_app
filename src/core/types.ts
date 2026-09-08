// The vocabulary of the tree: what a node is, what an op is, and the context an
// edit needs. Everything here is data — requirements.md §2 Data model is the
// authority, and a field that is not in that table does not belong in this file.

/** Eight hex characters, minted on a device's first run — glossary.md. */
export type DeviceId = string;

export type NodeId = string;

/** The one parent that is not a node. Nothing carries a node with this id. */
export const ROOT = 'root';

export type ParentId = NodeId | typeof ROOT;

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
