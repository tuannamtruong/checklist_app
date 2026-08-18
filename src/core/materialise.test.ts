import { describe, expect, it } from 'vitest';
import { applyOp, compareOps, foldOps } from './materialise';
import { ROOT, type Op } from './types';

const create: Op = { op: 'create', id: 'n_1', parent: ROOT, kind: 'task', order: 'a1', c: 1, at: 100, dev: 'aaaa0001' };
const rename: Op = { op: 'set', id: 'n_1', title: 'first', c: 2, at: 200, dev: 'aaaa0001' };
const renameLater: Op = { op: 'set', id: 'n_1', title: 'second', c: 1, at: 300, dev: 'bbbb0002' };
const tick: Op = { op: 'set', id: 'n_1', done: true, c: 2, at: 250, dev: 'bbbb0002' };

describe('foldOps', () => {
  it('materialises a node from its create', () => {
    const nodes = foldOps([create]);
    expect(nodes['n_1']).toMatchObject({
      id: 'n_1',
      parent: ROOT,
      parentSetAt: 100,
      parentSetBy: 'aaaa0001',
      kind: 'task',
      title: '',
      order: 'a1',
      orderBy: 'aaaa0001',
      deleted: false,
    });
  });

  it('reaches one state whatever order the ops arrive in', () => {
    const ops = [create, rename, renameLater, tick];
    const forwards = foldOps(ops);
    const backwards = foldOps([...ops].reverse());
    const shuffled = foldOps([tick, create, renameLater, rename]);
    expect(backwards).toEqual(forwards);
    expect(shuffled).toEqual(forwards);
  });

  it('gives the field to the newest write, and leaves disjoint fields alone', () => {
    const nodes = foldOps([create, rename, renameLater, tick]);
    expect(nodes['n_1']!.title).toBe('second');
    expect(nodes['n_1']!.done).toBe(true);
  });

  it('is idempotent — folding a log twice changes nothing', () => {
    const ops = [create, rename, tick];
    expect(foldOps([...ops, ...ops])).toEqual(foldOps(ops));
  });

  it('drops an op whose node has not arrived, and applies it once it has', () => {
    expect(foldOps([rename])).toEqual({});
    expect(foldOps([rename, create])['n_1']!.title).toBe('first');
  });

  it('stamps parentSetBy from the device that wrote the move — T-6 needs it', () => {
    const moved: Op = { op: 'move', id: 'n_1', parent: ROOT, order: 'a5', c: 3, at: 400, dev: 'bbbb0002' };
    const nodes = foldOps([create, moved]);
    expect(nodes['n_1']).toMatchObject({ parentSetAt: 400, parentSetBy: 'bbbb0002', orderBy: 'bbbb0002' });
  });
});

describe('compareOps', () => {
  it('orders by time, then device, then counter', () => {
    expect(compareOps(create, rename)).toBeLessThan(0);
    const sameTime: Op = { ...rename, dev: 'zzzz9999' };
    expect(compareOps(rename, sameTime)).toBeLessThan(0);
    expect(compareOps(rename, { ...rename, c: 9 })).toBeLessThan(0);
  });
});

describe('applyOp', () => {
  it('leaves the map it was given untouched', () => {
    const before = foldOps([create]);
    const after = applyOp(before, rename);
    expect(before['n_1']!.title).toBe('');
    expect(after['n_1']!.title).toBe('first');
  });
});
