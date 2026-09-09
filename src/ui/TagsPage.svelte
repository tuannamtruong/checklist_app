<script lang="ts">
  // A-4 and A-7. The one place a tag narrows anything — requirements.md §4.2.
  //
  // Two things on one page, because they are one question asked twice: every
  // tag in the tree, and the rows carrying the tags chosen from it. It used to
  // hand the choice to a bar above the tree and send the reader there; the tree
  // is the tree now, and this page answers rather than redirecting.
  //
  // The chosen tags ride in the route (`#/tags/<tag>,<tag>`) rather than in this
  // device's storage, for F-5's reason applied to a tag: the fragment reaches no
  // server, so a list of rows survives a reload and pastes into another device.
  //
  // Nothing is indexed and nothing is stored: `tagsInTree` and `taggedRows` are
  // two scans of the materialised tree, exactly as §6's search is (F-4).
  import { taggedRows, tagsInTree } from '../core/filter';
  import type { Session } from '../app/Session.svelte';
  import { nodeHref, tagsHref } from '../app/router.svelte';
  import KindIcon from './KindIcon.svelte';
  import { pathLabelOf } from './paths';

  let { session, tags }: { session: Session; tags: readonly string[] } = $props();

  const catalog = $derived(tagsInTree(session.tree));
  const chosen = $derived(new Set(tags));
  const rows = $derived(taggedRows(session.tree, tags));

  /** A-4 is AND, so a second tag narrows what the first one found. */
  function withoutOrWith(tag: string): string[] {
    return chosen.has(tag) ? tags.filter((one) => one !== tag) : [...tags, tag];
  }
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6" data-testid="tags-page">
  <h1 class="text-2xl font-semibold" data-testid="page-title">Tags</h1>

  {#if catalog.length === 0}
    <p class="px-1 text-sm text-ink-muted" data-testid="tags-empty">
      No tags yet. A row is tagged from its ⋮ menu, or by typing <code>#tag</code> in front of the
      title on the add line.
    </p>
  {:else}
    <!-- Links rather than buttons: the chosen set is the route, so choosing one
         is a navigation and Back walks the choices backwards. -->
    <div class="flex flex-wrap items-center gap-1.5" data-testid="tag-catalog">
      {#each catalog as row (row.tag)}
        <a
          href={tagsHref(withoutOrWith(row.tag))}
          class="rounded-full border px-2 py-0.5 text-xs"
          class:border-accent={chosen.has(row.tag)}
          class:bg-accent-soft={chosen.has(row.tag)}
          class:text-accent={chosen.has(row.tag)}
          class:border-line={!chosen.has(row.tag)}
          class:text-ink-muted={!chosen.has(row.tag)}
          aria-current={chosen.has(row.tag) ? "true" : undefined}
          data-testid="tag-entry"
          data-tag={row.tag}
        >
          {row.tag}
          <span class="text-ink-faint" data-testid="tag-count">{row.count}</span>
        </a>
      {/each}
    </div>

    <!-- F-6's rule, applied to this page: nothing at all until a tag is chosen.
         The chips above are the control and the rows below are the answer, and
         a line explaining that in between is read once and skipped past on
         every visit after it. -->
    {#if tags.length > 0}
      <div class="flex flex-wrap items-center gap-2 px-1">
        <!-- The bar above the tree used to say this. Every selected tag must be
             on the row, and the page says AND rather than letting the reader
             infer it from a result they cannot see — §4.2. -->
        <p class="text-xs text-ink-faint" data-testid="tags-summary">
          {rows.length} row{rows.length === 1 ? '' : 's'} with {tags.join(' and ')}
        </p>
        <a
          href={tagsHref([])}
          class="rounded-md border border-line px-2 py-0.5 text-xs text-ink-muted hover:border-accent hover:text-accent"
          data-testid="tags-clear"
        >
          Clear
        </a>
      </div>

      <!-- The shape §6's hits already have: the row, and the path it sits on.
           A list says *where* a row is, where the filtered tree had to draw its
           ancestors as rows to have somewhere to hang it. -->
      <ul class="flex flex-col gap-1">
        {#each rows as row (row.id)}
          {@const node = session.tree.nodes[row.id]!}
          <li>
            <a
              href={nodeHref(row.id)}
              class="flex flex-col gap-0.5 rounded-md px-2 py-1.5 hover:bg-surface-sunken"
              data-testid="tagged-row"
              data-row-id={row.id}
            >
              <span class="flex items-center gap-2">
                <KindIcon kind={node.kind} class="size-4 shrink-0 text-ink-faint" />
                <span class="min-w-0 flex-1 truncate text-sm">{node.title || 'Untitled'}</span>
              </span>
              <span class="truncate pl-6 text-xs text-ink-faint" data-testid="tagged-path">
                {pathLabelOf(session.tree, row.id, row.path, Date.now())}
              </span>
            </a>
          </li>
        {:else}
          <li class="px-2 py-3 text-sm text-ink-muted" data-testid="tags-none">
            Nothing carries {tags.join(' and ')}.
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
