// The Materialised State Store — past_decision.md §3.
//
// One object holds the tree and publishes changes; the views re-render the
// subtree that changed. The tree is materialised once at load and kept, never
// replayed per read — sync-flow.md §4 forbids the projection-per-read design,
// and that is a rule about this file.
//
// It is also the only place the logic layer's three injected collaborators are
// supplied: the clock, the id and the counter. Everything below it is pure.

import { applyOp, foldOps } from '../core/materialise';
import { resolveTree, type ResolvedTree } from '../core/tree';
import type { FolderAdapter } from '../core/folder';
import type { DeviceId, EditContext, NodeId, NodeMap, Op } from '../core/types';
import { DeviceLog } from './device-log';
import { mintNodeId } from './device';

/** An edit, as edit.ts writes them: tree and context in, ops out. */
export type Edit = (tree: ResolvedTree, ctx: EditContext) => Op[];

export class Session {
  readonly deviceId: DeviceId;
  private readonly log: DeviceLog;
  private nodeMap = $state<NodeMap>({});
  /** The body each staged node last had *in the log* — see stageBody. */
  private stagedBodies = new Map<NodeId, string | null>();

  /** The last storage failure, for the shell to show rather than swallow. */
  problem = $state<string | null>(null);

  readonly tree: ResolvedTree = $derived(resolveTree(this.nodeMap));

  private constructor(log: DeviceLog, ops: readonly Op[]) {
    this.log = log;
    this.deviceId = log.device;
    this.nodeMap = foldOps(ops);
  }

  static async open(folder: FolderAdapter, device: DeviceId): Promise<Session> {
    let session: Session | undefined;
    const { log, ops } = await DeviceLog.open(folder, device, {
      onError: (error) => {
        console.error(`device ${device}: op log`, error);
        if (session) session.problem = String(error);
      },
      onSkipped: (count) => {
        console.warn(`device ${device}: skipped ${count} unreadable op line(s)`);
      },
    });
    session = new Session(log, ops);
    return session;
  }

  get nodes(): NodeMap {
    return this.nodeMap;
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
    return ops;
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
