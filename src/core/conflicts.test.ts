// The rows requirements.md §9 renders, derived from two devices' files.
//
// merge.test.ts already covers the three that matter most in situ — a raced
// title, a T-6 re-rooting, a tiebroken sibling order. What is here is the rest
// of the rule: which fields raise a row, which writes are not offered back, and
// what a row does when the state under it moves.

import { describe, expect, it } from 'vitest';
import { conflictsOf, describeValue, type FieldConflict } from './conflicts';
import {
  addTag,
  createLastChild,
  moveTo,
  remove,
  restoreValue,
  setBody,
  setPriority,
  setTags,
  setTitle,
  toggleDone,
  turnInto,
} from './edit';
import { Replica, settle } from './test-support';
import { ROOT, type Kind, type NodeId } from './types';

function pair(): { a: Replica; b: Replica } {
  return { a: new Replica('aaaa0001', 1_000), b: new Replica('bbbb0002', 1_000) };
}

function add(replica: Replica, title: string, kind: Kind = 'task'): NodeId {
  return replica.run((tree, ctx) => createLastChild(tree, ctx, ROOT, { title, kind }))[0]!.id;
}

function rowsOf(replica: Replica) {
  return conflictsOf(replica.tree, replica.logs);
}

describe('tags and priority — A-3, past_decision.md §10', () => {
  it('reports a concurrent tag add, and offers the set that lost', () => {
    const { a, b } = pair();
    const milk = add(a, 'Milk');
    b.pull(a);
    a.at(2_000).run((tree, ctx) => addTag(tree, ctx, milk, 'town'));
    b.at(2_001).run((tree, ctx) => addTag(tree, ctx, milk, 'errand'));
    settle([a, b]);

    // One field, one winner: b wrote later, so the row holds b's set and the
    // conflict row offers a's back — which is one click, not a merge rule.
    expect(a.tree.nodes[milk]!.tags).toEqual(['errand']);
    const rows = rowsOf(a).filter((row): row is FieldConflict => row.kind === 'field');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.field).toBe('tags');
    expect(rows[0]!.dropped).toEqual(['town']);
    expect(describeValue('tags', rows[0]!.dropped, a.tree)).toBe('town');

    a.at(3_000).run((tree, ctx) => restoreValue(tree, ctx, milk, 'tags', rows[0]!.dropped));
    settle([a, b]);
    expect(b.tree.nodes[milk]!.tags).toEqual(['town']);
    expect(rowsOf(b)).toEqual([]);
  });

  // Two devices that wrote the same tags in a different order wrote the same
  // value, because `cleanTags` sorts — there is no race to report.
  it('says nothing when both devices ended with the same set', () => {
    const { a, b } = pair();
    const milk = add(a, 'Milk');
    b.pull(a);
    a.at(2_000).run((tree, ctx) => setTags(tree, ctx, milk, ['town', 'errand']));
    b.at(2_001).run((tree, ctx) => setTags(tree, ctx, milk, ['Errand', '#town']));
    settle([a, b]);
    expect(rowsOf(a)).toEqual([]);
  });

  it('reports a concurrent flag, naming both values', () => {
    const { a, b } = pair();
    const milk = add(a, 'Milk');
    b.pull(a);
    a.at(2_000).run((tree, ctx) => setPriority(tree, ctx, milk, 'high'));
    b.at(2_001).run((tree, ctx) => setPriority(tree, ctx, milk, 'low'));
    settle([a, b]);

    const rows = rowsOf(a).filter((row): row is FieldConflict => row.kind === 'field');
    expect(rows).toHaveLength(1);
    expect([rows[0]!.kept, rows[0]!.dropped]).toEqual(['low', 'high']);
  });
});

describe('which fields raise a row', () => {
  it('a tick two devices disagreed about', () => {
    const { a, b } = pair();
    const milk = add(a, 'Milk');
    b.pull(a);
    a.at(2_000).run((tree, ctx) => toggleDone(tree, ctx, milk));
    b.at(2_001).run((tree, ctx) => toggleDone(tree, ctx, milk));
    settle([a, b]);

    // Both ticked it, so nothing was lost and there is nothing to report.
    expect(rowsOf(a)).toEqual([]);
    expect(a.nodes[milk]!.done).toBe(true);

    a.at(3_000).run((tree, ctx) => toggleDone(tree, ctx, milk));
    b.at(3_001).run((tree, ctx) => setTitle(tree, ctx, milk, 'Oat milk'));
    settle([a, b]);
    // Disjoint fields never interact — one un-tick, one rename, no row.
    expect(rowsOf(a)).toEqual([]);
    expect(a.nodes[milk]!.done).toBe(false);
    expect(a.nodes[milk]!.title).toBe('Oat milk');
  });

  it('a "Turn into" each device answered differently — K-5', () => {
    const { a, b } = pair();
    const row = add(a, 'Trip', 'task');
    b.pull(a);
    a.at(2_000).run((tree, ctx) => turnInto(tree, ctx, row, 'note'));
    b.at(2_001).run((tree, ctx) => turnInto(tree, ctx, row, 'list'));
    settle([a, b]);

    const rows = rowsOf(a);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ kind: 'field', field: 'kind', kept: 'list', dropped: 'note' });
  });

  it('a note body, whole — S-20', () => {
    const { a, b } = pair();
    const note = add(a, 'Trip notes', 'note');
    b.pull(a);
    a.at(2_000).run((tree, ctx) => setBody(tree, ctx, note, 'Ferry at 07:40'));
    b.at(2_001).run((tree, ctx) => setBody(tree, ctx, note, 'Ferry at 08:10'));
    settle([a, b]);

    const rows = rowsOf(a) as FieldConflict[];
    expect(rows[0]).toMatchObject({ field: 'body', kept: 'Ferry at 08:10', dropped: 'Ferry at 07:40' });
    // The whole body, not a diff of it: folding diffs is option C, and it waits
    // for compaction — sync-flow.md §4.6.
    expect(describeValue('body', rows[0]!.dropped, a.tree)).toBe('Ferry at 07:40');
  });

  it('a concurrent move, which is the parent field like any other', () => {
    const { a, b } = pair();
    const row = add(a, 'Milk');
    const shopping = add(a, 'Shopping', 'list');
    const house = add(a, 'House', 'folder');
    b.pull(a);
    a.at(2_000).run((tree, ctx) => moveTo(tree, ctx, row, shopping, null));
    b.at(2_001).run((tree, ctx) => moveTo(tree, ctx, row, house, null));
    settle([a, b]);

    const rows = rowsOf(a) as FieldConflict[];
    expect(rows[0]).toMatchObject({ field: 'parent', kept: house, dropped: shopping });
    // Not offered back: putting a row somewhere is a move, and a move needs an
    // order key among siblings the losing device never saw.
    expect(restoreValue(a.tree, a, row, 'parent', shopping)).toEqual([]);
  });
});

describe('what is not offered', () => {
  it('nothing about a row that was deleted — T-7', () => {
    const { a, b } = pair();
    const row = add(a, 'Milk');
    b.pull(a);
    a.at(2_000).run((tree, ctx) => setTitle(tree, ctx, row, 'Oat milk'));
    b.at(2_001).run((tree, ctx) => setTitle(tree, ctx, row, 'Whole milk'));
    settle([a, b]);
    expect(rowsOf(a).length).toBe(1);

    a.at(3_000).run((tree, ctx) => remove(tree, ctx, row));
    settle([a, b]);
    // The question "which title did you want" has no answer worth asking about
    // a row that is gone.
    expect(rowsOf(a)).toEqual([]);
    expect(rowsOf(b)).toEqual([]);
  });

  it('only a device’s last word, not everything it typed', () => {
    const { a, b } = pair();
    const row = add(a, 'Milk');
    b.pull(a);
    for (const title of ['Oat', 'Oat milk']) {
      a.tick(100).run((tree, ctx) => setTitle(tree, ctx, row, title));
    }
    b.at(9_000).run((tree, ctx) => setTitle(tree, ctx, row, 'Whole milk'));
    settle([a, b]);

    const rows = rowsOf(a) as FieldConflict[];
    expect(rows.length).toBe(1);
    expect(rows[0]!.dropped).toBe('Oat milk');
  });
});

describe('taking the dropped value back — C-1', () => {
  it('is an ordinary edit, and it ends the row on every device', () => {
    const { a, b } = pair();
    const row = add(a, 'Milk');
    b.pull(a);
    a.at(2_000).run((tree, ctx) => setTitle(tree, ctx, row, 'Oat milk'));
    b.at(2_001).run((tree, ctx) => setTitle(tree, ctx, row, 'Whole milk'));
    settle([a, b]);

    const conflict = rowsOf(a)[0] as FieldConflict;
    const ops = a.at(3_000).run((tree, ctx) => restoreValue(tree, ctx, row, conflict.field, conflict.dropped));
    expect(ops.length).toBe(1);
    expect(ops[0]).toMatchObject({ op: 'set', id: row, title: 'Oat milk' });

    settle([a, b]);
    expect(b.nodes[row]!.title).toBe('Oat milk');
    expect(rowsOf(a)).toEqual([]);
    expect(rowsOf(b)).toEqual([]);
  });
});
