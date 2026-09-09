import { describe, expect, it } from 'vitest';
import { MAX_TAGS, cleanTag, cleanTags, hasEveryTag, parseTagged, sameTags } from './tags';

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

describe('a title with tags typed in front of it — A-8', () => {
  it('reads the example: “#abc thing1” is thing1, tagged abc', () => {
    expect(parseTagged('#abc thing1')).toEqual({ title: 'thing1', tags: ['abc'] });
  });

  it('takes as many as are typed, and stops at the first word that is not one', () => {
    expect(parseTagged('#errand #town Buy milk')).toEqual({
      title: 'Buy milk',
      tags: ['errand', 'town'],
    });
    expect(parseTagged('#errand Buy #town milk')).toEqual({
      title: 'Buy #town milk',
      tags: ['errand'],
    });
  });

  it('leaves a hash further along the line alone: a title is prose', () => {
    expect(parseTagged('Buy milk #2')).toEqual({ title: 'Buy milk #2', tags: [] });
  });

  it('treats a bare hash as the start of a title rather than as a tag', () => {
    expect(parseTagged('# heading')).toEqual({ title: '# heading', tags: [] });
    expect(parseTagged('## heading')).toEqual({ title: '## heading', tags: [] });
  });

  it('normalises what it reads, exactly as every other way in does — A-1', () => {
    expect(parseTagged('#Town #town #ERRAND thing')).toEqual({
      title: 'thing',
      tags: ['errand', 'town'],
    });
  });

  it('keeps the title verbatim once the prefix is off', () => {
    expect(parseTagged('#town   Buy  the  milk  ')).toEqual({
      title: 'Buy  the  milk',
      tags: ['town'],
    });
  });

  it('answers an empty title for a line that is only tags: there is no row in it', () => {
    expect(parseTagged('#errand')).toEqual({ title: '', tags: ['errand'] });
    expect(parseTagged('   ')).toEqual({ title: '', tags: [] });
  });

  it('caps at twelve like any other set, and drops the overflow', () => {
    const line = Array.from({ length: 15 }, (_, i) => `#t${i}`).join(' ') + ' thing';
    const parsed = parseTagged(line);
    expect(parsed.title).toBe('thing');
    expect(parsed.tags).toHaveLength(MAX_TAGS);
  });
});
