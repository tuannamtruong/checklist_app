<script lang="ts">
  // R-7. What a timely row says about itself: how often it repeats, and — while
  // it is waiting — when it comes back.
  //
  // The chip is a button for the same reason A-2's flag is: the field belongs to
  // the row, so the control does too, and a phone reaches it with the thumb that
  // is already on the row. Pressing it opens `RepeatEditor` under the row rather
  // than cycling a ladder of presets — the period is a count and a unit, and any
  // count either unit can say has to be reachable (past_decision.md §19.2).
  import { dueLabel, isDue, periodOf, shortPeriodLabel } from '../core/timely';
  import type { Node } from '../core/types';

  let {
    node,
    now,
    onedit,
  }: {
    node: Node;
    /** R-4. The day is asked of a clock the app owns, never of this layer. */
    now: number;
    onedit: () => void;
  } = $props();

  const period = $derived(periodOf(node));
  const waiting = $derived(!isDue(node, now));
</script>

<div class="flex shrink-0 items-center gap-1">
  <!-- The countdown, and only while there is one: a due item's answer to "when"
       is "now", which is what the live row already says. -->
  {#if waiting}
    <span class="hidden text-xs text-ink-faint sm:inline" data-testid="repeat-due">
      {dueLabel(node, now)}
    </span>
  {/if}
  <button
    type="button"
    class="row-control rounded border border-line px-1.5 text-xs text-ink-muted hover:border-accent hover:text-accent"
    aria-label="Repeats {shortPeriodLabel(period)} — change how often"
    title="Repeats {shortPeriodLabel(period)}"
    data-testid="repeat-chip"
    data-every={node.every ?? ''}
    onclick={onedit}
  >
    ↻ {shortPeriodLabel(period)}
  </button>
</div>
