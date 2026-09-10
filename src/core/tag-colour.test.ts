import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TAG_TINTS, tagTint } from './tag-colour';

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

describe('tagTint — A-9', () => {
  it('gives every tag one of the tints, and always the same one', () => {
    for (const tag of ['errand', 'town', 'towns', 'work', 'x', '', 'a longer tag with spaces']) {
      const tint = tagTint(tag);
      expect(Number.isInteger(tint), tag).toBe(true);
      expect(tint, tag).toBeGreaterThanOrEqual(0);
      expect(tint, tag).toBeLessThan(TAG_TINTS);
      expect(tagTint(tag), tag).toBe(tint);
    }
  });

  it('is a function of the name alone, which is what makes it need no storage', () => {
    // The same six letters on another device, in another view, after a reload.
    expect(tagTint('errand')).toBe(tagTint('errand'));
    // And one letter apart is not one tint apart by accident.
    const near = ['town', 'towns', 'towm', 'Town'.toLowerCase()];
    expect(new Set(near.map(tagTint)).size).toBeGreaterThan(1);
  });

  it('spreads a handful of ordinary tags over more than one tint', () => {
    const tags = ['errand', 'town', 'work', 'home', 'urgent', 'later', 'ferry', 'kitchen'];
    expect(new Set(tags.map(tagTint)).size).toBeGreaterThan(4);
  });

  // §10.1: nothing in TypeScript computes a colour. The number above is a hue
  // bucket, and this is the seam where `app.css` says what a bucket looks like.
  it('leaves the colour to the stylesheet', () => {
    expect(css).toContain('.tag-chip');
    expect(css).toContain('--tag-tint');
  });
});
