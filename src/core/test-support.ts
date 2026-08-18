// Fixtures for the core tests. Nothing here is mocked in the sense test.md §1
// forbids: what runs in a test is the shipping code, and this file only supplies
// the collaborators the logic layer refuses to reach for itself — the clock, the
// id and the counter.

import { foldOps } from './materialise';
import { resolveTree, type ResolvedTree } from './tree';
import type { DeviceId, EditContext, Op } from './types';

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
