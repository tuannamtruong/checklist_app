import { describe, expect, it } from 'vitest';
import { logEntries } from './log-view';
import { foldOps } from './materialise';
import { ROOT, type Kind, type Op, type ParentId } from './types';

let counter = 0;

function create(id: string, parent: ParentId, order: string, kind: Kind = 'task'): Op {
  return { op: 'create', id, parent, kind, order, c: ++counter, at: 1_000, dev: 'aaaa0001' };
}

function title(id: string, text: string): Op {
  return { op: 'set', id, title: text, c: ++counter, at: 1_100, dev: 'aaaa0001' };
}

/** A list holding two tasks, which is enough tree for a move to mean something. */
const shop: Op[] = [
  create('n_shop', ROOT, 'a1', 'list'),
  title('n_shop', 'Shopping'),
  create('n_milk', 'n_shop', 'a1'),
  title('n_milk', 'Milk'),
  create('n_bread', 'n_shop', 'a2'),
  title('n_bread', 'Bread'),
];

function entriesOf(ops: readonly Op[], limit?: number) {
  return logEntries(ops, foldOps(ops), limit);
}

describe('logEntries — D-4', () => {
  it('reads newest first, which is the opposite of every other list', () => {
    const rows = entriesOf(shop);
    expect(rows).toHaveLength(shop.length);
    expect(rows[0]!.id).toBe('n_bread');
    expect(rows[0]!.detail).toBe('title “Bread”');
    expect(rows.at(-1)!.detail).toBe('new list in All lists');
  });

  it('carries the counter and the clock of the op itself', () => {
    const rows = entriesOf([create('n_a', ROOT, 'a1')]);
    expect(rows[0]).toMatchObject({ c: rows[0]!.c, at: 1_000, op: 'create', id: 'n_a' });
  });

  it('names the row by the title the merged tree has now, not the one the op set', () => {
    const rows = entriesOf([...shop, title('n_milk', 'Oat milk')]);
    // The op that set “Milk” names the row “Oat milk”, because that is what the
    // user is looking at while reading the log.
    expect(rows.filter((row) => row.id === 'n_milk').every((row) => row.title === 'Oat milk')).toBe(
      true,
    );
  });

  it('tells a reorder from a move, by what this device last put the row under', () => {
    const rows = entriesOf([
      ...shop,
      { op: 'move', id: 'n_milk', parent: 'n_shop', order: 'a3', c: ++counter, at: 1_200, dev: 'aaaa0001' },
      { op: 'move', id: 'n_milk', parent: ROOT, order: 'a4', c: ++counter, at: 1_300, dev: 'aaaa0001' },
    ]);
    expect(rows[0]!.detail).toBe('moved into All lists');
    expect(rows[1]!.detail).toBe('reordered in “Shopping”');
  });

  it('reads a move of a row it never saw created as a move', () => {
    const peerCreated = foldOps(shop);
    const rows = logEntries(
      [{ op: 'move', id: 'n_milk', parent: ROOT, order: 'b1', c: 1, at: 1_400, dev: 'bbbb0002' }],
      peerCreated,
    );
    expect(rows[0]!.detail).toBe('moved into All lists');
  });

  it('lists every field one set carried', () => {
    const rows = entriesOf([
      ...shop,
      { op: 'set', id: 'n_milk', done: true, kind: 'note', c: ++counter, at: 1_500, dev: 'aaaa0001' },
    ]);
    expect(rows[0]!.detail).toBe('ticked, turned into a note');
  });

  it('measures a note body rather than quoting it, and says when one is cleared', () => {
    const rows = entriesOf([
      ...shop,
      { op: 'set', id: 'n_milk', body: 'x'.repeat(240), c: ++counter, at: 1_600, dev: 'aaaa0001' },
      { op: 'set', id: 'n_milk', body: null, c: ++counter, at: 1_700, dev: 'aaaa0001' },
    ]);
    expect(rows[0]!.detail).toBe('body cleared');
    expect(rows[1]!.detail).toBe('body, 240 characters');
  });

  it('truncates a long title rather than letting one row own the page', () => {
    const rows = entriesOf([...shop, title('n_milk', 'M'.repeat(200))]);
    expect(rows[0]!.detail.length).toBeLessThan(80);
    expect(rows[0]!.detail).toContain('…');
  });

  it('says a row is gone when the fold no longer holds it', () => {
    const rows = logEntries([title('n_ghost', 'Vanished')], {});
    expect(rows[0]).toMatchObject({ gone: true, title: '' });
  });

  it('reports the receipts an op carried, since that is its place in the vector', () => {
    const rows = entriesOf([
      { ...create('n_a', ROOT, 'a1'), seen: { bbbb0002: 4, cccc0003: 1 } },
    ]);
    expect(rows[0]!.seen).toEqual(['bbbb0002', 'cccc0003']);
    expect(entriesOf([create('n_b', ROOT, 'a2')])[0]!.seen).toEqual([]);
  });

  it('caps the rows built but still walks every op, so the cap cannot change a detail', () => {
    const ops: Op[] = [
      ...shop,
      { op: 'move', id: 'n_milk', parent: 'n_shop', order: 'a9', c: ++counter, at: 1_800, dev: 'aaaa0001' },
    ];
    const capped = entriesOf(ops, 1);
    expect(capped).toHaveLength(1);
    expect(capped[0]!.detail).toBe('reordered in “Shopping”');
  });

  it('holds nothing for a log with no ops in it', () => {
    expect(logEntries([], {})).toEqual([]);
  });
});
