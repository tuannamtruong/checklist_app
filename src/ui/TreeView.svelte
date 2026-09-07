<script lang="ts">
  // The rows under one parent, flattened to exactly what is on screen.
  //
  // Flat rather than recursive because the keyboard model works on what the
  // user can see: `↑` from the first child of a collapsed-away subtree has to
  // land on the row above it, whatever their depths — rows.ts.
  import { filteredIds } from '../core/filter';
  import { childrenOf } from '../core/tree';
  import type { ParentId } from '../core/types';
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
  }: { session: Session; view: ViewState; focus: RowFocus; parent: ParentId } = $props();

  // T-14. One drag at a time, and it belongs to the list being dragged within:
  // a page renders one tree, and a pointer is in one of them.
  const drag = new RowDrag();

  // A-4. A filter overrides the collapse state for as long as it is on: a hit
  // three levels down a collapsed folder is a row the filter promised and did
  // not deliver. T-8's state is remembered rather than cleared — §4.2.
  const filtered = $derived(filteredIds(session.tree, view.tagFilter));
  const rows = $derived(
    visibleRows(
      session.tree,
      parent,
      (id) => filtered === null && view.isCollapsed(id),
      filtered,
    ),
  );
  const isEmpty = $derived(childrenOf(session.tree, parent).length === 0);
</script>

<div class="flex flex-col" data-testid="tree">
  {#each rows as row (row.id)}
    <Row ctx={{ session, view, focus, rows, id: row.id }} depth={row.depth} {drag} />
  {/each}
</div>

<!-- A-4. A list that has rows but is showing none of them is a filter's doing,
     and saying so is what keeps it from reading as an empty list. -->
{#if !isEmpty && rows.length === 0}
  <p class="px-2 py-6 text-sm text-ink-muted" data-testid="filtered-empty">
    Nothing here carries {[...view.tagFilter].join(' and ')}.
    <button
      type="button"
      class="text-accent hover:underline"
      data-testid="filtered-empty-clear"
      onclick={() => view.clearTagFilter()}
  >
      Clear the filter
    </button>
  </p>
{/if}

<!-- K-10. Nothing is added from down here any more: the two kind buttons went
     up to the group at the top of the list, beside the line that was already
     there — requirements.md §4. This draws rows, and that is all a list of rows
     has ever needed to do. -->
