import { describe, expect, it } from 'vitest';
import { deletedRows, finishedChildCount, finishedRows } from './done';
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

function tick(id: string, done = true): Op {
  return { op: 'set', id, done, c: ++counter, at: 800, dev: 'aaaa0001' };
}

function remove(id: string, at: number): Op {
  return { op: 'delete', id, c: ++counter, at, dev: 'aaaa0001' };
}

function treeOf(ops: readonly Op[]) {
  return resolveTree(foldOps(ops));
}

/** A folder holding a list holding three tasks, plus one task at the top. */
const shop = [
  create('n_house', ROOT, 'a1', 'folder'),
  title('n_house', 'House'),
  create('n_kitchen', 'n_house', 'a1', 'list'),
  title('n_kitchen', 'Kitchen'),
  create('n_kettle', 'n_kitchen', 'a1'),
  title('n_kettle', 'Descale the kettle'),
  create('n_shop', ROOT, 'a2', 'list'),
  title('n_shop', 'Shopping'),
  create('n_milk', 'n_shop', 'a1'),
  title('n_milk', 'Milk'),
  create('n_bread', 'n_shop', 'a2'),
  title('n_bread', 'Bread'),
];

describe('finishedRows — T-12', () => {
  it('lists ticked rows in tree order, with the path each sat on', () => {
    const tree = treeOf([...shop, tick('n_bread'), tick('n_kettle')]);
    expect(finishedRows(tree)).toEqual([
      { id: 'n_kettle', path: ['n_house', 'n_kitchen'] },
      { id: 'n_bread', path: ['n_shop'] },
    ]);
  });

  it('names the top of a finished run and not what is under it', () => {
    // Ticking a list is one thing the user finished, not four.
    const tree = treeOf([...shop, tick('n_shop'), tick('n_milk')]);
    expect(finishedRows(tree).map((row) => row.id)).toEqual(['n_shop']);
  });

  it('hands a tombstoned row to the deleted list instead, tick or no tick', () => {
    const tree = treeOf([...shop, tick('n_bread'), remove('n_bread', 900)]);
    expect(finishedRows(tree)).toEqual([]);
    expect(deletedRows(tree).map((row) => row.id)).toEqual(['n_bread']);
  });

  it('is empty when nothing is ticked', () => {
    expect(finishedRows(treeOf(shop))).toEqual([]);
  });
});

describe('deletedRows — T-12', () => {
  it('lists tombstones newest first, with the path each sat on', () => {
    const tree = treeOf([...shop, remove('n_milk', 900), remove('n_kitchen', 950)]);
    expect(deletedRows(tree)).toEqual([
      { id: 'n_kitchen', path: ['n_house'] },
      { id: 'n_milk', path: ['n_shop'] },
    ]);
  });

  it('names the top of a tombstoned subtree and not its descendants — T-7', () => {
    const tree = treeOf([...shop, remove('n_house', 900)]);
    expect(tree.deleted.has('n_kettle')).toBe(true);
    expect(deletedRows(tree).map((row) => row.id)).toEqual(['n_house']);
  });

  it('gives a row deleted at the root an empty path', () => {
    const tree = treeOf([...shop, remove('n_shop', 900)]);
    expect(deletedRows(tree)).toEqual([{ id: 'n_shop', path: [] }]);
  });
});

describe('finishedChildCount — T-11', () => {
  it('counts only this parent’s own finished rows', () => {
    const tree = treeOf([...shop, tick('n_milk'), tick('n_bread'), tick('n_kettle')]);
    expect(finishedChildCount(tree, 'n_shop')).toBe(2);
    expect(finishedChildCount(tree, 'n_kitchen')).toBe(1);
    expect(finishedChildCount(tree, ROOT)).toBe(0);
  });

  it('does not count a finished row that was then deleted', () => {
    const tree = treeOf([...shop, tick('n_milk'), remove('n_milk', 900)]);
    expect(finishedChildCount(tree, 'n_shop')).toBe(0);
  });
});
