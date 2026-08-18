// The vocabulary of the tree: what a node is, what an op is, and the context an
// edit needs. Everything here is data — requirements.md §2 Data model is the
// authority, and a field that is not in that table does not belong in this file.

/** Eight hex characters, minted on a device's first run — glossary.md. */
export type DeviceId = string;

export type NodeId = string;

/** The one parent that is not a node. Nothing carries a node with this id. */
export const ROOT = 'root';

export type ParentId = NodeId | typeof ROOT;

/** K-1. Kind drives rendering, never structure: any kind may own children. */
export type Kind = 'folder' | 'list' | 'note' | 'task';

export const KINDS: readonly Kind[] = ['folder', 'list', 'note', 'task'];

/** T-10. The sidebar shows these; tasks would drown it. */
export const CONTAINER_KINDS: readonly Kind[] = ['folder', 'list', 'note'];

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
  /** Notes only — K-3. */
  body: string | null;
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

export type Op = CreateOp | SetOp | MoveOp | DeleteOp;

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
