<script lang="ts">
  // A-1 and A-4. What a row's tags look like, and the shortest way into the
  // filter: tapping one asks "everything tagged this", which is the question a
  // tag on a row provokes.
  import type { ViewState } from '../app/view-state.svelte';

  let {
    tags,
    view,
  }: { tags: readonly string[]; view: ViewState } = $props();
</script>

{#each tags as tag (tag)}
  <button
    type="button"
    class="shrink-0 rounded-full border px-1.5 text-xs"
    class:border-accent={view.isFiltering(tag)}
    class:text-accent={view.isFiltering(tag)}
    class:border-line={!view.isFiltering(tag)}
    class:text-ink-muted={!view.isFiltering(tag)}
    aria-pressed={view.isFiltering(tag)}
    data-testid="tag-chip"
    data-tag={tag}
    onclick={() => view.toggleTagFilter(tag)}
  >
    {tag}
  </button>
{/each}
