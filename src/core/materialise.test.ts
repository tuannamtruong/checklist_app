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

  it('stamps a tick with the time it was written, and clears it on the way back', () => {
    // T-12 orders the archive by this, and it is derived here rather than
    // carried on the op, so a row ticked by a build that predates the field
    // dates itself the moment this fold reads it.
    const untick: Op = { op: 'set', id: 'n_1', done: false, c: 3, at: 400, dev: 'bbbb0002' };
    expect(foldOps([create, tick])['n_1']!.doneAt).toBe(250);
    expect(foldOps([create, tick, untick])['n_1']!.doneAt).toBeNull();
    expect(foldOps([create])['n_1']!.doneAt).toBeNull();
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

describe('which kinds arrive with a body — K-12', () => {
  const createOf = (id: string, kind: 'folder' | 'note' | 'task'): Op => ({
    op: 'create',
    id,
    parent: ROOT,
    kind,
    order: 'a1',
    c: 1,
    at: 100,
    dev: 'aaaa0001',
  });

  it('opens a note and a task with an empty one, and a folder with none', () => {
    // Null is not the empty string here: it is what tells "has no body" from
    // "has a body nobody has typed in yet", which is what every drawing of one
    // asks — `hasBody` in `types.ts`.
    expect(foldOps([createOf('n_n', 'note')])['n_n']!.body).toBe('');
    expect(foldOps([createOf('n_t', 'task')])['n_t']!.body).toBe('');
    expect(foldOps([createOf('n_f', 'folder')])['n_f']!.body).toBeNull();
  });

  it('gives a row turned into either kind a body to open on', () => {
    const into = (kind: 'note' | 'task'): Op => ({
      op: 'set',
      id: 'n_f',
      kind,
      c: 2,
      at: 200,
      dev: 'aaaa0001',
    });
    expect(foldOps([createOf('n_f', 'folder'), into('note')])['n_f']!.body).toBe('');
    expect(foldOps([createOf('n_f', 'folder'), into('task')])['n_f']!.body).toBe('');
  });

  it('leaves the text alone when a row moves between the two kinds that have one', () => {
    const typed: Op = { op: 'set', id: 'n_t', body: 'the address', c: 2, at: 200, dev: 'aaaa0001' };
    const intoNote: Op = { op: 'set', id: 'n_t', kind: 'note', c: 3, at: 300, dev: 'aaaa0001' };
    const backToTask: Op = { op: 'set', id: 'n_t', kind: 'task', c: 4, at: 400, dev: 'aaaa0001' };
    const nodes = foldOps([createOf('n_t', 'task'), typed, intoNote, backToTask]);
    expect(nodes['n_t']!.body).toBe('the address');
    expect(nodes['n_t']!.kind).toBe('task');
  });

  it('keeps a body a peer wrote to a folder, because a kind is a field like any other', () => {
    // The `create` says folder and a later `set kind` may say note; a `set body`
    // that arrives between them is applied unconditionally, exactly as every
    // other field is, so no ordering of the two can lose the text.
    const typed: Op = { op: 'set', id: 'n_f', body: 'text', c: 2, at: 200, dev: 'bbbb0002' };
    const intoNote: Op = { op: 'set', id: 'n_f', kind: 'note', c: 3, at: 300, dev: 'aaaa0001' };
    expect(foldOps([createOf('n_f', 'folder'), typed, intoNote])['n_f']!.body).toBe('text');
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
