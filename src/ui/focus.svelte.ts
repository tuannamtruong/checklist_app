// Which row's title should hold the caret.
//
// Creating a row, moving between rows and outdenting all end with the caret
// somewhere specific, and the row that has to take it is usually not the one
// that handled the key. The sequence number is what lets the same row be asked
// twice — after an Escape, say — since the id alone would not have changed.

import type { NodeId } from '../core/types';

export class RowFocus {
  id = $state<NodeId | null>(null);
  seq = $state(0);
  /** Where the caret goes when the row takes focus. */
  caret = $state<'end' | 'start'>('end');

  request(id: NodeId, caret: 'end' | 'start' = 'end'): void {
    this.id = id;
    this.caret = caret;
    this.seq++;
  }
}
