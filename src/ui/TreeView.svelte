<script lang="ts">
  // The rows under one parent, flattened to exactly what is on screen.
  //
  // Flat rather than recursive because the keyboard model works on what the
  // user can see: `↑` from the first child of a collapsed-away subtree has to
  // land on the row above it, whatever their depths — rows.ts.
  import { createFirstChild, createLastChild } from '../core/edit';
  import { childrenOf } from '../core/tree';
  import type { Kind, ParentId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import type { ViewState } from '../app/view-state.svelte';
  import type { RowFocus } from './focus.svelte';
  import Row from './Row.svelte';
  import { visibleRows } from './rows';

  let {
    session,
    view,
    focus,
    parent,
  }: { session: Session; view: ViewState; focus: RowFocus; parent: ParentId } = $props();

  const rows = $derived(visibleRows(session.tree, parent, (id) => view.isCollapsed(id)));
  const isEmpty = $derived(childrenOf(session.tree, parent).length === 0);

  function add(kind: Kind): void {
    const ops = session.run((tree, ctx) =>
      isEmpty ? createFirstChild(tree, ctx, parent, { kind }) : createLastChild(tree, ctx, parent, { kind }),
    );
    if (ops[0]) focus.request(ops[0].id);
  }
</script>

<div class="flex flex-col" data-testid="tree">
  {#each rows as row (row.id)}
    <Row ctx={{ session, view, focus, rows, id: row.id }} depth={row.depth} />
  {/each}
</div>

{#if isEmpty}
  <p class="px-2 py-6 text-sm text-ink-muted" data-testid="empty">
    Nothing here yet.
  </p>
{/if}

<div class="mt-2 flex flex-wrap gap-2 px-2">
  <button
    type="button"
    class="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink-muted hover:border-accent hover:text-accent"
    data-testid="add-task"
    onclick={() => add('task')}
  >
    + Task
  </button>
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
