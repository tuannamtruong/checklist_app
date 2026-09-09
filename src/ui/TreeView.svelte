<script lang="ts">
  // The rows under one parent, flattened to exactly what is on screen.
  //
  // Flat rather than recursive because the keyboard model works on what the
  // user can see: `↑` from the first child of a collapsed-away subtree has to
  // land on the row above it, whatever their depths — rows.ts.
  import { filteredIds } from '../core/filter';
  import { childrenOf } from '../core/tree';
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
     * G-3. The ids this list may draw, or null for all of them. It is A-4's
     * filter mechanism with a second caller: the agenda's two pages are one
     * parent asked two questions about a day, and the rows they leave out are
     * left out the way a filtered row is — so `↑`, `Alt-↓` and `Enter` move
     * through what is on screen here as well.
     */
    only?: ReadonlySet<NodeId> | null;
  } = $props();

  // T-14. One drag at a time, and it belongs to the list being dragged within:
  // a page renders one tree, and a pointer is in one of them.
  const drag = new RowDrag();

  // A-4. A filter overrides the collapse state for as long as it is on: a hit
  // three levels down a collapsed folder is a row the filter promised and did
  // not deliver. T-8's state is remembered rather than cleared — §4.2.
  const filtered = $derived(filteredIds(session.tree, view.tagFilter));
  // Two filters and one set: a tag filter on an agenda page has to mean both,
  // or the page would answer a question nobody asked.
  const allowed = $derived.by(() => {
    if (only == null) return filtered;
    if (filtered === null) return only;
    return new Set([...only].filter((id) => filtered.has(id)));
  });
  const rows = $derived(
    visibleRows(
      session.tree,
      parent,
      (id) => filtered === null && view.isCollapsed(id),
      allowed,
    ),
  );
  const isEmpty = $derived(
    only == null ? childrenOf(session.tree, parent).length === 0 : only.size === 0,
  );
</script>

<div class="flex flex-col" data-testid="tree">
  {#each rows as row (row.id)}
    <Row ctx={{ session, view, focus, rows, now, id: row.id }} depth={row.depth} {drag} />
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
