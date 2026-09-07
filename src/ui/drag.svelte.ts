// T-14, the pointer half. `core/edit.ts` owns what a drop *means*; this owns
// where the pointer is and what the row under it should look like.
//
// Pointer events rather than the HTML5 drag-and-drop API, and that is the whole
// reason this file exists: `dragstart` does not fire on touch, so an HTML5 drag
// would be a desktop-only feature wearing the same grip on a phone — and every
// other edit in this application reaches a phone. One `pointerdown`, one
// capture, and the row under the pointer found by hit-testing serves both.

import type { DropWhere } from '../core/edit';
import type { NodeId } from '../core/types';

/**
 * How much of a row's height, top and bottom, means "above this" and "below
 * this". The rest is "inside this" — a quarter each way is wide enough to hit
 * with a thumb and narrow enough that the middle is the easy target.
 */
const EDGE = 0.25;

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

  start(id: NodeId): void {
    this.id = id;
    this.target = null;
    this.refused = false;
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
    this.id = null;
    this.target = null;
    this.refused = false;
  }
}
