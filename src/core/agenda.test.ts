import { describe, expect, it } from 'vitest';
import { agendaIds, agendaRows, dayKey, dayOfList, nextDayKey } from './agenda';
import { createLastChild, remove, setDay, toggleDone } from './edit';
import { FakeContext, Session } from './test-support';
import { AGENDA, ROOT } from './types';

/** 2026-09-08, 10:00 local — the day the tests are written against. */
const NOON = new Date(2026, 8, 8, 10, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

/** One item filed for `day`, and the id it was minted with. */
function agenda(day: string, title: string, session: Session, ctx: FakeContext): string {
  return add(session, ctx, AGENDA, { title, day });
}

function add(
  session: Session,
  ctx: FakeContext,
  parent: string,
  options: { title: string; day?: string },
): string {
  const ops = createLastChild(session.tree, ctx.tick(), parent, options);
  session.apply(ops);
  return ops[0]!.id;
}

describe('the day key — G-2', () => {
  it('is the local date, zero-padded', () => {
    expect(dayKey(new Date(2026, 0, 3, 23, 30).getTime())).toBe('2026-01-03');
  });

  it('rolls to the next date, over a month end and a leap day', () => {
    expect(nextDayKey(new Date(2026, 0, 31, 12).getTime())).toBe('2026-02-01');
    expect(nextDayKey(new Date(2028, 1, 28, 12).getTime())).toBe('2028-02-29');
  });

  it('is what each page files under — G-5', () => {
    expect(dayOfList('today', NOON)).toBe('2026-09-08');
    expect(dayOfList('tomorrow', NOON)).toBe('2026-09-09');
  });
});

describe('the two lists — G-3, G-4', () => {
  function seeded(): { session: Session; ctx: FakeContext; today: string; later: string } {
    const ctx = new FakeContext();
    const session = new Session();
    const today = agenda(dayOfList('today', NOON), 'Ring the dentist', session, ctx);
    const later = agenda(dayOfList('tomorrow', NOON), 'Collect the parcel', session, ctx);
    return { session, ctx, today, later };
  }

  it('splits the one parent by the day each item is filed for', () => {
    const { session, today, later } = seeded();
    expect(agendaRows(session.tree, 'today', NOON)).toEqual([today]);
    expect(agendaRows(session.tree, 'tomorrow', NOON)).toEqual([later]);
  });

  it("is the whole of the rollover: the same tree, read a day later — G-3", () => {
    // Nothing is written between these two reads. The item is in Today because
    // the day it was filed for has come, which is what makes the rollover free.
    const { session, today, later } = seeded();
    expect(agendaRows(session.tree, 'today', NOON + DAY)).toEqual([today, later]);
    expect(agendaRows(session.tree, 'tomorrow', NOON + DAY)).toEqual([]);
  });

  it('keeps a day nobody got to in Today rather than emptying it — G-4', () => {
    const { session, today } = seeded();
    expect(agendaRows(session.tree, 'today', NOON + 5 * DAY)).toContain(today);
  });

  it('shows an item carrying no day at all in Today rather than nowhere', () => {
    const ctx = new FakeContext();
    const session = new Session();
    const id = add(session, ctx, AGENDA, { title: 'Stray' });
    expect(session.tree.nodes[id]!.day).toBe(null);
    expect(agendaRows(session.tree, 'today', NOON)).toEqual([id]);
  });

  it('is not the tree, and the tree is not it — G-1', () => {
    const { session, today } = seeded();
    const inTree = add(session, new FakeContext('bbbb0002'), ROOT, { title: 'Shopping' });
    expect(agendaRows(session.tree, 'today', NOON)).not.toContain(inTree);
    expect(session.tree.children.get(ROOT)).toEqual([inTree]);
    expect(session.tree.children.get(AGENDA)).toContain(today);
  });

  it('loses a ticked or deleted item exactly as a list does — T-11, T-7', () => {
    const { session, ctx, today, later } = seeded();
    session.apply(toggleDone(session.tree, ctx.tick(), today));
    session.apply(remove(session.tree, ctx.tick(), later));
    expect(agendaRows(session.tree, 'today', NOON)).toEqual([]);
    expect(agendaRows(session.tree, 'tomorrow', NOON)).toEqual([]);
  });
});

describe('moving between the lists — G-6', () => {
  it('is one `set day` and no move at all', () => {
    const ctx = new FakeContext();
    const session = new Session();
    const id = agenda(dayOfList('today', NOON), 'Ring the dentist', session, ctx);
    const ops = setDay(session.tree, ctx.tick(), id, dayOfList('tomorrow', NOON));
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'set', id, day: '2026-09-09' });
    session.apply(ops);
    expect(session.tree.nodes[id]!.parent).toBe(AGENDA);
    expect(agendaRows(session.tree, 'tomorrow', NOON)).toEqual([id]);
  });

  it('writes nothing when the day is already that day — S-10', () => {
    const ctx = new FakeContext();
    const session = new Session();
    const id = agenda('2026-09-08', 'Ring the dentist', session, ctx);
    expect(setDay(session.tree, ctx.tick(), id, '2026-09-08')).toEqual([]);
  });
});

describe('what the page draws', () => {
  it('carries an item’s children with it, whatever day they do not have', () => {
    const ctx = new FakeContext();
    const session = new Session();
    const parent = agenda(dayOfList('tomorrow', NOON), 'Collect the parcel', session, ctx);
    const child = add(session, ctx, parent, { title: 'Take the card' });
    expect([...agendaIds(session.tree, 'tomorrow', NOON)]).toEqual([parent, child]);
    expect(agendaIds(session.tree, 'today', NOON).size).toBe(0);
  });
});
