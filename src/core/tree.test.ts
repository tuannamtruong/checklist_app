import { describe, expect, it } from 'vitest';
import { foldOps } from './materialise';
import {
  ancestorsOf,
  childrenOf,
  isAncestorOrSelf,
  parentOf,
  resolveTree,
  siblingAt,
} from './tree';
import { ROOT, type Op, type ParentId } from './types';

let counter = 0;

function create(id: string, parent: ParentId, order: string, dev = 'aaaa0001', at = 1): Op {
  return { op: 'create', id, parent, kind: 'task', order, c: ++counter, at, dev };
}

function move(id: string, parent: ParentId, order: string, dev: string, at: number): Op {
  return { op: 'move', id, parent, order, c: ++counter, at, dev };
}

function remove(id: string, dev = 'aaaa0001', at = 900): Op {
  return { op: 'delete', id, c: ++counter, at, dev };
}

function treeOf(ops: readonly Op[]) {
  return resolveTree(foldOps(ops));
}

describe('resolveTree — ordinary trees', () => {
  const ops = [
    create('n_a', ROOT, 'a1'),
    create('n_b', ROOT, 'a2'),
    create('n_a1', 'n_a', 'a1'),
    create('n_a2', 'n_a', 'a2'),
  ];

  it('buckets children under their parent, in sibling order', () => {
    const tree = treeOf(ops);
    expect(childrenOf(tree, ROOT)).toEqual(['n_a', 'n_b']);
    expect(childrenOf(tree, 'n_a')).toEqual(['n_a1', 'n_a2']);
    expect(tree.repairs).toEqual([]);
  });

  it('walks up for breadcrumbs, root first — T-9', () => {
    const deep = treeOf([...ops, create('n_a1x', 'n_a1', 'a1')]);
    expect(ancestorsOf(deep, 'n_a1x')).toEqual(['n_a', 'n_a1']);
    expect(ancestorsOf(deep, 'n_a')).toEqual([]);
  });

  it('answers T-5 without walking off the end', () => {
    const tree = treeOf(ops);
    expect(isAncestorOrSelf(tree, 'n_a', 'n_a1')).toBe(true);
    expect(isAncestorOrSelf(tree, 'n_a', 'n_a')).toBe(true);
    expect(isAncestorOrSelf(tree, 'n_a', 'n_b')).toBe(false);
    expect(isAncestorOrSelf(tree, 'n_a', ROOT)).toBe(false);
  });

  it('finds the sibling above and below', () => {
    const tree = treeOf(ops);
    expect(siblingAt(tree, 'n_b', -1)).toBe('n_a');
    expect(siblingAt(tree, 'n_a', -1)).toBeUndefined();
    expect(siblingAt(tree, 'n_a', 1)).toBe('n_b');
  });
});

describe('resolveTree — T-6 cycle repair', () => {
  // Two devices, each move legal against what it could see: sync-flow.md §6.
  const cycle = [
    create('n_a', ROOT, 'a1'),
    create('n_b', ROOT, 'a2'),
    move('n_a', 'n_b', 'a1', 'aaaa0001', 100),
    move('n_b', 'n_a', 'a1', 'bbbb0002', 200),
  ];

  it('drops the edge whose parent was set longest ago', () => {
    const tree = treeOf(cycle);
    expect(parentOf(tree, 'n_a')).toBe(ROOT);
    expect(parentOf(tree, 'n_b')).toBe('n_a');
    expect(tree.repairs).toEqual([{ id: 'n_a', from: 'n_b', reason: 'cycle' }]);
  });

  it('reads the same on every device, whatever order the files arrived in', () => {
    const forwards = treeOf(cycle);
    const backwards = treeOf([...cycle].reverse());
    expect(parentOf(backwards, 'n_a')).toBe(parentOf(forwards, 'n_a'));
    expect(parentOf(backwards, 'n_b')).toBe(parentOf(forwards, 'n_b'));
    expect(backwards.repairs).toEqual(forwards.repairs);
  });

  it('breaks an identical timestamp on device id', () => {
    const tied = [
      create('n_a', ROOT, 'a1'),
      create('n_b', ROOT, 'a2'),
      move('n_a', 'n_b', 'a1', 'cccc0003', 100),
      move('n_b', 'n_a', 'a1', 'bbbb0002', 100),
    ];
    const tree = treeOf(tied);
    expect(parentOf(tree, 'n_b')).toBe(ROOT);
    expect(parentOf(tree, 'n_a')).toBe('n_b');
  });

  it('repairs a three-node cycle, and never writes to do it', () => {
    const three = [
      create('n_a', ROOT, 'a1'),
      create('n_b', ROOT, 'a2'),
      create('n_c', ROOT, 'a3'),
      move('n_a', 'n_b', 'a1', 'aaaa0001', 300),
      move('n_b', 'n_c', 'a1', 'bbbb0002', 200),
      move('n_c', 'n_a', 'a1', 'cccc0003', 100),
    ];
    const nodes = foldOps(three);
    const tree = resolveTree(nodes);
    expect(parentOf(tree, 'n_c')).toBe(ROOT);
    expect(childrenOf(tree, ROOT)).toEqual(['n_c']);
    // The repair is read-time only: the node map still says what the folder says.
    expect(nodes['n_c']!.parent).toBe('n_a');
  });

  it('re-roots a node whose parent has not arrived yet', () => {
    const tree = treeOf([create('n_x', 'n_missing', 'a1')]);
    expect(parentOf(tree, 'n_x')).toBe(ROOT);
    expect(tree.repairs).toEqual([{ id: 'n_x', from: 'n_missing', reason: 'missing-parent' }]);
  });

  it('lets an ordinary move break the cycle permanently', () => {
    // The user drags the re-rooted node back; nothing else has to be undone,
    // and n_a keeps the parent its own move gave it — sync-flow.md §6.2.
    const healed = treeOf([...cycle, move('n_b', ROOT, 'a2', 'aaaa0001', 300)]);
    expect(healed.repairs).toEqual([]);
    expect(childrenOf(healed, ROOT)).toEqual(['n_b']);
    expect(childrenOf(healed, 'n_b')).toEqual(['n_a']);
  });
});

describe('resolveTree — T-7 tombstones', () => {
  it('tombstones the whole subtree, not just the node', () => {
    const tree = treeOf([
      create('n_a', ROOT, 'a1'),
      create('n_a1', 'n_a', 'a1'),
      create('n_a1x', 'n_a1', 'a1'),
      create('n_b', ROOT, 'a2'),
      remove('n_a'),
    ]);
    expect([...tree.deleted].sort()).toEqual(['n_a', 'n_a1', 'n_a1x']);
    expect(childrenOf(tree, ROOT)).toEqual(['n_b']);
  });

  it('keeps deletion distinguishable from absence', () => {
    const tree = treeOf([create('n_a', ROOT, 'a1'), remove('n_a')]);
    expect(tree.nodes['n_a']).toBeDefined();
    expect(tree.nodes['n_a']!.deleted).toBe(true);
    expect(tree.nodes['n_a']!.deletedAt).toBe(900);
  });

  it('terminates when the subtree contains a cycle', () => {
    const tree = treeOf([
      create('n_a', ROOT, 'a1'),
      create('n_b', ROOT, 'a2'),
      create('n_c', 'n_b', 'a1'),
      move('n_a', 'n_b', 'a1', 'aaaa0001', 100),
      move('n_b', 'n_a', 'a1', 'bbbb0002', 200),
      remove('n_a'),
    ]);
    expect([...tree.deleted].sort()).toEqual(['n_a', 'n_b', 'n_c']);
    expect(childrenOf(tree, ROOT)).toEqual([]);
  });
});
