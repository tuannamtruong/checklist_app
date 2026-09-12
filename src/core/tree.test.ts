import { describe, expect, it } from 'vitest';
import { foldOps } from './materialise';
import {
  ancestorsOf,
  childrenOf,
  isAncestorOrSelf,
  listAbove,
  parentOf,
  resolveTree,
  rootOf,
  sidebarChildren,
  siblingAt,
} from './tree';
import { AGENDA, ROOT, type Kind, type Op, type ParentId } from './types';

let counter = 0;

function create(id: string, parent: ParentId, order: string, dev = 'aaaa0001', at = 1): Op {
  return { op: 'create', id, parent, kind: 'task', order, c: ++counter, at, dev };
}

function createOf(id: string, parent: ParentId, order: string, kind: Kind): Op {
  return { op: 'create', id, parent, kind, order, c: ++counter, at: 1, dev: 'aaaa0001' };
}

function move(id: string, parent: ParentId, order: string, dev: string, at: number): Op {
  return { op: 'move', id, parent, order, c: ++counter, at, dev };
}

function remove(id: string, dev = 'aaaa0001', at = 900): Op {
  return { op: 'delete', id, c: ++counter, at, dev };
}

function tick(id: string, done = true, dev = 'aaaa0001', at = 800): Op {
  return { op: 'set', id, done, c: ++counter, at, dev };
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

describe('resolveTree — T-11 finished rows', () => {
  const list = [
    create('n_a', ROOT, 'a1'),
    create('n_b', ROOT, 'a2'),
    create('n_c', ROOT, 'a3'),
  ];

  it('takes a ticked row out of its parent, and puts it back when unticked', () => {
    const done = treeOf([...list, tick('n_b')]);
    expect(childrenOf(done, ROOT)).toEqual(['n_a', 'n_c']);
    expect(done.nodes['n_b']).toBeDefined();
    expect(childrenOf(treeOf([...list, tick('n_b'), tick('n_b', false)]), ROOT)).toEqual([
      'n_a',
      'n_b',
      'n_c',
    ]);
  });

  it('does not inherit, so a finished row still shows what is inside it', () => {
    // Unlike T-7. A finished list opened from the Done view has to have
    // something in it, or the view would be a page of empty titles.
    const tree = treeOf([...list, create('n_b1', 'n_b', 'a1'), tick('n_b')]);
    expect(childrenOf(tree, ROOT)).toEqual(['n_a', 'n_c']);
    expect(childrenOf(tree, 'n_b')).toEqual(['n_b1']);
  });

  it('leaves the siblings the caret and every edit can see', () => {
    // The point of filtering in resolveTree rather than in the view: siblingAt
    // is what `↑`/`↓` and Alt-↑/Alt-↓ both walk.
    const tree = treeOf([...list, tick('n_b')]);
    expect(siblingAt(tree, 'n_a', 1)).toBe('n_c');
    expect(siblingAt(tree, 'n_c', -1)).toBe('n_a');
  });

  it('is beaten by a tombstone — a deleted row is deleted, ticked or not', () => {
    const tree = treeOf([...list, tick('n_b'), remove('n_b')]);
    expect(tree.deleted.has('n_b')).toBe(true);
    expect(childrenOf(tree, ROOT)).toEqual(['n_a', 'n_c']);
  });
});

describe('listAbove — X-21', () => {
  // A folder, a note in it, a note in that note, and a task under the inner
  // note: the shape the pane's own list (K-4) makes reachable in two clicks.
  const nested = [
    createOf('n_f', ROOT, 'a1', 'folder'),
    createOf('n_note', 'n_f', 'a1', 'note'),
    createOf('n_sub', 'n_note', 'a1', 'note'),
    createOf('n_task', 'n_sub', 'a1', 'task'),
    // K-12: a note filed under that check item. A task has a body now, so the
    // walk climbs past it exactly as it climbs past a note.
    createOf('n_detail', 'n_task', 'a1', 'note'),
  ];

  it('is the parent when the parent has no body of its own', () => {
    expect(listAbove(treeOf(nested), 'n_note')).toBe('n_f');
  });

  it('walks past every note above it, however deep the chain', () => {
    // The whole of X-21: opening n_sub from n_note's pane leaves the left
    // column on n_f, which is where the reader put it.
    const tree = treeOf(nested);
    expect(listAbove(tree, 'n_sub')).toBe('n_f');
    // Two notes deep is still n_f: the walk stops at a kind, not at a count.
    expect(listAbove(tree, 'n_task')).toBe('n_f');
    // And past the task itself, which since K-12 is a row with a body rather
    // than a list — n_detail's pane opens beside n_f like every other.
    expect(listAbove(tree, 'n_detail')).toBe('n_f');
  });

  it('is the root when there is no list above at all', () => {
    const tree = treeOf([createOf('n_a', ROOT, 'a1', 'note'), createOf('n_b', 'n_a', 'a1', 'note')]);
    expect(listAbove(tree, 'n_b')).toBe(ROOT);
  });

  it("reads T-6's repaired parent rather than the one in the file", () => {
    // A re-rooted note hangs where it is drawn, so the pane beside it is the
    // list it is drawn in — anything else would put a page on the left that the
    // tree on the left does not contain.
    const tree = treeOf([createOf('n_x', 'n_missing', 'a1', 'note')]);
    expect(listAbove(tree, 'n_x')).toBe(ROOT);
  });
});

describe('sidebarChildren — T-10', () => {
  // One of each kind under the root and under a folder, which is the whole
  // question the sidebar asks twice: once at the top level, once one step down.
  const ops = [
    createOf('n_f', ROOT, 'a1', 'folder'),
    createOf('n_note', ROOT, 'a2', 'note'),
    createOf('n_task', ROOT, 'a3', 'task'),
    createOf('n_f_sub', 'n_f', 'a1', 'folder'),
    createOf('n_f_note', 'n_f', 'a2', 'note'),
    createOf('n_f_task', 'n_f', 'a3', 'task'),
  ];

  it('is the folders and the notes, in sibling order, and never a task', () => {
    expect(sidebarChildren(treeOf(ops), ROOT)).toEqual(['n_f', 'n_note']);
  });

  it('asks the same question one level down, which is where the second level comes from', () => {
    expect(sidebarChildren(treeOf(ops), 'n_f')).toEqual(['n_f_sub', 'n_f_note']);
  });

  it('is empty for a row whose children are all tasks, so no disclosure is drawn', () => {
    const tree = treeOf([createOf('n_a', ROOT, 'a1', 'folder'), createOf('n_a1', 'n_a', 'a1', 'task')]);
    expect(sidebarChildren(tree, 'n_a')).toEqual([]);
  });

  it('loses a ticked or deleted row when the page does — T-11, T-7', () => {
    const tree = treeOf([
      createOf('n_a', ROOT, 'a1', 'folder'),
      createOf('n_done', 'n_a', 'a1', 'folder'),
      createOf('n_gone', 'n_a', 'a2', 'note'),
      createOf('n_kept', 'n_a', 'a3', 'note'),
      tick('n_done'),
      remove('n_gone'),
    ]);
    expect(sidebarChildren(tree, 'n_a')).toEqual(['n_kept']);
  });
});

describe('the second root — G-1', () => {
  const ops = [
    createOf('n_f', ROOT, 'a1', 'folder'),
    createOf('n_a', AGENDA, 'a1', 'task'),
    createOf('n_a_kid', 'n_a', 'a1', 'task'),
  ];

  it('buckets agenda items under `agenda` and never under the tree', () => {
    const tree = treeOf(ops);
    expect(childrenOf(tree, ROOT)).toEqual(['n_f']);
    expect(childrenOf(tree, AGENDA)).toEqual(['n_a']);
  });

  it('is not a parent that failed to arrive: nothing is re-rooted', () => {
    // The repair that shows a half-synced row would otherwise fire on every
    // agenda item, and every one of them would appear in `All`.
    const tree = treeOf(ops);
    expect(tree.repairs).toEqual([]);
    expect(parentOf(tree, 'n_a')).toBe(AGENDA);
  });

  it('ends an ancestor walk, so a breadcrumb stops where the list starts', () => {
    const tree = treeOf(ops);
    expect(ancestorsOf(tree, 'n_a')).toEqual([]);
    expect(ancestorsOf(tree, 'n_a_kid')).toEqual(['n_a']);
  });

  it('is what rootOf answers, through the repair', () => {
    const tree = treeOf(ops);
    expect(rootOf(tree, 'n_a_kid')).toBe(AGENDA);
    expect(rootOf(tree, 'n_f')).toBe(ROOT);
  });

  it('inherits a tombstone down its own chain — T-7', () => {
    const tree = treeOf([...ops, remove('n_a')]);
    expect(tree.deleted.has('n_a_kid')).toBe(true);
    expect(childrenOf(tree, AGENDA)).toEqual([]);
  });
});
