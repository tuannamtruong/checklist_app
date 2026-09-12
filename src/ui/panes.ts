// Which note the right pane draws and which list the left one draws — X-21 and
// X-30, in one derivation over the route and the row holding the caret.
//
// It lives here rather than in `App.svelte` because it is the whole of both
// requirements and neither of them is layout: a Svelte file cannot be asked
// what it would draw, and this can — `panes.test.ts` is the unit half that a
// browser would be slow to reach.
//
// The rule is two lines and the order between them is the requirement:
//
//   the pane  = the body the caret is in, or the body the route names
//   the list  = the route's, always
//
// "The note" is what the pane has been called since it was built for the one
// kind that had a body; K-12 gave a task the same one, so the names here mean
// "the row whose body is drawn" — requirements.md §10.3.
//
// The list is a function of the *route* alone, which is what makes X-30 true by
// construction: a caret cannot move the left column, because the left column
// never reads it. requirements.md §10.3.

import { isVisible, listAbove } from '../core/tree';
import { hasBody, isRoot, type NodeId } from '../core/types';
import type { ResolvedTree } from '../core/tree';

export interface Panes {
  /** The page on the left: the route's node, or `null` for the root's page. */
  listId: NodeId | null;
  /** The note beside it, or `null` when there is no pane at all. */
  noteId: NodeId | null;
  /**
   * X-30. Whether the pane is the caret's rather than the route's. The one
   * thing it changes is the ✕: a route's pane closes by leaving the route, and
   * a caret's has no route to leave, so it clears the caret instead.
   */
  fromCaret: boolean;
}

/**
 * The route's node if it still exists and has a body to draw — X-21, and K-12,
 * which is why the question is `hasBody` rather than a kind: a task splits the
 * route exactly as a note does, and a folder is a list and splits nothing.
 */
function noteAt(tree: ResolvedTree, id: NodeId | null): NodeId | null {
  if (id === null || !isVisible(tree, id)) return null;
  const kind = tree.nodes[id]?.kind;
  return kind !== undefined && hasBody(kind) ? id : null;
}

/**
 * @param routeId      the node `#/n/<id>` names, or `null` at `#/`.
 * @param caretNoteId  the row whose body the caret is in — `RowFocus.noteId`,
 *                     which only a title with a body behind it ever sets. A
 *                     caret in a folder's title leaves it where it was, and
 *                     blurring the title does not clear it: clicking from the
 *                     title into the body itself would otherwise close the pane
 *                     under the click that was about to edit it — §10.3.
 *
 * It is still checked here rather than trusted, because the note it names can
 * stop being one under it: a peer's delete (T-7) or a kind change from the row
 * menu (K-5) both close the pane, and neither goes anywhere near the caret.
 */
export function panesFor(
  tree: ResolvedTree,
  routeId: NodeId | null,
  caretNoteId: NodeId | null,
): Panes {
  const routeNote = noteAt(tree, routeId);
  const caretNote = noteAt(tree, caretNoteId);
  // The route's node when it has no body — a `folder` is a list — and
  // otherwise the nearest list above it, walked past every ancestor that has
  // one so a nested body leaves the left column where it is.
  const listId = routeNote === null ? routeId : nearestList(tree, routeNote);
  return {
    listId,
    noteId: caretNote ?? routeNote,
    fromCaret: caretNote !== null && caretNote !== routeNote,
  };
}

function nearestList(tree: ResolvedTree, noteId: NodeId): NodeId | null {
  const above = listAbove(tree, noteId);
  // G-1 and R-1. Any of the three roots means there is no list row to draw
  // beside the note.
  return isRoot(above) ? null : above;
}
