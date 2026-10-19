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
  import { nameOf } from '../core/devices';
  import { restoreValue } from '../core/edit';
  import { wordDiff } from '../core/word-diff';
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

  /** D-1 closing §15's row 9: a name where there used to be eight hex characters. */
  function deviceLabel(id: string): string {
    return nameOf(session.devices, id);
  }

  /** The one button that writes, and it writes what any other edit would. */
  function useDropped(row: FieldConflict): void {
    session.run((tree, ctx) => restoreValue(tree, ctx, row.node, row.field, row.dropped));
  }

  /** Kept, then not kept, each with the words the other lacks marked. */
  function sidesOf(row: FieldConflict) {
    const diff = wordDiff(
      describeValue(row.field, row.kept, session.tree),
      describeValue(row.field, row.dropped, session.tree),
    );
    return [
      { label: 'Kept', by: row.keptBy, spans: diff.a },
      { label: 'Not kept', by: row.droppedBy, spans: diff.b },
    ];
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
        <!-- Two boxes rather than one sentence: a note body is a paragraph, and
             two paragraphs inlined into "Kept … over …" could not be told apart. -->
        <div class="grid gap-2 md:grid-cols-2" data-testid="conflict-detail">
          {#each sidesOf(row) as side, i (i)}
            <section class="flex min-w-0 flex-col gap-1 rounded border border-line bg-surface px-2 py-2">
              <h2 class="text-xs text-ink-muted">
                <span class="font-medium {i === 0 ? 'text-ink' : ''}">{side.label}</span>
                · from {deviceLabel(side.by)}
              </h2>
              <p
                class="max-h-48 overflow-y-auto whitespace-pre-wrap text-sm [overflow-wrap:anywhere] {i === 0
                  ? 'text-ink'
                  : 'text-ink-muted'}"
              >{#each side.spans as span, k (k)}{#if span.changed}<mark
                      class="rounded-sm bg-accent-soft text-ink"
                      data-testid="conflict-changed">{span.text}</mark
                    >{:else}{span.text}{/if}{/each}</p>
              {#if i === 1 && row.field !== 'parent'}
                <button
                  type="button"
                  class="row-control self-start rounded border border-line px-2 py-1 text-sm hover:bg-surface-sunken"
                  data-testid="conflict-restore"
                  onclick={() => useDropped(row)}
                >
                  Use this instead
                </button>
              {/if}
            </section>
          {/each}
        </div>
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
