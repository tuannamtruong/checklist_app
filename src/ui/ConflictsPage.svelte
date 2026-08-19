<script lang="ts">
  // What the merge decided without asking — requirements.md §9.
  //
  // Nothing here blocks and nothing here is a prompt (C-5): every row states a
  // decision that has already been made and every button on it is an ordinary
  // edit. That is the whole design — a device that has read both sides and
  // writes the field again dominates both, so settling a race needs no protocol
  // and no second code path.
  import {
    describeField,
    describeValue,
    type Conflict,
    type FieldConflict,
  } from '../core/conflicts';
  import { restoreValue } from '../core/edit';
  import type { Session } from '../app/Session.svelte';
  import type { Dismissals } from '../app/dismissals.svelte';
  import { nodeHref } from '../app/router.svelte';

  let { session, dismissals }: { session: Session; dismissals: Dismissals } = $props();

  const rows = $derived(session.conflicts.filter((row) => !dismissals.has(row.id)));
  const hidden = $derived(session.conflicts.length - rows.length);

  // C-6: a dismissal for a row that no longer derives is dead weight, and the
  // list of live ids is the only thing that can say which those are.
  $effect(() => dismissals.prune(session.conflicts.map((row) => row.id)));

  function titleOf(id: string): string {
    return session.tree.nodes[id]?.title || 'Untitled';
  }

  /** The one button that writes, and it writes what any other edit would. */
  function useDropped(row: FieldConflict): void {
    session.run((tree, ctx) => restoreValue(tree, ctx, row.node, row.field, row.dropped));
  }
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6" data-testid="conflicts-page">
  <header class="flex flex-col gap-1">
    <h1 class="text-2xl font-semibold" data-testid="page-title">Merged</h1>
    <p class="text-sm text-ink-muted">
      Edits from two devices that met each other. Every one of them is already resolved — this is
      what was decided, and where to disagree with it.
    </p>
  </header>

  {#each rows as row (row.id)}
    <article
      class="flex flex-col gap-2 rounded-md border border-line bg-surface-raised px-3 py-3"
      data-testid="conflict-row"
      data-kind={row.kind}
      data-node={row.node}
    >
      {#if row.kind === 'field'}
        <p class="text-sm">
          <a href={nodeHref(row.node)} class="font-medium hover:text-accent">{titleOf(row.node)}</a>
          <span class="text-ink-muted">
            — two devices set the {describeField(row.field)} at once.
          </span>
        </p>
        <p class="text-sm text-ink-muted" data-testid="conflict-detail">
          Kept <b class="text-ink">{describeValue(row.field, row.kept, session.tree)}</b>
          from device {row.keptBy}, over
          <b class="text-ink">{describeValue(row.field, row.dropped, session.tree)}</b>
          from device {row.droppedBy}.
        </p>
      {:else if row.kind === 'cycle'}
        <p class="text-sm">
          <a href={nodeHref(row.node)} class="font-medium hover:text-accent">{titleOf(row.node)}</a>
          <span class="text-ink-muted">— moved to the top level.</span>
        </p>
        <p class="text-sm text-ink-muted" data-testid="conflict-detail">
          Two devices moved rows into each other, which would have made a loop. This one was put
          back at the top so the rest of the tree still reads; drag it where it belongs.
        </p>
      {:else}
        <p class="text-sm">
          <a href={nodeHref(row.node)} class="font-medium hover:text-accent">{titleOf(row.node)}</a>
          <span class="text-ink-muted">
            and
            <a href={nodeHref(row.other)} class="font-medium hover:text-accent">
              {titleOf(row.other)}
            </a>
            were added in the same place at once.
          </span>
        </p>
        <p class="text-sm text-ink-muted" data-testid="conflict-detail">
          They are in device order rather than the order either device meant. Move one if that is
          the wrong way round.
        </p>
      {/if}

      <div class="flex gap-2">
        {#if row.kind === 'field' && row.field !== 'parent'}
          <button
            type="button"
            class="row-control rounded border border-line px-2 py-1 text-sm hover:bg-surface-sunken"
            data-testid="conflict-restore"
            onclick={() => useDropped(row)}
          >
            Use {describeValue(row.field, row.dropped, session.tree)}
          </button>
        {/if}
        <a
          href={nodeHref(row.node)}
          class="row-control rounded border border-line px-2 py-1 text-sm hover:bg-surface-sunken"
          data-testid="conflict-open"
        >
          Open the row
        </a>
        <button
          type="button"
          class="row-control rounded px-2 py-1 text-sm text-ink-muted hover:text-ink"
          data-testid="conflict-dismiss"
          onclick={() => dismissals.dismiss(row.id)}
        >
          Dismiss
        </button>
      </div>
    </article>
  {:else}
    <p class="rounded-md border border-line px-3 py-6 text-sm text-ink-muted" data-testid="conflicts-empty">
      Nothing to report. Edits from two devices merge on their own unless they touch the same field
      at the same time.
    </p>
  {/each}

  {#if hidden > 0}
    <p class="text-xs text-ink-faint" data-testid="conflicts-hidden">
      {hidden} dismissed on this device.
      <button
        type="button"
        class="underline hover:text-ink"
        onclick={() => {
          for (const row of session.conflicts as Conflict[]) dismissals.restore(row.id);
        }}
      >
        Show them again
      </button>
    </p>
  {/if}
</div>
