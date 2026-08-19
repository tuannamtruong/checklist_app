// The scenario layer and the merge-property layer — test.md §3.1 and §3.2.
//
// Every case here is two or more devices holding files, not op literals handed
// to a function: `Replica` runs the shipping edits through the shipping fold, so
// a failure is a statement about the application.

import { describe, expect, it } from 'vitest';
import { conflictsOf } from './conflicts';
import { createLastChild, moveTo, remove, setTitle } from './edit';
import { foldOps } from './materialise';
import { allOps } from './merge';
import { Replica, random, settle } from './test-support';
import { childrenOf } from './tree';
import { ROOT, type Kind, type NodeId, type NodeMap, type Op, type ParentId } from './types';

function add(replica: Replica, parent: ParentId, title: string, kind: Kind = 'task'): NodeId {
  return replica.run((tree, ctx) => createLastChild(tree, ctx, parent, { title, kind }))[0]!.id;
}

function titleOf(replica: Replica, id: NodeId): string | undefined {
  return replica.tree.nodes[id]?.title;
}

function conflictsFor(replica: Replica) {
  return conflictsOf(replica.tree, replica.logs);
}

/** Two devices that have already agreed on a starting tree. */
function pair(): { a: Replica; b: Replica } {
  const a = new Replica('aaaa0001', 1_000);
  const b = new Replica('bbbb0002', 1_000);
  return { a, b };
}

describe('concurrent edits to different subtrees', () => {
  it('merge with nothing to tell the user about', () => {
    const { a, b } = pair();
    const shopping = add(a, ROOT, 'Shopping', 'list');
    const house = add(a, ROOT, 'House', 'folder');
    b.pull(a);

    a.at(2_000).run((tree, ctx) => setTitle(tree, ctx, shopping, 'Groceries'));
    b.at(2_001).run((tree, ctx) => setTitle(tree, ctx, house, 'Home'));
    settle([a, b]);

    expect(titleOf(a, shopping)).toBe('Groceries');
    expect(titleOf(a, house)).toBe('Home');
    expect(a.nodes).toEqual(b.nodes);
    expect(conflictsFor(a)).toEqual([]);
  });
});

describe('concurrent edits to one node', () => {
  const { a, b } = pair();
  const milk = add(a, ROOT, 'Milk');
  b.pull(a);
  a.at(2_000).run((tree, ctx) => setTitle(tree, ctx, milk, 'Oat milk'));
  b.at(2_001).run((tree, ctx) => setTitle(tree, ctx, milk, 'Whole milk'));
  settle([a, b]);

  it('resolves by (at, device id), newest wins', () => {
    expect(titleOf(a, milk)).toBe('Whole milk');
    expect(a.nodes).toEqual(b.nodes);
  });

  it('raises one row, scoped to that node, on both devices', () => {
    const conflicts = conflictsFor(a);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]).toMatchObject({
      kind: 'field',
      node: milk,
      field: 'title',
      kept: 'Whole milk',
      keptBy: 'bbbb0002',
      dropped: 'Oat milk',
      droppedBy: 'aaaa0001',
    });
    // Derived from the files, so both devices derive it identically — C-6.
    expect(conflictsFor(b)).toEqual(conflicts);
  });

  it('stops deriving once one device writes the field having read both', () => {
    a.at(3_000).run((tree, ctx) => setTitle(tree, ctx, milk, 'Oat milk'));
    settle([a, b]);
    expect(titleOf(b, milk)).toBe('Oat milk');
    expect(conflictsFor(a)).toEqual([]);
    expect(conflictsFor(b)).toEqual([]);
  });
});

describe('concurrent move A→B and B→A — T-6', () => {
  const { a, b } = pair();
  const x = add(a, ROOT, 'X', 'folder');
  const y = add(a, ROOT, 'Y', 'folder');
  b.pull(a);

  // Both moves are legal where they are written: X and Y are siblings, so
  // neither device's T-5 check can see the other's — sync-flow.md §6.1.
  a.at(3_000).run((tree, ctx) => moveTo(tree, ctx, x, y, null));
  b.at(2_000).run((tree, ctx) => moveTo(tree, ctx, y, x, null));
  const writtenByA = a.own.length;
  settle([a, b]);

  it('drops the edge with the oldest (parentSetAt, device id)', () => {
    expect(a.tree.repairs).toEqual([{ id: y, from: x, reason: 'cycle' }]);
    expect(childrenOf(a.tree, ROOT)).toEqual([y]);
    expect(childrenOf(a.tree, y)).toEqual([x]);
  });

  it('and every device drops the same one', () => {
    expect(b.tree.repairs).toEqual(a.tree.repairs);
    expect(a.nodes).toEqual(b.nodes);
  });

  it('without writing anything to do it', () => {
    expect(a.own.length).toBe(writtenByA);
    expect(a.nodes[y]!.parent).toBe(x);
  });

  it('names the re-rooted node — C-2', () => {
    expect(conflictsFor(a)).toEqual([{ kind: 'cycle', id: `cycle:${y}:${x}`, node: y, from: x, at: 2_000 }]);
  });

  it('and an ordinary move afterwards breaks the cycle for everyone', () => {
    a.at(4_000).run((tree, ctx) => moveTo(tree, ctx, y, ROOT, null));
    settle([a, b]);
    expect(a.tree.repairs).toEqual([]);
    expect(b.tree.repairs).toEqual([]);
    expect(conflictsFor(b)).toEqual([]);
  });
});

describe('deleting a subtree that contains a cycle — T-6 with T-7', () => {
  it('terminates, and takes the whole subtree', () => {
    const { a, b } = pair();
    const x = add(a, ROOT, 'X', 'folder');
    const y = add(a, ROOT, 'Y', 'folder');
    b.pull(a);
    a.at(3_000).run((tree, ctx) => moveTo(tree, ctx, x, y, null));
    b.at(2_000).run((tree, ctx) => moveTo(tree, ctx, y, x, null));
    settle([a, b]);

    // The tombstone walk climbs the *resolved* parent. Climbing the stored one
    // would not terminate here, which is the whole reason it does not.
    a.at(5_000).run((tree, ctx) => remove(tree, ctx, y));
    settle([a, b]);
    expect([...a.tree.deleted].sort()).toEqual([x, y].sort());
    expect(b.tree.deleted).toEqual(a.tree.deleted);
    expect(childrenOf(a.tree, ROOT)).toEqual([]);
  });
});

describe('a delete racing an edit inside the subtree — T-7', () => {
  it('lets the tombstone win over the whole subtree', () => {
    const { a, b } = pair();
    const trip = add(a, ROOT, 'Trip', 'list');
    const ferry = add(a, trip, 'Ferry');
    b.pull(a);

    a.at(5_000).run((tree, ctx) => remove(tree, ctx, trip));
    b.at(5_001).run((tree, ctx) => setTitle(tree, ctx, ferry, 'Ferry tickets'));
    settle([a, b]);

    expect(a.tree.deleted.has(ferry)).toBe(true);
    expect(a.nodes).toEqual(b.nodes);
    // The later title did land, and the row is still gone. A conflict row about
    // a tombstoned node would be a question with no answer.
    expect(a.nodes[ferry]!.title).toBe('Ferry tickets');
    expect(conflictsFor(a)).toEqual([]);
  });
});

describe('a third device joining mid-sequence — S-9', () => {
  it('converges from an empty vector, with no registration step', () => {
    const { a, b } = pair();
    const list = add(a, ROOT, 'Shopping', 'list');
    add(a, list, 'Milk');
    b.pull(a);
    b.at(2_000);
    add(b, list, 'Bread');

    const c = new Replica('cccc0003', 3_000);
    c.pull(a).pull(b);
    add(c, list, 'Coffee');
    settle([a, b, c]);

    expect(a.nodes).toEqual(c.nodes);
    expect(b.nodes).toEqual(c.nodes);
    expect(childrenOf(c.tree, list).length).toBe(3);
    expect(conflictsFor(c)).toEqual([]);
  });
});

describe('a device offline across many peer edits', () => {
  it('fast-forwards without a spurious race', () => {
    const { a, b } = pair();
    const milk = add(a, ROOT, 'Milk');
    b.pull(a);
    b.at(2_000).run((tree, ctx) => setTitle(tree, ctx, milk, 'Oat milk'));
    a.pull(b);

    // Ten writes to the field b last touched. Every one of them carries a
    // receipt for b, so none of them is concurrent with b's — S-5.
    for (let i = 0; i < 10; i++) {
      a.at(3_000 + i).run((tree, ctx) => setTitle(tree, ctx, milk, `Milk ${i}`));
    }
    b.pull(a);

    expect(titleOf(b, milk)).toBe('Milk 9');
    expect(a.nodes).toEqual(b.nodes);
    expect(conflictsFor(b)).toEqual([]);
  });
});

describe('sibling ordering under concurrent insertion — T-2', () => {
  const { a, b } = pair();
  const list = add(a, ROOT, 'Shopping', 'list');
  b.pull(a);
  const milk = a.at(6_000).run((tree, ctx) => createLastChild(tree, ctx, list, { title: 'Milk' }))[0]!.id;
  const bread = b.at(6_000).run((tree, ctx) => createLastChild(tree, ctx, list, { title: 'Bread' }))[0]!.id;
  settle([a, b]);

  it('mints the same key on both, because both saw the same siblings', () => {
    expect(a.nodes[milk]!.order).toBe(a.nodes[bread]!.order);
  });

  it('and every device derives one order from it — §5.3', () => {
    expect(childrenOf(a.tree, list)).toEqual([milk, bread]);
    expect(childrenOf(b.tree, list)).toEqual([milk, bread]);
  });

  it('and says so, because the order is nobody’s choice — C-3', () => {
    expect(conflictsFor(a)).toEqual([
      { kind: 'order', id: `order:${milk}:${bread}`, node: milk, other: bread, parent: list, at: 6_000 },
    ]);
  });
});

// --- the properties ---------------------------------------------------------
//
// S-4 over a generated op set. The fold sorts before it applies, so the three
// laws are all statements about one thing: the result depends on the *set* of
// ops and never on how they arrived. That is worth asserting precisely because
// it is easy to lose — an incremental merge that laid new ops on top of the tree
// would pass none of these.

const SEED = Number(process.env['SEED'] ?? 20_260_819);

/** Four devices editing and delivering at random, and everything they wrote. */
function generate(seed: number, steps: number): { replicas: Replica[]; ops: Op[] } {
  const dice = random(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(dice() * items.length)]!;
  const replicas = ['aaaa0001', 'bbbb0002', 'cccc0003', 'dddd0004'].map(
    (id, index) => new Replica(id, 1_000 + index),
  );
  const known: NodeId[] = [];
  let now = 1_000;

  for (let step = 0; step < steps; step++) {
    const replica = pick(replicas);
    // A jittered shared clock, so ties between devices happen often enough to
    // exercise the device-id tiebreak rather than never.
    now += Math.floor(dice() * 3);
    replica.at(now);
    const roll = dice();

    if (roll < 0.3 || known.length === 0) {
      const parent = known.length > 0 && dice() < 0.5 ? pick(known) : ROOT;
      known.push(add(replica, parent, `row ${step}`, pick(['task', 'list', 'note', 'folder'])));
    } else if (roll < 0.55) {
      const id = pick(known);
      replica.run((tree, ctx) => setTitle(tree, ctx, id, `title ${step}`));
    } else if (roll < 0.7) {
      const id = pick(known);
      const parent = dice() < 0.5 ? ROOT : pick(known);
      replica.run((tree, ctx) => moveTo(tree, ctx, id, parent, null));
    } else if (roll < 0.78) {
      const id = pick(known);
      replica.run((tree, ctx) => remove(tree, ctx, id));
    } else {
      const peer = pick(replicas);
      if (peer !== replica) replica.pull(peer);
    }
  }

  settle(replicas);
  return { replicas, ops: allOps(replicas[0]!.logs) };
}

function shuffled(ops: readonly Op[], dice: () => number): Op[] {
  const out = [...ops];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(dice() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe(`merge properties — S-4, seed ${SEED}`, () => {
  const { replicas, ops } = generate(SEED, 400);
  const once: NodeMap = foldOps(ops);

  it('generated something worth folding', () => {
    expect(ops.length).toBeGreaterThan(200);
    expect(Object.keys(once).length).toBeGreaterThan(20);
  });

  it('is commutative: the order ops arrive in changes nothing', () => {
    const dice = random(SEED + 1);
    for (let run = 0; run < 5; run++) {
      expect(foldOps(shuffled(ops, dice))).toEqual(once);
    }
  });

  it('is associative: how they are grouped changes nothing', () => {
    const cut = Math.floor(ops.length / 3);
    const [first, second, third] = [ops.slice(0, cut), ops.slice(cut, cut * 2), ops.slice(cut * 2)];
    expect(foldOps([...third, ...first, ...second])).toEqual(once);
    expect(foldOps([...second, ...third, ...first])).toEqual(once);
  });

  it('is idempotent: delivering the same file twice changes nothing', () => {
    expect(foldOps([...ops, ...ops])).toEqual(once);
  });

  it('leaves four devices holding one tree — S-17', () => {
    // The equality below is only worth asserting if the run actually raced, and
    // a generator that quietly stopped producing races would still pass it.
    expect(conflictsOf(replicas[0]!.tree, replicas[0]!.logs).length).toBeGreaterThan(0);
    for (const replica of replicas.slice(1)) {
      expect(replica.nodes).toEqual(replicas[0]!.nodes);
      expect(conflictsOf(replica.tree, replica.logs)).toEqual(
        conflictsOf(replicas[0]!.tree, replicas[0]!.logs),
      );
    }
  });
});
