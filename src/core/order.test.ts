import { describe, expect, it } from 'vitest';
import { compareSiblings, FIRST_KEY, isOrderKey, keyBetween } from './order';

function isSorted(keys: readonly string[]): boolean {
  return keys.every((key, i) => i === 0 || keys[i - 1]! < key);
}

describe('keyBetween', () => {
  it('mints the first key of an empty list', () => {
    expect(keyBetween(null, null)).toBe(FIRST_KEY);
  });

  it('keeps appends O(1) in key length — sync-flow.md §5.5', () => {
    const keys: string[] = [];
    let last: string | null = null;
    for (let i = 0; i < 500; i++) {
      last = keyBetween(last, null);
      keys.push(last);
    }
    expect(isSorted(keys)).toBe(true);
    // A midpoint-only scheme would be past 80 characters by here.
    expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(3);
  });

  it('keeps prepends O(1) in key length', () => {
    const keys: string[] = [];
    let first: string | null = null;
    for (let i = 0; i < 500; i++) {
      first = keyBetween(null, first);
      keys.push(first);
    }
    expect(isSorted([...keys].reverse())).toBe(true);
    expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(3);
  });

  it('always lands strictly between, however often one gap is split', () => {
    let low = keyBetween(null, null);
    let high = keyBetween(low, null);
    for (let i = 0; i < 200; i++) {
      const mid = keyBetween(low, high);
      expect(low < mid && mid < high).toBe(true);
      // Alternate which side the next split takes, so neither end is favoured.
      if (i % 2 === 0) low = mid;
      else high = mid;
    }
  });

  it('produces a total order under random insertion', () => {
    // A seeded PRNG, so a failure reproduces — test.md §3.1.
    let seed = 20260818;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const keys: string[] = [keyBetween(null, null)];
    for (let i = 0; i < 400; i++) {
      const at = Math.floor(random() * (keys.length + 1));
      const before = at === 0 ? null : keys[at - 1]!;
      const after = at === keys.length ? null : keys[at]!;
      keys.splice(at, 0, keyBetween(before, after));
    }
    expect(isSorted(keys)).toBe(true);
    expect(keys.length).toBe(401);
  });

  it('refuses a reversed pair rather than minting a key nobody can sort', () => {
    const low = keyBetween(null, null);
    const high = keyBetween(low, null);
    expect(() => keyBetween(high, low)).toThrow();
  });

  it('rejects keys that are not keys', () => {
    expect(isOrderKey('a0')).toBe(true);
    expect(isOrderKey('a00')).toBe(false);
    expect(isOrderKey('')).toBe(false);
    expect(isOrderKey('!')).toBe(false);
  });
});

describe('compareSiblings', () => {
  const row = (order: string, orderBy: string, id: string) => ({ order, orderBy, id });

  it('breaks an identical key by device id, then by node id — §5.3', () => {
    expect(compareSiblings(row('a1', 'bbbb', 'n_2'), row('a1', 'cccc', 'n_1'))).toBeLessThan(0);
    expect(compareSiblings(row('a1', 'bbbb', 'n_2'), row('a1', 'bbbb', 'n_1'))).toBeGreaterThan(0);
    expect(compareSiblings(row('a1', 'bbbb', 'n_1'), row('a1', 'bbbb', 'n_1'))).toBe(0);
  });

  it('sorts on the key before anything else', () => {
    expect(compareSiblings(row('a0', 'zzzz', 'n_9'), row('a1', 'aaaa', 'n_1'))).toBeLessThan(0);
  });

  it('agrees whichever order the two devices read the rows in', () => {
    const rows = [row('a1', 'cccc', 'n_3'), row('a1', 'bbbb', 'n_2'), row('a0', 'dddd', 'n_1')];
    const one = [...rows].sort(compareSiblings).map((r) => r.id);
    const other = [...rows].reverse().sort(compareSiblings).map((r) => r.id);
    expect(one).toEqual(other);
    expect(one).toEqual(['n_1', 'n_2', 'n_3']);
  });
});
