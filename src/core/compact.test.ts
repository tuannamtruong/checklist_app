// S-14 — sync-flow.md §4.8, and test.md §3.1 says why this belongs beside the
// merge laws rather than with the scenarios: it is the same kind of claim.
//
// The claim is stronger than "the tree still looks right". The fold of a
// compacted op set must be *identical* to the fold of the original, for any
// subset of devices compacted, under any delivery order — which is what makes
// compaction safe without anybody agreeing to it.

import { describe, expect, it } from 'vitest';
import { compactOps, compactionDue, treeBytes } from './compact';
import { createLastChild, moveTo, remove, restore, setBody, setTitle, toggleDone } from './edit';
import { foldOps } from './materialise';
import { allOps, opVectors, type DeviceOps } from './merge';
import { Replica, random, settle } from './test-support';
import { ROOT, type Kind, type NodeId, type Op, type ParentId } from './types';

const SEED = Number(process.env['SEED'] ?? 20_260_819);

function add(replica: Replica, parent: ParentId, title: string, kind: Kind = 'task'): NodeId {
  return replica.run((tree, ctx) => createLastChild(tree, ctx, parent, { title, kind }))[0]!.id;
}

/**
 * Four devices, every op kind, and enough repeated writes to one field that
 * there is something to cut. A generator that only ever wrote each field once
 * would pass every assertion here while proving nothing.
 */
function generate(seed: number, steps: number): Replica[] {
  const dice = random(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(dice() * items.length)]!;
  const replicas = ['aaaa0001', 'bbbb0002', 'cccc0003', 'dddd0004'].map(
    (id, index) => new Replica(id, 1_000 + index),
  );
  const known: NodeId[] = [];
  let now = 1_000;

  for (let step = 0; step < steps; step++) {
    const replica = pick(replicas);
    now += Math.floor(dice() * 3);
    replica.at(now);
    const roll = dice();

    if (roll < 0.2 || known.length === 0) {
      const parent = known.length > 0 && dice() < 0.5 ? pick(known) : ROOT;
      known.push(add(replica, parent, `row ${step}`, pick(['task', 'list', 'note', 'folder'])));
    } else if (roll < 0.45) {
      const id = pick(known);
      replica.run((tree, ctx) => setTitle(tree, ctx, id, `title ${step}`));
    } else if (roll < 0.58) {
      const id = pick(known);
      replica.run((tree, ctx) => setBody(tree, ctx, id, `body ${step} `.repeat(8)));
    } else if (roll < 0.66) {
      const id = pick(known);
      replica.run((tree, ctx) => toggleDone(tree, ctx, id));
    } else if (roll < 0.76) {
      const id = pick(known);
      const parent = dice() < 0.5 ? ROOT : pick(known);
      replica.run((tree, ctx) => moveTo(tree, ctx, id, parent, null));
    } else if (roll < 0.82) {
      replica.run((tree, ctx) => remove(tree, ctx, pick(known)));
    } else if (roll < 0.88) {
      // T-13, and the reason `deleted` is a contested field at all.
      replica.run((tree, ctx) => restore(tree, ctx, pick(known)));
    } else {
      const peer = pick(replicas);
      if (peer !== replica) replica.pull(peer);
    }
  }

  settle(replicas);
  return replicas;
}

/** Every device's own ops, as the folder holds them before anything is cut. */
function logsOf(replicas: readonly Replica[]): DeviceOps[] {
  return replicas.map((replica) => ({ device: replica.deviceId, ops: [...replica.own] }));
}

function compacted(logs: readonly DeviceOps[], which: (index: number) => boolean): DeviceOps[] {
  return logs.map((log, index) =>
    which(index) ? { device: log.device, ops: compactOps(log.ops) } : log,
  );
}

describe(`compaction — S-14, seed ${SEED}`, () => {
  const replicas = generate(SEED, 500);
  const logs = logsOf(replicas);
  const before = foldOps(allOps(logs));

  it('generated a log with something to cut in it', () => {
    expect(allOps(logs).length).toBeGreaterThan(200);
    expect(Object.keys(before).length).toBeGreaterThan(20);
    const cut = compacted(logs, () => true);
    expect(allOps(cut).length).toBeLessThan(allOps(logs).length);
  });

  it('leaves the fold identical when every device compacts', () => {
    expect(foldOps(allOps(compacted(logs, () => true)))).toEqual(before);
  });

  it('leaves the fold identical when only some devices compact', () => {
    // The case that matters in the field: devices compact when their own
    // trigger fires, so a folder is normally a mix of cut and uncut files.
    for (const target of [0, 1, 2, 3]) {
      expect(foldOps(allOps(compacted(logs, (index) => index === target)))).toEqual(before);
    }
    expect(foldOps(allOps(compacted(logs, (index) => index % 2 === 0)))).toEqual(before);
  });

  it('is idempotent: compacting a compacted log changes nothing', () => {
    for (const log of logs) {
      const once = compactOps(log.ops);
      expect(compactOps(once)).toEqual(once);
    }
  });

  it('keeps the highest counter, so no peer reads the file as a stale one', () => {
    // sync-flow.md §4.8.2. Lowering it would make FolderSync skip the file
    // forever, and the device would silently stop syncing.
    for (const log of logs) {
      const top = (ops: readonly Op[]): number => Math.max(...ops.map((op) => op.c));
      expect(top(compactOps(log.ops))).toBe(top(log.ops));
    }
  });

  it('keeps every surviving op’s vector exactly as it was', () => {
    // The receipts of a dropped op are merged onto the op that survives it, or
    // this device would read as further behind than it is and raise a race
    // that never happened — sync-flow.md §4.8.2.
    const was = opVectors(logs);
    const byCounter = new Map<string, Op>();
    for (const log of logs) for (const op of log.ops) byCounter.set(`${log.device}:${op.c}`, op);

    for (const log of compacted(logs, () => true)) {
      const now = opVectors([log]);
      for (const [op, vector] of now) {
        const original = byCounter.get(`${log.device}:${op.c}`)!;
        expect(vector, `${log.device} c=${op.c}`).toEqual(was.get(original));
      }
    }
  });

  it('never drops a create, because a create is a node’s existence', () => {
    for (const log of logs) {
      const creates = (ops: readonly Op[]): number => ops.filter((op) => op.op === 'create').length;
      expect(creates(compactOps(log.ops))).toBe(creates(log.ops));
    }
  });
});

describe('what the cut keeps', () => {
  const dev = 'aaaa0001';
  const base = (c: number, at: number): { c: number; at: number; dev: string } => ({ c, at, dev });

  it('keeps only the last write to a field, and every field of one node', () => {
    const ops: Op[] = [
      { op: 'create', id: 'n_1', parent: ROOT, kind: 'task', order: 'a', ...base(1, 1_000) },
      { op: 'set', id: 'n_1', title: 'first', ...base(2, 1_001) },
      { op: 'set', id: 'n_1', title: 'second', ...base(3, 1_002) },
      { op: 'set', id: 'n_1', done: true, ...base(4, 1_003) },
      { op: 'set', id: 'n_1', title: 'third', ...base(5, 1_004) },
    ];
    const cut = compactOps(ops);
    expect(cut.map((op) => op.op)).toEqual(['create', 'set', 'set']);
    expect(foldOps(cut)).toEqual(foldOps(ops));
    // `done` is a different field, so the write to it survives the two titles
    // written either side of it.
    expect(cut.some((op) => op.op === 'set' && op.done === true)).toBe(true);
  });

  it('trims a multi-field set to the fields it still owns', () => {
    const ops: Op[] = [
      { op: 'create', id: 'n_1', parent: ROOT, kind: 'task', order: 'a', ...base(1, 1_000) },
      { op: 'set', id: 'n_1', title: 'early', body: 'kept', ...base(2, 1_001) },
      { op: 'set', id: 'n_1', title: 'late', ...base(3, 1_002) },
    ];
    const cut = compactOps(ops);
    expect(cut.length).toBe(3);
    expect(cut[1]).toMatchObject({ body: 'kept' });
    expect(cut[1]).not.toHaveProperty('title');
    expect(foldOps(cut)).toEqual(foldOps(ops));
  });

  it('treats delete and restore as two writers of one field — T-13', () => {
    const ops: Op[] = [
      { op: 'create', id: 'n_1', parent: ROOT, kind: 'task', order: 'a', ...base(1, 1_000) },
      { op: 'delete', id: 'n_1', ...base(2, 1_001) },
      { op: 'restore', id: 'n_1', ...base(3, 1_002) },
      { op: 'delete', id: 'n_1', ...base(4, 1_003) },
    ];
    const cut = compactOps(ops);
    expect(cut.map((op) => op.op)).toEqual(['create', 'delete']);
    expect(foldOps(cut)).toEqual(foldOps(ops));
  });

  it('reads “last” in the fold’s order, not the counter’s', () => {
    // A clock stepping backwards makes c=3 older than c=2. Dropping by counter
    // would keep the wrong title; the highest-counter rule keeps c=3 anyway,
    // so what this asserts is that the *value* survives.
    const ops: Op[] = [
      { op: 'create', id: 'n_1', parent: ROOT, kind: 'task', order: 'a', ...base(1, 1_000) },
      { op: 'set', id: 'n_1', title: 'wall clock later', ...base(2, 2_000) },
      { op: 'set', id: 'n_1', title: 'written later', ...base(3, 1_500) },
    ];
    const cut = compactOps(ops);
    expect(foldOps(cut)['n_1']!.title).toBe('wall clock later');
    expect(foldOps(cut)).toEqual(foldOps(ops));
    expect(Math.max(...cut.map((op) => op.c))).toBe(3);
  });

  it('has nothing to say about an empty log', () => {
    expect(compactOps([])).toEqual([]);
  });
});

describe('the trigger — sync-flow.md §4.8.3', () => {
  const nodes = foldOps([
    { op: 'create', id: 'n_1', parent: ROOT, kind: 'task', order: 'a', c: 1, at: 1, dev: 'a' },
  ]);

  it('fires when the folder’s logs cost more than one tree per device', () => {
    const tree = treeBytes(nodes);
    expect(compactionDue(tree * 2 + 1, 2, nodes)).toBe(true);
    expect(compactionDue(tree * 2, 2, nodes)).toBe(false);
  });

  it('does not fire before there is a device to fire for', () => {
    expect(compactionDue(1_000_000, 0, nodes)).toBe(false);
  });
});
