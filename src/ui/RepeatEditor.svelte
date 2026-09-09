<script lang="ts">
  // R-2 and R-7. A count and a unit, which is the whole of a period.
  //
  // It opens under the row, from the chip or from the row menu, exactly as
  // `TagEditor` does — one shape for "a field of this row, edited in place". The
  // write is `setEvery`, one last-writer-wins `set` like a tag or a flag, so
  // there is nothing to commit and nothing to cancel: the field is the input.
  import { setEvery } from '../core/edit';
  import { cleanPeriod, MAX_PERIOD, periodOf, type PeriodUnit } from '../core/timely';
  import type { Session } from '../app/Session.svelte';

  let {
    session,
    id,
    autofocus = false,
    onclose,
  }: {
    session: Session;
    id: string;
    autofocus?: boolean;
    onclose?: () => void;
  } = $props();

  const node = $derived(session.tree.nodes[id]);
  const period = $derived(node ? periodOf(node) : { count: 1, unit: 'd' as PeriodUnit });

  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (autofocus) input?.select();
  });

  function write(count: number, unit: PeriodUnit): void {
    session.run((tree, ctx) => setEvery(tree, ctx, id, cleanPeriod(count, unit)));
  }

  // The field is put back in range on the way to the op rather than in the input,
  // so a half-typed number is still a number the person is typing.
  function onCount(event: Event): void {
    const typed = Number((event.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(typed) || typed < 1) return;
    write(typed, period.unit);
  }
</script>

<div class="flex flex-wrap items-center gap-2 text-xs text-ink-muted" data-testid="repeat-editor">
  <span>Repeats every</span>
  <input
    bind:this={input}
    type="number"
    min="1"
    max={MAX_PERIOD}
    value={period.count}
    class="w-16 rounded-md border border-line bg-transparent px-1.5 py-0.5 text-xs outline-none focus:border-accent"
    aria-label="How often, as a number"
    data-testid="repeat-count"
    oninput={onCount}
    onkeydown={(event) => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        onclose?.();
      }
    }}
  />
  <!-- Two units, so two buttons rather than a select: a menu of two is a menu
       nobody needs opened — past_decision.md §19.2. -->
  {#each [{ unit: 'd' as PeriodUnit, label: period.count === 1 ? 'day' : 'days' }, { unit: 'm' as PeriodUnit, label: period.count === 1 ? 'month' : 'months' }] as choice (choice.unit)}
    <button
      type="button"
      class="row-control rounded-md border px-2 py-0.5"
      class:border-accent={period.unit === choice.unit}
      class:text-accent={period.unit === choice.unit}
      class:border-line={period.unit !== choice.unit}
      aria-pressed={period.unit === choice.unit}
      data-testid="repeat-unit"
      data-unit={choice.unit}
      onclick={() => write(period.count, choice.unit)}
    >
      {choice.label}
    </button>
  {/each}
  <button
    type="button"
    class="row-control rounded px-1.5 py-0.5 text-ink-faint hover:text-ink"
    aria-label="Close"
    data-testid="repeat-close"
    onclick={() => onclose?.()}
  >
    ✕
  </button>
</div>
