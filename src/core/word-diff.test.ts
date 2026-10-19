import { describe, expect, it } from 'vitest';
import { wordDiff } from './word-diff';

const changed = (spans: { text: string; changed: boolean }[]) =>
  spans.filter((s) => s.changed).map((s) => s.text.trim());

describe('the words two conflicting values differ by — §9', () => {
  it('marks only the words one side lacks', () => {
    const d = wordDiff('Fine Victor VBS70 Yonex Aerobite https://a.de/', 'Fine Victor VBS70 Try 11. https://a.de/');
    expect(changed(d.a)).toEqual(['Yonex Aerobite']);
    expect(changed(d.b)).toEqual(['Try 11.']);
  });

  it('joins back into exactly the strings it was given, line breaks and all', () => {
    const a = 'one  two\nthree\n\nfour';
    const b = 'one two\nthree and\n\nfive';
    const d = wordDiff(a, b);
    expect(d.a.map((s) => s.text).join('')).toBe(a);
    expect(d.b.map((s) => s.text).join('')).toBe(b);
  });

  it('marks nothing when the two are equal, and everything when they share nothing', () => {
    expect(changed(wordDiff('a b', 'a b').a)).toEqual([]);
    expect(changed(wordDiff('Coffee', 'Tea').b)).toEqual(['Tea']);
  });

  it('starts and ends a highlight on a word, not on the space beside it', () => {
    const spans = wordDiff('Coffee', 'Coffee beans').b;
    expect(spans.filter((s) => s.changed).map((s) => s.text)).toEqual(['beans']);
    expect(spans.map((s) => s.text).join('')).toBe('Coffee beans');
  });
});
