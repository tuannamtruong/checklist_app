import { describe, expect, it } from 'vitest';
import { bump, concurrent, counterOf, dominates, equal, join, withCounter } from './sclock';

describe('sclock', () => {
  it('reads an absent device as zero', () => {
    expect(counterOf({}, 'aaaa0001')).toBe(0);
    expect(counterOf({ aaaa0001: 4 }, 'aaaa0001')).toBe(4);
  });

  it('bumps one device and leaves the rest alone', () => {
    expect(bump({ aaaa0001: 4, bbbb0002: 1 }, 'aaaa0001')).toEqual({ aaaa0001: 5, bbbb0002: 1 });
    expect(bump({}, 'aaaa0001')).toEqual({ aaaa0001: 1 });
  });

  it('never moves a counter backwards', () => {
    expect(withCounter({ aaaa0001: 9 }, 'aaaa0001', 3)).toEqual({ aaaa0001: 9 });
    expect(withCounter({ aaaa0001: 3 }, 'aaaa0001', 9)).toEqual({ aaaa0001: 9 });
  });

  it('joins pointwise', () => {
    expect(join({ a: 3, b: 1 }, { b: 7, c: 2 })).toEqual({ a: 3, b: 7, c: 2 });
  });

  it('classifies ahead, behind, equal and concurrent', () => {
    const ahead = { a: 3, b: 2 };
    const behind = { a: 3, b: 1 };
    expect(dominates(ahead, behind)).toBe(true);
    expect(dominates(behind, ahead)).toBe(false);
    expect(equal(ahead, { a: 3, b: 2 })).toBe(true);
    expect(concurrent({ a: 3 }, { b: 1 })).toBe(true);
    expect(concurrent(ahead, behind)).toBe(false);
  });

  it('reads an equal vector as equal however it is spelled', () => {
    expect(equal({ a: 3, b: 0 }, { a: 3 })).toBe(true);
  });
});
