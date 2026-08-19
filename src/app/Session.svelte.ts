// The Materialised State Store — past_decision.md §3.
//
// One object holds the tree and publishes changes; the views re-render the
// subtree that changed. The tree is materialised once at load and kept, never
// replayed per read — sync-flow.md §4 forbids the projection-per-read design,
// and that is a rule about this file.
//
// It is also the only place the logic layer's three injected collaborators are
// supplied: the clock, the id and the counter. Everything below it is pure.

import { conflictsOf, type Conflict } from '../core/conflicts';
import { applyOp, foldOps } from '../core/materialise';
import { mergeTree, receiptsOf, type DeviceOps } from '../core/merge';
import { resolveTree, type ResolvedTree } from '../core/tree';
import type { FolderAdapter } from '../core/folder';
import type { DeviceId, EditContext, NodeId, NodeMap, Op } from '../core/types';
import { DeviceLog } from './device-log';
import { FolderSync, type SyncResult } from './folder-sync';
import { mintNodeId } from './device';

/** An edit, as edit.ts writes them: tree and context in, ops out. */
export type Edit = (tree: ResolvedTree, ctx: EditContext) => Op[];

export class Session {
  readonly deviceId: DeviceId;
  private readonly log: DeviceLog;
  private readonly folderSync: FolderSync;
  private nodeMap = $state<NodeMap>({});
  /** The body each staged node last had *in the log* — see stageBody. */
  private stagedBodies = new Map<NodeId, string | null>();
  /** Bumped whenever the op set changes, so what derives from ops can re-derive. */
  private revision = $state(0);

  /** The last storage failure, for the shell to show rather than swallow. */
  problem = $state<string | null>(null);
  /**
   * Called whenever something reaches the log. It is the sync cadence's
   * activity signal (S-19), and it lives here rather than on every caller
   * because "an edit happened" is exactly what this object already knows.
   */
  onWrote: (() => void) | null = null;
  /** Peer files seen in the last cycle, for the shell to say what sync means here. */
  peers = $state(0);
  syncing = $state(false);

  readonly tree: ResolvedTree = $derived(resolveTree(this.nodeMap));

  /**
   * C-6: derived from merged state, never stored. Reading the whole history to
   * do it is affordable because it happens when the ops change rather than when
   * the view renders — the revision is what `$derived` watches.
   */
  readonly conflicts: readonly Conflict[] = $derived.by(() => {
    void this.revision;
    return conflictsOf(this.tree, this.logs);
  });

  private constructor(log: DeviceLog, folderSync: FolderSync, ops: readonly Op[]) {
    this.log = log;
    this.folderSync = folderSync;
    this.deviceId = log.device;
    this.nodeMap = foldOps(ops);
  }

  static async open(folder: FolderAdapter, device: DeviceId): Promise<Session> {
    let session: Session | undefined;
    const problem = (error: unknown) => {
      console.error(`device ${device}: op log`, error);
      if (session) session.problem = String(error);
    };
    const { log, ops } = await DeviceLog.open(folder, device, {
      onError: problem,
      onSkipped: (count) => {
        console.warn(`device ${device}: skipped ${count} unreadable op line(s)`);
      },
    });
    const folderSync = new FolderSync(folder, device, {
      onError: problem,
      onSkipped: (name, lines) => {
        console.warn(`device ${device}: ${name}: skipped ${lines} unreadable op line(s)`);
      },
    });
    session = new Session(log, folderSync, ops);
    return session;
  }

  get nodes(): NodeMap {
    return this.nodeMap;
  }

  /** This device's file and every peer's, which is what the fold takes. */
  private get logs(): DeviceOps[] {
    return [{ device: this.deviceId, ops: this.log.ops }, ...this.folderSync.logs];
  }

  private get ctx(): EditContext {
    return {
      now: () => Date.now(),
      deviceId: this.deviceId,
      mintId: mintNodeId,
      nextCounter: () => this.log.nextCounter(),
    };
  }

  /**
   * Runs an edit from `core/edit.ts` and keeps both the tree and the log in step.
   * An edit that returns no ops changes neither, which is what makes S-10 a
   * property of the model rather than of every caller.
   */
  run(edit: Edit): Op[] {
    const ops = edit(this.tree, this.ctx);
    if (ops.length === 0) return ops;
    let next = this.nodeMap;
    for (const op of ops) next = applyOp(next, op);
    this.nodeMap = next;
    this.log.append(ops);
    this.revision++;
    this.onWrote?.();
    return ops;
  }

  /**
   * One pass over the folder — sync-flow.md §4.7. Nothing here is on the render
   * path: `SyncCadence` decides when, and the result is a new tree or nothing.
   */
  async cycle(): Promise<SyncResult> {
    this.syncing = true;
    let result: SyncResult;
    try {
      result = await this.folderSync.cycle();
    } finally {
      this.syncing = false;
    }
    this.peers = result.peers;
    if (result.changed) {
      this.log.noteReceipts(receiptsOf(this.folderSync.logs));
      this.adopt(mergeTree(this.logs));
      this.revision++;
    }
    return result;
  }

  /**
   * A re-fold throws away everything not in the log, and a note body being typed
   * is exactly that until S-20 emits it. Putting the draft back is not a merge
   * decision: the value on screen belongs to the person at the keyboard, and it
   * becomes an op the moment they leave the field.
   */
  private adopt(merged: NodeMap): void {
    let next = merged;
    for (const id of this.stagedBodies.keys()) {
      const draft = this.nodeMap[id]?.body;
      if (draft === undefined || next[id] === undefined) continue;
      next = applyOp(next, { op: 'set', id, body: draft, c: 0, at: Date.now(), dev: this.deviceId });
    }
    this.nodeMap = next;
  }

  /**
   * K-7: a note body's 1 s debounce governs the store, and only the store.
   * The op waits for blur, for navigation, or for 60 s of continuous editing —
   * S-20, because whole-body ops are what actually grow the log.
   *
   * The op applied here carries counter 0 and never reaches the file. Taking a
   * counter for a write that may never happen would leave a hole in the vector.
   */
  stageBody(id: NodeId, body: string): void {
    const node = this.nodeMap[id];
    if (!node || node.body === body) return;
    if (!this.stagedBodies.has(id)) this.stagedBodies.set(id, node.body);
    this.nodeMap = applyOp(this.nodeMap, {
      op: 'set',
      id,
      body,
      c: 0,
      at: Date.now(),
      dev: this.deviceId,
    });
  }

  /** Emits the staged body as one op. Nothing is written if it came back unchanged. */
  commitBody(id: NodeId): void {
    if (!this.stagedBodies.has(id)) return;
    const written = this.stagedBodies.get(id) ?? null;
    this.stagedBodies.delete(id);
    const node = this.nodeMap[id];
    if (!node || node.body === written) return;
    this.log.append([
      {
        op: 'set',
        id,
        body: node.body,
        c: this.log.nextCounter(),
        at: Date.now(),
        dev: this.deviceId,
      },
    ]);
    this.revision++;
    this.onWrote?.();
  }

  commitAllBodies(): void {
    for (const id of [...this.stagedBodies.keys()]) this.commitBody(id);
  }

  /** Everything staged or debounced, on disk. Called on the way out of the page. */
  async flush(): Promise<void> {
    this.commitAllBodies();
    await this.log.flush();
  }
}
