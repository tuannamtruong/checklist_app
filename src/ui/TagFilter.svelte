<script lang="ts">
  // A-4. The tag bar above the tree: every tag in the tree, most used first,
  // and what is selected is what the tree is showing — requirements.md §4.2.
  //
  // It renders nothing when the tree holds no tags, which is what makes it
  // costless for someone who never uses them.
  import { matchCount, tagsInTree } from '../core/filter';
  import type { Session } from '../app/Session.svelte';
  import type { ViewState } from '../app/view-state.svelte';

  let { session, view }: { session: Session; view: ViewState } = $props();

  const tags = $derived(tagsInTree(session.tree));
  const active = $derived(view.tagFilter);
  const matched = $derived(active.size === 0 ? 0 : matchCount(session.tree, active));
</script>

{#if tags.length > 0}
  <div class="flex flex-wrap items-center gap-1.5" data-testid="tag-filter">
    <span class="text-xs text-ink-faint">Tags</span>
    {#each tags as row (row.tag)}
      <button
        type="button"
        class="rounded-full border px-2 py-0.5 text-xs"
        class:border-accent={view.isFiltering(row.tag)}
        class:bg-accent-soft={view.isFiltering(row.tag)}
        class:text-accent={view.isFiltering(row.tag)}
        class:border-line={!view.isFiltering(row.tag)}
        class:text-ink-muted={!view.isFiltering(row.tag)}
        aria-pressed={view.isFiltering(row.tag)}
        data-testid="filter-tag"
        data-tag={row.tag}
        onclick={() => view.toggleTagFilter(row.tag)}
      >
        {row.tag}
        <span class="text-ink-faint">{row.count}</span>
      </button>
    {/each}

    <!-- Every selected tag must be on the row, so the bar says AND rather than
         letting the user infer it from a result they cannot see — §4.2. -->
    {#if active.size > 0}
      <span class="text-xs text-ink-muted" data-testid="filter-summary">
        {matched} row{matched === 1 ? '' : 's'} with
        {[...active].join(' and ')}
      </span>
      <button
        type="button"
        class="rounded-md border border-line px-2 py-0.5 text-xs text-ink-muted hover:border-accent hover:text-accent"
        data-testid="filter-clear"
        onclick={() => view.clearTagFilter()}
      >
        Clear
      </button>
    {/if}
  </div>
{/if}
