<script lang="ts">
  // T-12. Where a row goes when the normal view stops showing it: ticked (T-11)
  // or deleted (T-7). One view for both, because from the user's side the
  // question is the same one — "where did that go?" — and answering it in two
  // places would mean guessing which kind of gone it was.
  //
  // Every row carries the path it sat on, since a bare title out of its list is
  // not enough to recognise: three lists can each hold a "Milk".
  import { deletedRows, finishedRows, type ArchivedRow } from '../core/done';
  import { toggleDone } from '../core/edit';
  import type { Session } from '../app/Session.svelte';
  import { nodeHref } from '../app/router.svelte';
  import KindIcon from './KindIcon.svelte';

  let { session }: { session: Session } = $props();

  const finished = $derived(finishedRows(session.tree));
  const deleted = $derived(deletedRows(session.tree));

  /** Root first, as T-9 renders it; the root itself has no title to show. */
  function pathLabel(row: ArchivedRow): string {
    if (row.path.length === 0) return 'All lists';
    return row.path.map((id) => session.tree.nodes[id]?.title || 'Untitled').join(' / ');
  }
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6" data-testid="done-page">
  <h1 class="text-2xl font-semibold" data-testid="page-title">Done</h1>

  <section class="flex flex-col gap-2">
    <h2 class="text-sm font-medium text-ink-muted">Finished ({finished.length})</h2>
    {#each finished as row (row.id)}
      {@const node = session.tree.nodes[row.id]!}
      <div
        class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-sunken"
        data-testid="finished-row"
        data-row-id={row.id}
      >
        <input
          type="checkbox"
          class="row-control size-4 shrink-0 accent-accent"
          checked={node.done}
          aria-label="Done"
          data-testid="done"
          onchange={() => session.run((tree, ctx) => toggleDone(tree, ctx, row.id))}
        />
        <a
          href={nodeHref(row.id)}
          class="min-w-0 flex-1 truncate text-sm text-ink-muted line-through hover:text-accent"
          data-testid="archived-title"
        >
          {node.title || 'Untitled'}
        </a>
        <span class="shrink-0 truncate text-xs text-ink-faint" data-testid="archived-path">
          {pathLabel(row)}
        </span>
      </div>
    {:else}
      <p class="px-2 py-3 text-sm text-ink-muted" data-testid="finished-empty">
        Nothing ticked off yet. A row you tick leaves its list and lands here.
      </p>
    {/each}
  </section>

  <section class="flex flex-col gap-2">
    <h2 class="text-sm font-medium text-ink-muted">Deleted ({deleted.length})</h2>
    {#each deleted as row (row.id)}
      {@const node = session.tree.nodes[row.id]!}
      <div
        class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-sunken"
        data-testid="deleted-row"
        data-row-id={row.id}
      >
        <KindIcon kind={node.kind} class="size-4 shrink-0 text-ink-faint" />
        <a
          href={nodeHref(row.id)}
          class="min-w-0 flex-1 truncate text-sm text-ink-muted hover:text-accent"
          data-testid="archived-title"
        >
          {node.title || 'Untitled'}
        </a>
        <span class="shrink-0 truncate text-xs text-ink-faint" data-testid="archived-path">
          {pathLabel(row)}
        </span>
      </div>
    {:else}
      <p class="px-2 py-3 text-sm text-ink-muted" data-testid="deleted-empty">
        Nothing deleted.
      </p>
    {/each}
    {#if deleted.length > 0}
      <!-- T-13. Saying so is the honest version of an absent button: the row is
           kept rather than removed, so it is findable, and that is all M1 offers. -->
      <p class="px-2 text-xs text-ink-faint">
        A deleted row and everything inside it is kept rather than removed, so it stays findable — but
        this version has no way to put one back.
      </p>
    {/if}
  </section>
</div>
