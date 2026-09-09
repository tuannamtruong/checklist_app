import { describe, expect, it } from 'vitest';
import { createLastChild, setEvery, tickTimely } from './edit';
import { archivedRows } from './done';
import {
  cleanPeriod,
  dueLabel,
  formatPeriod,
  isDue,
  isPeriod,
  nextDue,
  parsePeriod,
  periodLabel,
  periodOf,
  shortPeriodLabel,
  timelyRows,
} from './timely';
import { FakeContext, Session } from './test-support';
import { TIMELY } from './types';

/** 2026-09-08, 10:00 local — the day these tests are written against. */
const NOON = new Date(2026, 8, 8, 10, 0, 0).getTime();

/** One repeating check item, and the id it was minted with. */
function chore(session: Session, ctx: FakeContext, title: string, every: string): string {
  const ops = createLastChild(session.tree, ctx.tick(), TIMELY, { title, every });
  session.apply(ops);
  return ops[0]!.id;
}

describe('the period — R-2', () => {
  it('round-trips a count and a unit', () => {
    expect(parsePeriod('5d')).toEqual({ count: 5, unit: 'd' });
    expect(parsePeriod('2m')).toEqual({ count: 2, unit: 'm' });
    expect(formatPeriod({ count: 12, unit: 'd' })).toBe('12d');
  });

  it('refuses anything that is not one, so the decoder can use the same check', () => {
    for (const bad of ['', '0d', 'd', '5', '5w', '1000d', ' 5d', '5D', null, 7]) {
      expect(parsePeriod(bad as string)).toBeNull();
      expect(isPeriod(bad)).toBe(false);
    }
    expect(isPeriod('999m')).toBe(true);
  });

  it('reads a row carrying no period as daily rather than as broken', () => {
    const session = new Session();
    const ctx = new FakeContext();
    const id = chore(session, ctx, 'Plants', '3d');
    session.apply(setEvery(session.tree, ctx.tick(), id, null));
    expect(session.tree.nodes[id]!.every).toBeNull();
    expect(periodOf(session.tree.nodes[id]!)).toEqual({ count: 1, unit: 'd' });
  });

  it('puts a typed count in range on the way to the op', () => {
    expect(cleanPeriod(0, 'd')).toBe('1d');
    expect(cleanPeriod(5.7, 'd')).toBe('5d');
    expect(cleanPeriod(4000, 'm')).toBe('999m');
  });

  it('names itself in words and in the width a row has', () => {
    expect(periodLabel({ count: 1, unit: 'd' })).toBe('every day');
    expect(periodLabel({ count: 5, unit: 'd' })).toBe('every 5 days');
    expect(periodLabel({ count: 1, unit: 'm' })).toBe('every month');
    expect(shortPeriodLabel({ count: 2, unit: 'm' })).toBe('2mo');
  });
});

describe('the next due day — R-5', () => {
  it('counts days from the moment of the tick', () => {
    expect(nextDue(NOON, { count: 1, unit: 'd' })).toBe('2026-09-09');
    expect(nextDue(NOON, { count: 5, unit: 'd' })).toBe('2026-09-13');
  });

  it('counts months by the calendar rather than by thirty days', () => {
    expect(nextDue(new Date(2026, 0, 15, 9).getTime(), { count: 1, unit: 'm' })).toBe('2026-02-15');
    expect(nextDue(new Date(2026, 0, 15, 9).getTime(), { count: 3, unit: 'm' })).toBe('2026-04-15');
  });

  it('clamps a day of the month the target month does not have', () => {
    expect(nextDue(new Date(2026, 0, 31, 9).getTime(), { count: 1, unit: 'm' })).toBe('2026-02-28');
    expect(nextDue(new Date(2028, 0, 31, 9).getTime(), { count: 1, unit: 'm' })).toBe('2028-02-29');
    expect(nextDue(new Date(2026, 2, 31, 9).getTime(), { count: 1, unit: 'm' })).toBe('2026-04-30');
  });

  it('crosses a year end', () => {
    expect(nextDue(new Date(2026, 11, 20, 9).getTime(), { count: 1, unit: 'm' })).toBe('2027-01-20');
    expect(nextDue(new Date(2026, 11, 28, 9).getTime(), { count: 7, unit: 'd' })).toBe('2027-01-04');
  });
});

describe('due and waiting — R-3, R-4', () => {
  it('is due when the day has come and waiting when it has not', () => {
    const session = new Session();
    const ctx = new FakeContext();
    const id = chore(session, ctx, 'Plants', '1d');
    // A row that has never been ticked carries no day at all, and is due.
    expect(session.tree.nodes[id]!.day).toBeNull();
    expect(isDue(session.tree.nodes[id]!, NOON)).toBe(true);

    session.apply(tickTimely(session.tree, ctx.at(NOON), id));
    expect(session.tree.nodes[id]!.day).toBe('2026-09-09');
    expect(isDue(session.tree.nodes[id]!, NOON)).toBe(false);
    // R-4. The next day, with nothing written in between.
    const before = session.ops.length;
    expect(isDue(session.tree.nodes[id]!, NOON + 24 * 60 * 60 * 1000)).toBe(true);
    expect(session.ops.length).toBe(before);
  });

  it('says how long until it comes back', () => {
    const session = new Session();
    const ctx = new FakeContext();
    const daily = chore(session, ctx, 'Plants', '1d');
    const weekly = chore(session, ctx, 'Sheets', '7d');
    session.apply(tickTimely(session.tree, ctx.at(NOON), daily));
    session.apply(tickTimely(session.tree, ctx.at(NOON), weekly));
    expect(dueLabel(session.tree.nodes[daily]!, NOON)).toBe('due tomorrow');
    expect(dueLabel(session.tree.nodes[weekly]!, NOON)).toBe('due in 7 days');
    expect(dueLabel(session.tree.nodes[weekly]!, NOON + 7 * 24 * 60 * 60 * 1000)).toBe('due today');
  });

  it('never reaches the Done view, however often it is ticked — R-3', () => {
    const session = new Session();
    const ctx = new FakeContext();
    const id = chore(session, ctx, 'Plants', '1d');
    session.apply(tickTimely(session.tree, ctx.at(NOON), id));
    expect(session.tree.nodes[id]!.done).toBe(false);
    expect(archivedRows(session.tree)).toEqual([]);
    // And it is still in the list, which is what T-11 would have taken it out of.
    expect(timelyRows(session.tree)).toEqual([id]);
  });
});

describe('the list — R-1', () => {
  it('holds the due and the waiting together, in sibling order', () => {
    const session = new Session();
    const ctx = new FakeContext();
    const plants = chore(session, ctx, 'Plants', '1d');
    const filter = chore(session, ctx, 'Filter', '5d');
    session.apply(tickTimely(session.tree, ctx.at(NOON), plants));
    expect(timelyRows(session.tree)).toEqual([plants, filter]);
  });
});
