// X-38. What a drag along the note sheet means, and nothing at all about where
// the pointer is: the geometry belongs to the view, the verdict belongs here,
// and `sheet.test.ts` can ask what fifty pixels means without a browser.
//
// The two answers are not symmetrical, and that is the requirement rather than
// an omission. A peek swiped up opens, an open sheet swiped down peeks — but a
// peek swiped *down* is not "close the note": the sheet is the reader's way
// back to a note they are part way through, and the one control that leaves it
// is X-36's arrow, which says so.

/**
 * How far a finger travels before it is a swipe rather than a tap that wandered.
 * Wide enough that a thumb resting on the peek to read it is not a gesture,
 * short enough to be one flick — the same argument `drag.svelte.ts` makes about
 * its own slop, at the other end of the scale.
 */
export const SWIPE_PX = 48;

/** What the sheet should do about a drag, or null for "nothing". */
export type SheetSwipe = 'expand' | 'collapse' | null;

/**
 * @param dy        how far the pointer travelled down the screen, in pixels:
 *                  negative is up, which is the direction that opens a sheet.
 * @param expanded  whether the sheet is already open, which is what decides
 *                  which of the two directions means anything.
 */
export function sheetSwipe(dy: number, expanded: boolean): SheetSwipe {
  if (!expanded && dy <= -SWIPE_PX) return 'expand';
  if (expanded && dy >= SWIPE_PX) return 'collapse';
  return null;
}
