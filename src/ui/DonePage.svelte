<script lang="ts">
  // T-12. Where a row goes when the normal view stops showing it: ticked (T-11)
  // or deleted (T-7). One list for both, because from the user's side the
  // question is the same one — "where did that go?" — and two lists made the
  // reader answer "which kind of gone was it?" before they could start looking.
  //
  // Newest first, by when the row left rather than by where it sat: the row
  // being looked for is nearly always the last one to go. Tree order was what
  // the finished list used, and it is the wrong order for a list nobody browses.
  //
  // Every row carries the path it sat on, since a bare title out of its list is
  // not enough to recognise: three lists can each hold a "Milk".
  import { archivedRows, type ArchivedRow } from '../core/done';
  import { pathLabelOf } from './paths';
  import { unarchive } from '../core/edit';
  import type { Session } from '../app/Session.svelte';
  import { nodeHref } from '../app/router.svelte';
  import KindIcon from './KindIcon.svelte';

  let { session }: { session: Session } = $props();

  const rows = $derived(archivedRows(session.tree));

  /** Root first, as T-9 renders it; the root itself has no title to show. */
  function pathLabel(row: ArchivedRow): string {
    return pathLabelOf(session.tree, row.id, row.path, Date.now());
  }

  /**
   * The date the list is ordered by, said out loud — an order nobody can read
   * is one they read as no order at all. Local format on purpose: this is the
   * one screen where the reader is matching a row against their own memory of
   * a day, and the device's locale is what that memory is in.
   */
  function whenLabel(row: ArchivedRow): string {
    if (row.at === null) return '';
    return new Date(row.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6" data-testid="done-page">
  <h1 class="text-2xl font-semibold" data-testid="page-title">Done</h1>

  <section class="flex flex-col gap-2">
    <h2 class="text-sm font-medium text-ink-muted">Newest first ({rows.length})</h2>
    {#each rows as row (row.id)}
      {@const node = session.tree.nodes[row.id]!}
      <div
        class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-sunken"
        data-testid="archived-row"
        data-row-id={row.id}
      >
        <KindIcon kind={node.kind} class="size-[1.2rem] shrink-0 text-ink-faint" />
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
        <span class="w-14 shrink-0 text-right text-xs text-ink-faint" data-testid="archived-when">
          {whenLabel(row)}
        </span>
        <!-- One control, because the list draws no distinction either. A
             tombstone is cleared by T-13's `restore` and a tick by an ordinary
             `set`; a row carrying both gets both, and the subtree comes back
             with the tombstone because T-7 never marked the descendants —
             sync-flow.md §4.9. -->
        <button
          type="button"
          class="row-control shrink-0 rounded border border-line px-2 py-0.5 text-xs hover:bg-surface"
          data-testid="restore"
          onclick={() => session.run((tree, ctx) => unarchive(tree, ctx, row.id))}
        >
          Restore
        </button>
      </div>
    {:else}
      <p class="px-2 py-3 text-sm text-ink-muted" data-testid="archive-empty">
        Nothing here yet. A row you tick or delete leaves its list and lands here.
      </p>
    {/each}
  </section>
</div>
