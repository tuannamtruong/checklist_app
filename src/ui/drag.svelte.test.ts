// T-16, the half of the drag that has no grip: what turns a finger resting on a
// row into a pickup, and what stops one that was only scrolling past.
//
// Geometry is not here. `over` hit-tests the document and the document is the
// browser's, so it is `scripts/ui-smoke.mjs` that drives it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RowDrag } from './drag.svelte';

describe('RowDrag press and hold — T-16', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('picks the row up once the finger has been still long enough', () => {
    const drag = new RowDrag();
    const held = vi.fn();
    drag.arm('a', 100, 100, held);

    vi.advanceTimersByTime(399);
    expect(drag.id).toBe(null);
    expect(held).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(drag.id).toBe('a');
    expect(held).toHaveBeenCalledTimes(1);
  });

  it('lets a finger tremble without letting it travel', () => {
    const drag = new RowDrag();
    drag.arm('a', 100, 100, () => {});
    drag.armedMove(104, 106);
    vi.advanceTimersByTime(400);
    expect(drag.id).toBe('a');
  });

  it('is a scroll rather than a drag once the finger has moved', () => {
    const drag = new RowDrag();
    const held = vi.fn();
    drag.arm('a', 100, 100, held);
    drag.armedMove(100, 140);
    vi.advanceTimersByTime(400);
    expect(drag.id).toBe(null);
    expect(held).not.toHaveBeenCalled();
  });

  it('forgets a hold the finger lifted before it fired', () => {
    const drag = new RowDrag();
    const held = vi.fn();
    drag.arm('a', 100, 100, held);
    drag.disarm();
    vi.advanceTimersByTime(400);
    expect(held).not.toHaveBeenCalled();
  });

  it('arms one row at a time, and the second is the one that fires', () => {
    const drag = new RowDrag();
    drag.arm('a', 100, 100, () => {});
    drag.arm('b', 100, 200, () => {});
    vi.advanceTimersByTime(400);
    expect(drag.id).toBe('b');
  });

  it('a drag cancelled before the hold fired leaves nothing armed', () => {
    const drag = new RowDrag();
    const held = vi.fn();
    drag.arm('a', 100, 100, held);
    drag.cancel();
    vi.advanceTimersByTime(400);
    expect(drag.id).toBe(null);
    expect(held).not.toHaveBeenCalled();
  });
});
