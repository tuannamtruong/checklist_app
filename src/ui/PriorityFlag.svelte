<script lang="ts">
  // A-2. One control with four states, on the row itself.
  //
  // It has no row-menu entry and does not owe one: §3.1's rule is that a
  // *keyboard* action must be reachable without a keyboard, and this is already
  // a control a thumb can hit. Four menu entries would teach nothing the flag
  // does not — requirements.md §4.1.
  import { nextPriority, setPriority } from '../core/edit';
  import type { Priority } from '../core/types';
  import type { Session } from '../app/Session.svelte';

  let { session, id, priority }: { session: Session; id: string; priority: Priority } = $props();

  const LABELS: Record<Priority, string> = {
    none: 'No flag',
    low: 'Low priority',
    medium: 'Medium priority',
    high: 'High priority',
  };
</script>

<button
  type="button"
  class="row-control shrink-0 px-0.5 text-sm"
  class:text-flag-low={priority === 'low'}
  class:text-flag-medium={priority === 'medium'}
  class:text-flag-high={priority === 'high'}
  class:text-ink-faint={priority === 'none'}
  class:opacity-0={priority === 'none'}
  class:group-hover:opacity-100={priority === 'none'}
  class:focus-visible:opacity-100={priority === 'none'}
  aria-label="{LABELS[priority]} — change"
  title={LABELS[priority]}
  data-testid="priority"
  data-priority={priority}
  onclick={() => session.run((tree, ctx) => setPriority(tree, ctx, id, nextPriority(priority)))}
>
  <span aria-hidden="true">{priority === 'none' ? '⚐' : '⚑'}</span>
</button>
