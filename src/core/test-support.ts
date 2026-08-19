// Fixtures for the core tests. Nothing here is mocked in the sense test.md §1
// forbids: what runs in a test is the shipping code, and this file only supplies
// the collaborators the logic layer refuses to reach for itself — the clock, the
// id and the counter.

import { foldOps } from './materialise';
import { mergeTree, receiptDelta, receiptsOf, type DeviceOps } from './merge';
import { resolveTree, type ResolvedTree } from './tree';
import type { DeviceId, EditContext, NodeMap, Op, SClock } from './types';

/** A clock that ticks only when a test tells it to — test.md §4. */
export class FakeContext implements EditContext {
  deviceId: DeviceId;
  clock: number;
  private counter = 0;
  private minted = 0;

  constructor(deviceId: DeviceId = 'aaaa0001', start = 1_000) {
    this.deviceId = deviceId;
    this.clock = start;
  }

  now(): number {
    return this.clock;
  }

  tick(by = 1): this {
    this.clock += by;
    return this;
  }

  mintId(): string {
    this.minted++;
    return `n_${this.deviceId.slice(0, 4)}${String(this.minted).padStart(4, '0')}`;
  }

  nextCounter(): number {
    return ++this.counter;
  }
}

/** Collects ops the way the store does, so a test can edit and read back. */
export class Session {
  ops: Op[] = [];
  tree: ResolvedTree = resolveTree({});

  apply(ops: readonly Op[]): this {
    this.ops.push(...ops);
    this.tree = resolveTree(foldOps(this.ops));
    return this;
  }
}

export function titlesOf(tree: ResolvedTree, ids: readonly string[]): string[] {
  return ids.map((id) => tree.nodes[id]?.title ?? `?${id}`);
}

/**
 * One device, holding its own log and a copy of every peer's file it has read.
 *
 * It is the shipping objects' shape rather than a model of them: `run` is
 * `Session.run` including the `seen` delta `DeviceLog.append` attaches, `pull`
 * is one `FolderSync` cycle over one file, and the tree is `mergeTree` exactly
 * as the store folds it. That is what lets a scenario here be an argument about
 * the application rather than about a simulator — test.md §1.
 */
export class Replica implements EditContext {
  readonly deviceId: DeviceId;
  clock: number;
  own: Op[] = [];
  private counter = 0;
  private minted = 0;
  private held = new Map<DeviceId, readonly Op[]>();
  private receipts: SClock = {};
  private receipted: SClock = {};

  constructor(deviceId: DeviceId, start = 1_000) {
    this.deviceId = deviceId;
    this.clock = start;
  }

  now(): number {
    return this.clock;
  }

  /** Time is a parameter, never the machine's clock — test.md §4. */
  at(time: number): this {
    this.clock = time;
    return this;
  }

  tick(by = 1): this {
    this.clock += by;
    return this;
  }

  mintId(): string {
    this.minted++;
    return `n_${this.deviceId.slice(0, 4)}${String(this.minted).padStart(3, '0')}`;
  }

  nextCounter(): number {
    return ++this.counter;
  }

  get logs(): DeviceOps[] {
    return [
      { device: this.deviceId, ops: this.own },
      ...[...this.held].map(([device, ops]) => ({ device, ops })),
    ];
  }

  get nodes(): NodeMap {
    return mergeTree(this.logs);
  }

  get tree(): ResolvedTree {
    return resolveTree(this.nodes);
  }

  run(edit: (tree: ResolvedTree, ctx: EditContext) => Op[]): Op[] {
    const ops = edit(this.tree, this);
    if (ops.length === 0) return ops;
    const delta = receiptDelta(this.receipted, this.receipts);
    const carried =
      Object.keys(delta).length === 0 ? ops : [{ ...ops[0]!, seen: delta }, ...ops.slice(1)];
    this.receipted = this.receipts;
    this.own.push(...carried);
    return carried;
  }

  /** Reads one peer's file, which is all a cycle ever does to state. */
  pull(peer: Replica): this {
    this.held.set(peer.deviceId, [...peer.own]);
    this.receipts = receiptsOf([...this.held].map(([device, ops]) => ({ device, ops })));
    return this;
  }
}

/** Every device reads every other, twice, so nothing is left mid-delivery. */
export function settle(replicas: readonly Replica[]): void {
  for (const round of [0, 1]) {
    void round;
    for (const replica of replicas) {
      for (const peer of replicas) if (peer !== replica) replica.pull(peer);
    }
  }
}

/** Deterministic, and seeded from the environment so a failure reproduces — test.md §3.1. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
