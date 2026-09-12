// Which row's title should hold the caret, and which note that caret is in.
//
// Creating a row, moving between rows and outdenting all end with the caret
// somewhere specific, and the row that has to take it is usually not the one
// that handled the key. The sequence number is what lets the same row be asked
// twice — after an Escape, say — since the id alone would not have changed.

import { hasBody, type Kind, type NodeId } from '../core/types';

export class RowFocus {
  id = $state<NodeId | null>(null);
  seq = $state(0);
  /** Where the caret goes when the row takes focus. */
  caret = $state<'end' | 'start'>('end');
  /**
   * X-30. The row whose body the caret is in, which is what the note pane
   * draws — a note, or a task since K-12.
   *
   * A caret in a `folder` leaves this alone rather than clearing it: the caret
   * raises a body and nothing else lowers it, so a title with nothing behind it
   * is not a request for the pane to go. What ends it is the pane's own ✕ or a
   * navigation — requirements.md §10.3.
   */
  noteId = $state<NodeId | null>(null);

  request(id: NodeId, caret: 'end' | 'start' = 'end'): void {
    this.id = id;
    this.caret = caret;
    this.seq++;
  }

  /**
   * A row's title has taken the caret. The kind comes from the row because this
   * class holds no tree — the caret is a UI position, not a node.
   */
  enter(id: NodeId, kind: Kind): void {
    this.id = id;
    if (hasBody(kind)) this.noteId = id;
  }

  /** The ✕ on a caret-raised pane, and every navigation — §10.3. */
  clearNote(): void {
    this.noteId = null;
  }
}
