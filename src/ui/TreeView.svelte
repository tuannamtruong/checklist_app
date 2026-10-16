<script lang="ts">
  // The rows under one parent, flattened to exactly what is on screen.
  //
  // Flat rather than recursive because the keyboard model works on what the
  // user can see: `↑` from the first child of a collapsed-away subtree has to
  // land on the row above it, whatever their depths — rows.ts.
  import type { NodeId, ParentId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import type { ViewState } from '../app/view-state.svelte';
  import type { RowFocus } from './focus.svelte';
  import Row from './Row.svelte';
  import { RowDrag } from './drag.svelte';
  import { visibleRows } from './rows';

  let {
    session,
    view,
    focus,
    parent,
    now,
    only = null,
    open = null,
  }: {
    session: Session;
    view: ViewState;
    focus: RowFocus;
    parent: ParentId;
    /**
     * G-6 and R-4. The day, handed down rather than read here: a row asks
     * whether a timely item is due and the menu asks which day move it offers,
     * and both have to turn over when the page they are on does.
     */
    now: number;
    /**
     * G-3. The ids this list may draw, or null for all of them. The agenda's two
     * pages are one parent asked two questions about a day, and a row the day
     * leaves out is left out of the *rows* rather than of the rendering — so
     * `↑`, `Alt-↓` and `Enter` move through what is on screen and nothing else.
     *
     * A-4's tag filter was the other caller until the tags moved to `#/tags`.
     * Nothing narrows the tree now but the day — §4.2.
     */
    only?: ReadonlySet<NodeId> | null;
    /** X-41. The row whose body is open in the pane, which its row says. */
    open?: NodeId | null;
  } = $props();

  // T-14. One drag at a time, and it belongs to the list being dragged within:
  // a page renders one tree, and a pointer is in one of them.
  const drag = new RowDrag();

  const rows = $derived(
    visibleRows(session.tree, parent, (id) => view.isCollapsed(id), only),
  );
</script>

<div class="flex flex-col" data-testid="tree">
  {#each rows as row (row.id)}
    <Row ctx={{ session, view, focus, rows, now, id: row.id }} depth={row.depth} {drag} open={row.id === open} />
  {/each}
</div>

<!-- K-10. Nothing is added from down here any more: the two kind buttons went
     up to the group at the top of the list, beside the line that was already
     there — requirements.md §4. This draws rows, and that is all a list of rows
     has ever needed to do. -->
