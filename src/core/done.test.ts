import { describe, expect, it } from 'vitest';
import { archivedRows } from './done';
import { foldOps } from './materialise';
import { resolveTree } from './tree';
import { ROOT, type Kind, type Op, type ParentId } from './types';

let counter = 0;

function create(id: string, parent: ParentId, order: string, kind: Kind = 'task'): Op {
  return { op: 'create', id, parent, kind, order, c: ++counter, at: 1, dev: 'aaaa0001' };
}

function title(id: string, text: string): Op {
  return { op: 'set', id, title: text, c: ++counter, at: 2, dev: 'aaaa0001' };
}

function tick(id: string, at: number, done = true): Op {
  return { op: 'set', id, done, c: ++counter, at, dev: 'aaaa0001' };
}

function remove(id: string, at: number): Op {
  return { op: 'delete', id, c: ++counter, at, dev: 'aaaa0001' };
}

function restore(id: string, at: number): Op {
  return { op: 'restore', id, c: ++counter, at, dev: 'aaaa0001' };
}

function treeOf(ops: readonly Op[]) {
  return resolveTree(foldOps(ops));
}

/** A folder holding a folder holding a task, plus a folder of two at the top. */
const shop = [
  create('n_house', ROOT, 'a1', 'folder'),
  title('n_house', 'House'),
  create('n_kitchen', 'n_house', 'a1', 'folder'),
  title('n_kitchen', 'Kitchen'),
  create('n_kettle', 'n_kitchen', 'a1'),
  title('n_kettle', 'Descale the kettle'),
  create('n_shop', ROOT, 'a2', 'folder'),
  title('n_shop', 'Shopping'),
  create('n_milk', 'n_shop', 'a1'),
  title('n_milk', 'Milk'),
  create('n_bread', 'n_shop', 'a2'),
  title('n_bread', 'Bread'),
];

describe('archivedRows — T-12', () => {
  it('holds ticked and deleted rows in one list, newest first', () => {
    // Interleaved on purpose: an order that sorted the two kinds apart would
    // pass a test whose deletes all happened after its ticks.
    const tree = treeOf([
      ...shop,
      tick('n_bread', 800),
      remove('n_milk', 900),
      tick('n_kettle', 950),
    ]);
    expect(archivedRows(tree).map((row) => [row.id, row.at])).toEqual([
      ['n_kettle', 950],
      ['n_milk', 900],
      ['n_bread', 800],
    ]);
  });

  it('carries the path each row sat on', () => {
    const tree = treeOf([...shop, tick('n_kettle', 800), remove('n_shop', 900)]);
    expect(archivedRows(tree)).toEqual([
      { id: 'n_shop', path: [], at: 900 },
      { id: 'n_kettle', path: ['n_house', 'n_kitchen'], at: 800 },
    ]);
  });

  it('dates a row that is both ticked and deleted by its tombstone', () => {
    // The delete is what a restore undoes first, so it is the event the reader
    // is looking the row up by.
    const tree = treeOf([...shop, tick('n_bread', 800), remove('n_bread', 900)]);
    expect(archivedRows(tree).map((row) => [row.id, row.at])).toEqual([['n_bread', 900]]);
  });

  it('names the top of a finished run and not what is under it', () => {
    // Ticking a folder is one thing the user finished, not three.
    const tree = treeOf([...shop, tick('n_shop', 800), tick('n_milk', 900)]);
    expect(archivedRows(tree).map((row) => row.id)).toEqual(['n_shop']);
  });

  it('names the top of a tombstoned subtree and not its descendants — T-7', () => {
    const tree = treeOf([...shop, remove('n_house', 900)]);
    expect(tree.deleted.has('n_kettle')).toBe(true);
    expect(archivedRows(tree).map((row) => row.id)).toEqual(['n_house']);
  });

  it('covers a deleted row under a ticked one, whichever way the ancestor left', () => {
    const tree = treeOf([...shop, tick('n_shop', 800), remove('n_milk', 900)]);
    expect(archivedRows(tree).map((row) => row.id)).toEqual(['n_shop']);
  });

  it('drops a row once it is restored — T-13', () => {
    const tree = treeOf([...shop, remove('n_house', 900), restore('n_house', 950)]);
    expect(archivedRows(tree)).toEqual([]);
    // And what the tombstone covered comes back with it, because T-7 never
    // marked the descendants in the first place.
    expect(tree.deleted.has('n_kettle')).toBe(false);
  });

  it('drops a row once it is un-ticked, and forgets when it was ticked', () => {
    const tree = treeOf([...shop, tick('n_bread', 800), tick('n_bread', 900, false)]);
    expect(archivedRows(tree)).toEqual([]);
    expect(tree.nodes['n_bread']!.doneAt).toBeNull();
  });

  it('sorts an undated row last rather than under today, and is stable', () => {
    // A `doneAt` of null is what a log compacted before the field existed can
    // leave behind; 1970 at the top of the list would be a lie.
    const tree = treeOf([...shop, tick('n_bread', 800), remove('n_milk', 900)]);
    const undated = {
      ...tree,
      nodes: { ...tree.nodes, n_bread: { ...tree.nodes['n_bread']!, doneAt: null } },
    };
    expect(archivedRows(undated).map((row) => row.id)).toEqual(['n_milk', 'n_bread']);
  });

  it('is empty when nothing has left the tree', () => {
    expect(archivedRows(treeOf(shop))).toEqual([]);
  });
});
