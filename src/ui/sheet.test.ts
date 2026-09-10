import { describe, expect, it } from 'vitest';
import { SWIPE_PX, sheetSwipe } from './sheet';

// X-38. The table is the requirement: which direction means something depends
// on which state the sheet is already in, and a travel under the threshold
// means nothing in either.
describe('sheetSwipe', () => {
  it('opens a peeked sheet swiped up', () => {
    expect(sheetSwipe(-SWIPE_PX, false)).toBe('expand');
    expect(sheetSwipe(-200, false)).toBe('expand');
  });

  it('peeks an open sheet swiped down', () => {
    expect(sheetSwipe(SWIPE_PX, true)).toBe('collapse');
    expect(sheetSwipe(200, true)).toBe('collapse');
  });

  it('ignores a travel shorter than the threshold', () => {
    expect(sheetSwipe(-(SWIPE_PX - 1), false)).toBeNull();
    expect(sheetSwipe(SWIPE_PX - 1, true)).toBeNull();
    expect(sheetSwipe(0, false)).toBeNull();
    expect(sheetSwipe(0, true)).toBeNull();
  });

  // The asymmetry is deliberate: a sheet has nowhere further to go in either
  // direction, and a peek dragged down is not a note being closed — X-36's
  // arrow is what says that.
  it('has nothing to say about either direction at its own end', () => {
    expect(sheetSwipe(200, false)).toBeNull();
    expect(sheetSwipe(-200, true)).toBeNull();
  });
});
