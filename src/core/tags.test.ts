import { describe, expect, it } from 'vitest';
import { MAX_TAGS, cleanTag, cleanTags, hasEveryTag, sameTags } from './tags';

describe('cleanTag — A-1', () => {
  it('folds case, so Work and work are one tag', () => {
    expect(cleanTag('Work')).toBe('work');
    expect(cleanTag('WORK')).toBe('work');
  });

  it('drops the hash people type and do not mean', () => {
    expect(cleanTag('#errand')).toBe('errand');
    expect(cleanTag('##errand')).toBe('errand');
  });

  it('collapses inner whitespace rather than refusing it', () => {
    expect(cleanTag('  next   week ')).toBe('next week');
  });

  it('answers empty for something that is not a tag', () => {
    expect(cleanTag('   ')).toBe('');
    expect(cleanTag('#')).toBe('');
  });

  it('trims to a length a chip can render', () => {
    expect(cleanTag('x'.repeat(80))).toHaveLength(32);
  });
});

describe('cleanTags', () => {
  // Sorted so that two devices that typed the same tags in different orders
  // hold the *same* value, and have no race to report — past_decision.md §10.
  it('sorts, so the same set is the same value', () => {
    expect(cleanTags(['town', 'errand'])).toEqual(cleanTags(['errand', 'town']));
  });

  it('deduplicates after cleaning, not before', () => {
    expect(cleanTags(['Work', ' work ', '#WORK'])).toEqual(['work']);
  });

  it('drops what is not a string and what cleans to nothing', () => {
    expect(cleanTags(['ok', 7, null, '   ', {}])).toEqual(['ok']);
  });

  it('caps a row at twelve tags', () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${String(i).padStart(2, '0')}`);
    expect(cleanTags(many)).toHaveLength(MAX_TAGS);
  });
});

describe('matching — A-4', () => {
  it('is AND: every selected tag must be on the row', () => {
    expect(hasEveryTag(['errand', 'town'], ['errand'])).toBe(true);
    expect(hasEveryTag(['errand', 'town'], ['errand', 'town'])).toBe(true);
    expect(hasEveryTag(['errand'], ['errand', 'town'])).toBe(false);
  });

  it('matches everything when nothing is selected', () => {
    expect(hasEveryTag([], [])).toBe(true);
  });

  it('sameTags compares the sets, not the arrays', () => {
    expect(sameTags(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameTags(['a'], ['a', 'b'])).toBe(false);
  });
});
