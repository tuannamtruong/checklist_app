<script lang="ts">
  // requirements.md §6. The flat view of the tree, and the only view that
  // reaches a row T-11 or T-7 has taken out of it — which is why every hit says
  // which of the two it is rather than quietly opening a page the tree cannot
  // reach.
  //
  // The query lives in the route (F-5), so a result list is linkable and
  // survives a reload. The route is written as the user types and read only on
  // the way in — see `text` below for why it cannot also be the input's value.
  import { untrack } from 'svelte';
  import { searchTree } from '../core/search';
  import type { Session } from '../app/Session.svelte';
  import { nodeHref } from '../app/router.svelte';
  import KindIcon from './KindIcon.svelte';

  let { session, query, onquery }: {
    session: Session;
    query: string;
    onquery: (next: string) => void;
  } = $props();

  // The input owns what is typed and the route follows it, rather than the
  // other way round: a round trip through `hashchange` on every keystroke puts
  // the caret back to where the browser thinks it should be, which is not where
  // the user left it.
  // `untrack` says the capture is deliberate: the route seeds the box on the
  // way in and is written on the way out, and it must not write back over what
  // is being typed.
  let text = $state(untrack(() => query));
  const hits = $derived(searchTree(session.tree, text));

  let input = $state<HTMLInputElement | null>(null);

  // The caret belongs in the box the moment the page opens: `/` got the user
  // here, and a search page that needs a second click is one they stop using.
  $effect(() => {
    input?.focus();
  });

  function typed(next: string): void {
    text = next;
    onquery(next);
  }

  function pathLabel(path: readonly string[]): string {
    if (path.length === 0) return 'All lists';
    return path.map((id) => session.tree.nodes[id]?.title || 'Untitled').join(' / ');
  }
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6" data-testid="search-page">
  <h1 class="text-2xl font-semibold" data-testid="page-title">Search</h1>

  <input
    bind:this={input}
    type="search"
    class="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
    placeholder="Find a row, or a word in a note"
    aria-label="Search"
    data-testid="search-input"
    value={text}
    oninput={(event) => typed(event.currentTarget.value)}
  />

  {#if text.trim() === ''}
    <p class="px-1 text-sm text-ink-muted" data-testid="search-idle">
      Every term has to match, and a term may match a title or a note's body. Finished and deleted
      rows are here too — this is the only place that still finds them by name.
    </p>
  {:else}
    <p class="px-1 text-xs text-ink-faint" data-testid="search-count">
      {hits.length} {hits.length === 1 ? 'result' : 'results'}
    </p>

    <ul class="flex flex-col gap-1">
      {#each hits as hit (hit.id)}
        {@const node = session.tree.nodes[hit.id]!}
        <li>
          <a
            href={nodeHref(hit.id)}
            class="flex flex-col gap-0.5 rounded-md px-2 py-1.5 hover:bg-surface-sunken"
            data-testid="search-hit"
            data-row-id={hit.id}
            data-field={hit.field}
          >
            <span class="flex items-center gap-2">
              <KindIcon kind={node.kind} class="size-4 shrink-0 text-ink-faint" />
              <span
                class="min-w-0 flex-1 truncate text-sm"
                class:line-through={hit.done}
                data-testid="hit-title"
              >
                {node.title || 'Untitled'}
              </span>
              <!-- F-3: the tree does not show these, so the row has to say why
                   it can still be opened from here. -->
              {#if hit.deleted}
                <span class="shrink-0 rounded-full bg-surface-sunken px-1.5 text-xs text-ink-faint"
                  data-testid="hit-deleted">deleted</span>
              {:else if hit.done}
                <span class="shrink-0 rounded-full bg-surface-sunken px-1.5 text-xs text-ink-faint"
                  data-testid="hit-done">done</span>
              {/if}
            </span>
            {#if hit.snippet}
              <span class="truncate pl-6 text-xs text-ink-muted" data-testid="hit-snippet">
                {hit.snippet}
              </span>
            {/if}
            <span class="truncate pl-6 text-xs text-ink-faint" data-testid="hit-path">
              {pathLabel(hit.path)}
            </span>
          </a>
        </li>
      {:else}
        <li class="px-2 py-3 text-sm text-ink-muted" data-testid="search-empty">
          Nothing matches “{text}”.
        </li>
      {/each}
    </ul>
  {/if}
</div>
