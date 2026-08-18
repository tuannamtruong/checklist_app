<script lang="ts">
  // K-2: a task renders a real checkbox and the other three render an icon that
  // says which one they are. Nothing else distinguishes them structurally — any
  // kind may own children.
  //
  // The task shape here is the empty box, and it is drawn only where a working
  // checkbox would lie: a deleted row in the Done view (T-12), which cannot be
  // ticked because there is nothing left to tick.
  import type { Kind } from '../core/types';

  let { kind, class: className = '' }: { kind: Kind; class?: string } = $props();
</script>

{#if kind === 'folder'}
  <svg class={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M2.5 5.5A1.5 1.5 0 0 1 4 4h3.2l1.4 1.8H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 15.8H4a1.5 1.5 0 0 1-1.5-1.5z"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linejoin="round"
    />
  </svg>
{:else if kind === 'list'}
  <svg class={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M6.5 5.5h9M6.5 10h9M6.5 14.5h9M3.5 5.5h.01M3.5 10h.01M3.5 14.5h.01"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
    />
  </svg>
{:else if kind === 'note'}
  <svg class={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M5 2.8h7.2L16 6.6v10.6H5z"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linejoin="round"
    />
    <path d="M12 2.8v4h4M7.5 10.5h5M7.5 13.5h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
  </svg>
{:else if kind === 'task'}
  <svg class={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect x="3.7" y="3.7" width="12.6" height="12.6" rx="2.6" stroke="currentColor" stroke-width="1.4" />
  </svg>
{/if}
