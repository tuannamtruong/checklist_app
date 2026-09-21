<script lang="ts">
  // The rows under one parent, flattened to exactly what is on screen.
  //
  // Flat rather than recursive because the keyboard model works on what the
  // user can see: `↑` from the first child of a collapsed-away subtree has to
  // land on the row above it, whatever their depths — rows.ts.
  import { finishedChildCount } from '../core/done';
  import { createFirstChild, createLastChild } from '../core/edit';
  import { filteredIds } from '../core/filter';
  import { childrenOf } from '../core/tree';
  import type { Kind, ParentId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import type { ViewState } from '../app/view-state.svelte';
  import type { RowFocus } from './focus.svelte';
  import { DONE_HREF } from '../app/router.svelte';
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
  // Only asked when the list looks empty, which is the only time the answer
  // changes what it says — T-11.
  const finished = $derived(isEmpty ? finishedChildCount(session.tree, parent) : 0);

  // A-6. A row created under a filter carries that filter's tags, or it would
  // vanish as it was created — requirements.md §4.1.
  function add(kind: Kind): void {
    const tags = [...view.tagFilter];
    const ops = session.run((tree, ctx) =>
      isEmpty
        ? createFirstChild(tree, ctx, parent, { kind, tags })
        : createLastChild(tree, ctx, parent, { kind, tags }),
    );
    if (ops[0]) focus.request(ops[0].id);
  }
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

{#if isEmpty}
  <p class="px-2 py-6 text-sm text-ink-muted" data-testid="empty">
    {#if finished > 0}
      All done — {finished} finished {finished === 1 ? 'row is' : 'rows are'} in
      <a class="text-accent hover:underline" href={DONE_HREF}>Done</a>.
    {:else}
      Nothing here yet.
    {/if}
  </p>
{/if}

<!-- The three kinds that are not a task. K-8's line is not here: it is in the
     page header, at a fixed place rather than wherever the last row leaves it —
     requirements.md §4. These stay under the list, one click away, because
     picking a kind is a decision worth a button rather than a mode. -->
<div class="mt-2 flex flex-wrap gap-2 px-2">
  <button
    type="button"
    class="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink-muted hover:border-accent hover:text-accent"
    data-testid="add-list"
    onclick={() => add('list')}
  >
    + List
  </button>
  <button
    type="button"
    class="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink-muted hover:border-accent hover:text-accent"
    data-testid="add-note"
    onclick={() => add('note')}
  >
    + Note
  </button>
  <button
    type="button"
    class="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink-muted hover:border-accent hover:text-accent"
    data-testid="add-folder"
    onclick={() => add('folder')}
  >
    + Folder
  </button>
</div>
