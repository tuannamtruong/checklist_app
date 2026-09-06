// T-14, the pointer half. `core/edit.ts` owns what a drop *means*; this owns
// where the pointer is and what the row under it should look like.
//
// Pointer events rather than the HTML5 drag-and-drop API, and that is the whole
// reason this file exists: `dragstart` does not fire on touch, so an HTML5 drag
// would be a desktop-only feature wearing the same grip on a phone — and every
// other edit in this application reaches a phone. One `pointerdown`, one
// capture, and the row under the pointer found by hit-testing serves both.
//
// T-16 is the other half of that: a touch screen has no grip, so the pointer
// that starts the drag is a finger held on the row itself. The geometry below
// does not know which of the two started it.

import type { DropWhere } from '../core/edit';
import type { NodeId } from '../core/types';

/**
 * How much of a row's height, top and bottom, means "above this" and "below
 * this". The rest is "inside this" — a quarter each way is wide enough to hit
 * with a thumb and narrow enough that the middle is the easy target.
 */
const EDGE = 0.25;

/**
 * T-16. How long a finger rests on a row before the row is picked up, and how
 * far it may travel in that time. Long enough that a tap and the start of a
 * scroll are neither of them drags, short enough to be ahead of the browser's
 * own long press — which is what would otherwise select the title's text.
 */
const HOLD_MS = 400;
const HOLD_SLOP = 8;

export interface DropTarget {
  id: NodeId;
  where: DropWhere;
}

/** Whether the tree would accept this drop — `canDrop`, passed in by the view. */
export type DropAllowed = (target: DropTarget) => boolean;

export class RowDrag {
  /** The row being dragged, or null when nothing is. */
  id = $state<NodeId | null>(null);
  /** The row under the pointer and where in it, or null when nowhere useful. */
  target = $state<DropTarget | null>(null);
  /** T-5: the pointer is over a drop the tree will refuse, and it is drawn so. */
  refused = $state(false);

  /** T-16: the finger resting on a row, before the hold has fired. */
  #hold: { id: NodeId; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
  /** What the hold took away from the browser, ready to be given back. */
  #release: (() => void) | null = null;

  start(id: NodeId): void {
    this.id = id;
    this.target = null;
    this.refused = false;
  }

  /**
   * T-16, the touch half: arm the press and hold. `onHold` runs when the row is
   * picked up rather than now — the view captures the pointer there, because a
   * capture taken at `pointerdown` would eat every tap that is not a drag.
   */
  arm(id: NodeId, x: number, y: number, onHold: () => void): void {
    this.disarm();
    const timer = setTimeout(() => {
      this.#hold = null;
      this.#suppress();
      this.start(id);
      // A finger covers the row it picked up, so the confirmation is the one
      // sense not looking at it. Absent on a desktop, and optional everywhere.
      if (typeof navigator !== 'undefined') navigator.vibrate?.(15);
      onHold();
    }, HOLD_MS);
    this.#hold = { id, x, y, timer };
  }

  /** A finger that travels before the hold fires was scrolling, not dragging. */
  armedMove(x: number, y: number): void {
    const hold = this.#hold;
    if (!hold) return;
    if (Math.abs(x - hold.x) > HOLD_SLOP || Math.abs(y - hold.y) > HOLD_SLOP) this.disarm();
  }

  /** Forget a hold that has not fired. A hold that has is `cancel`'s business. */
  disarm(): void {
    if (this.#hold) clearTimeout(this.#hold.timer);
    this.#hold = null;
  }

  /**
   * Everything the browser does with a finger held on a row, taken back — and
   * none of it can be said in CSS. `touch-action` is read when the finger goes
   * down and at that moment this was still a tap, so the events are prevented
   * as they arrive instead: the `touchmove` that would scroll the page (still
   * cancellable, because by definition nothing has moved yet), the
   * `contextmenu` and selection the browser's own long press raises a moment
   * later, and the click of the finger coming up, which would otherwise put the
   * caret in the title the row was dropped on.
   */
  #suppress(): void {
    if (typeof document === 'undefined') return;
    document.getSelection()?.removeAllRanges();
    const block = (event: Event) => event.preventDefault();
    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('touchmove', block, { passive: false });
    document.addEventListener('contextmenu', block, { capture: true });
    this.#release = () => {
      document.removeEventListener('touchmove', block);
      document.removeEventListener('contextmenu', block, { capture: true });
      // The click arrives after `pointerup`, so this one outlives the drag —
      // for one click or a third of a second, whichever comes first.
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 300);
    };
  }

  /**
   * The row under the pointer, from the document rather than from a listener on
   * every row: a captured pointer sends its moves to the grip alone, so the row
   * being crossed never hears about it.
   */
  over(x: number, y: number, allowed: DropAllowed): void {
    if (this.id === null) return;
    const row = document.elementFromPoint(x, y)?.closest('[data-row-id]');
    const over = row?.getAttribute('data-row-id');
    if (!row || !over) {
      this.target = null;
      return;
    }
    const box = row.getBoundingClientRect();
    const offset = box.height === 0 ? 0.5 : (y - box.top) / box.height;
    const where: DropWhere = offset < EDGE ? 'before' : offset > 1 - EDGE ? 'after' : 'inside';
    const target = { id: over, where };
    this.refused = !allowed(target);
    this.target = target;
  }

  /** The drop to run, or null. Either way the drag is over. */
  end(): DropTarget | null {
    const target = this.refused ? null : this.target;
    this.cancel();
    return target;
  }

  cancel(): void {
    this.disarm();
    this.#release?.();
    this.#release = null;
    this.id = null;
    this.target = null;
    this.refused = false;
  }
}
