<script lang="ts">
  // A-7. Every tag in the tree, in one place — requirements.md §4.2.
  //
  // The tag bar above the tree (A-4) is the filter *while reading a list*: it
  // shows what is on the page under it and it goes away when the tree holds no
  // tags. This is the other question — "what have I been tagging?" — and it is
  // asked away from any one list, which is why it is a nav entry beside Search
  // rather than a second bar.
  //
  // It stores nothing and derives everything: `tagsInTree` is the same scan the
  // bar runs, and choosing a tag writes the same device-local selection A-5
  // already keeps. Picking one is therefore a filter, not a view of its own —
  // the tree is where the rows are read, and this is the way into it.
  import { matchCount, tagsInTree } from '../core/filter';
  import type { Session } from '../app/Session.svelte';
  import type { ViewState } from '../app/view-state.svelte';

  let { session, view }: { session: Session; view: ViewState } = $props();

  const tags = $derived(tagsInTree(session.tree));
  const active = $derived(view.tagFilter);
  const matched = $derived(active.size === 0 ? 0 : matchCount(session.tree, active));

  /**
   * One tag, not one more: the page is a way *in* to a filtered tree, and a
   * page that built a selection up before it would show anything is one the
   * user has to finish before it answers. Several tags at once is what the
   * bar above the tree is for, where the rows being narrowed are on screen.
   */
  function choose(tag: string): void {
    view.clearTagFilter();
    view.toggleTagFilter(tag);
  }
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6" data-testid="tags-page">
  <h1 class="text-2xl font-semibold" data-testid="page-title">Tags</h1>

  {#if active.size > 0}
    <!-- What the tree is showing right now, said on the page that set it: this
         is the one screen where the filter is not drawn above the rows it is
         narrowing, so it has to say so itself. -->
    <div class="flex flex-wrap items-center gap-2 text-sm" data-testid="tags-active">
      <span class="text-ink-muted">
        The tree is showing {matched} row{matched === 1 ? '' : 's'} with
        {[...active].join(' and ')}.
      </span>
      <button
        type="button"
        class="row-control rounded-md border border-line px-2 py-0.5 text-xs text-ink-muted hover:border-accent hover:text-accent"
        data-testid="tags-clear"
        onclick={() => view.clearTagFilter()}
      >
        Clear
      </button>
    </div>
  {/if}

  {#if tags.length === 0}
    <p class="px-1 text-sm text-ink-muted" data-testid="tags-empty">
      No tags yet. A row is tagged from its ⋮ menu.
    </p>
  {:else}
    <ul class="flex flex-col gap-1">
      {#each tags as row (row.tag)}
        <li>
          <!-- A link, because choosing a tag lands on the tree: the rows are
               read there, and a second list of them here would be A-4's answer
               drawn twice. -->
          <a
            href="#/"
            class="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-sunken"
            class:bg-accent-soft={view.isFiltering(row.tag)}
            class:text-accent={view.isFiltering(row.tag)}
            data-testid="tag-entry"
            data-tag={row.tag}
            onclick={() => choose(row.tag)}
          >
            <!-- The count sits against the tag rather than against the far
                 edge of the column: the two are one fact, and the whole row is
                 still the target. -->
            <span class="min-w-0 max-w-xs truncate text-sm">{row.tag}</span>
            <span class="shrink-0 text-xs text-ink-faint" data-testid="tag-count">
              {row.count} row{row.count === 1 ? '' : 's'}
            </span>
            <span class="flex-1"></span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>
