// R-1 to R-8: Timely, the third list — the check items that come back.
//
// The list is a third root and one field, and the state of an item is a date
// comparison rather than anything stored: an item records the day it is next
// due, so "due" is `day <= today` and "waiting" is `day > today`. That is G-3's
// read asked a third question, which is why nothing here happens at midnight
// and nothing here can race — requirements.md §4.5, past_decision.md §19.
//
// The tick is the only write, and it writes `now + every`. The day the item was
// carrying is not an input to that sum, which is the whole of R-5: an item due
// on Monday and ticked on Thursday is next due a period after Thursday.
//
// No clock here. `now` is a parameter, exactly as it is everywhere else in this
// layer, so a test asserts a boundary rather than waiting for one.

import { dayKey } from './agenda';
import { childrenOf, type ResolvedTree } from './tree';
import { TIMELY, type Node, type NodeId } from './types';

/** R-2. Days and months, and nothing else — past_decision.md §19.2. */
export type PeriodUnit = 'd' | 'm';

export interface Period {
  count: number;
  unit: PeriodUnit;
}

/** What a row created in Timely repeats at, and what an unreadable period reads as. */
export const DEFAULT_PERIOD: Period = { count: 1, unit: 'd' };

/** Three digits is every period a chore list has: 999 days is nearly three years. */
export const MAX_PERIOD = 999;

const PERIOD = /^([1-9][0-9]{0,2})([dm])$/;

/** The stored shape of a period — one field, so one string. */
export function formatPeriod(period: Period): string {
  return `${period.count}${period.unit}`;
}

export function parsePeriod(every: string | null | undefined): Period | null {
  if (typeof every !== 'string') return null;
  const match = PERIOD.exec(every);
  if (!match) return null;
  return { count: Number(match[1]), unit: match[2] as PeriodUnit };
}

/** The shape check the decoder runs, in the way `day`'s is run — op-log.ts. */
export function isPeriod(value: unknown): value is string {
  return typeof value === 'string' && PERIOD.test(value);
}

/**
 * The period a row repeats at, forgiving whatever it carries.
 *
 * A timely row written by a build that predates R-2, or by a hand edit, has no
 * period and is read as daily rather than as broken — the same forgiving read
 * `agendaRows` gives an item carrying no day at all.
 */
export function periodOf(node: Node): Period {
  return parsePeriod(node.every) ?? DEFAULT_PERIOD;
}

/** A count and a unit from the editor, put in range and made a field. */
export function cleanPeriod(count: number, unit: PeriodUnit): string {
  const whole = Number.isFinite(count) ? Math.trunc(count) : DEFAULT_PERIOD.count;
  return formatPeriod({ count: Math.min(Math.max(whole, 1), MAX_PERIOD), unit });
}

/** What the chip and the menu call a period, in words. */
export function periodLabel(period: Period): string {
  if (period.unit === 'd') return period.count === 1 ? 'every day' : `every ${period.count} days`;
  return period.count === 1 ? 'every month' : `every ${period.count} months`;
}

/** The same period in the width a row has for it. */
export function shortPeriodLabel(period: Period): string {
  return `${period.count}${period.unit === 'd' ? 'd' : 'mo'}`;
}

/**
 * Months by the calendar, not by thirty days.
 *
 * "Every month" on the 15th stays the 15th; a day of the month the target month
 * does not have is clamped to its last, so the 31st repeats on the 30th of a
 * thirty-day month. Thirty-day arithmetic would drift a day every other month,
 * which is exactly the quiet wrongness a chore list is never checked closely
 * enough to catch — past_decision.md §19.2.
 */
function addMonths(at: Date, count: number): Date {
  const dayOfMonth = at.getDate();
  const shifted = new Date(at.getTime());
  // The 1st first: setMonth on the 31st of January would otherwise roll into
  // March on its own, before anything here got to clamp it.
  shifted.setDate(1);
  shifted.setMonth(shifted.getMonth() + count);
  const lastOfMonth = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
  shifted.setDate(Math.min(dayOfMonth, lastOfMonth));
  return shifted;
}

/**
 * R-5. The day an item ticked at `now` next comes due — a function of the clock
 * and the period alone.
 */
export function nextDue(now: number, period: Period): string {
  const at = new Date(now);
  if (period.unit === 'd') {
    at.setDate(at.getDate() + period.count);
    return dayKey(at.getTime());
  }
  return dayKey(addMonths(at, period.count).getTime());
}

/**
 * R-4. Whether the item is due, which is the only state there is: an item that
 * is not due is waiting, and the box is ticked for exactly as long as that is
 * true.
 *
 * An item carrying no day at all is due, for the reason `agendaRows` shows a
 * dayless item in Today: a row that has never been ticked is a row to do.
 */
export function isDue(node: Node, now: number): boolean {
  return node.day === null || node.day <= dayKey(now);
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. */
function daysBetween(from: string, to: string): number {
  const asUtc = (day: string): number => {
    const [year, month, date] = day.split('-').map(Number);
    return Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1);
  };
  return Math.round((asUtc(to) - asUtc(from)) / 86_400_000);
}

/**
 * R-7. What the row says about when the item comes back, which is the countdown
 * R-5 makes meaningful — "in 4 days" is the whole point of having ticked it.
 */
export function dueLabel(node: Node, now: number): string {
  if (isDue(node, now)) return 'due today';
  const days = daysBetween(dayKey(now), node.day!);
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}

/**
 * R-1. The list, which is every child of the third root in T-2's sibling order —
 * the due and the waiting together, because a chore that is done for now is
 * still one of the chores.
 *
 * There is no `only` set to hand the tree view and no second sort: Timely is one
 * level deep, and an order a person dragged into place is the order they meant —
 * the same argument §4.4 makes against floating an overdue item to the top.
 */
export function timelyRows(tree: ResolvedTree): readonly NodeId[] {
  return childrenOf(tree, TIMELY);
}
