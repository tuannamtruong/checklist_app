<script lang="ts">
  // T-10: the sidebar carries the top-level folders and notes, and under each of
  // them its immediate folder and note children — two levels, and nothing
  // deeper. It is the way back to the few places worth starting from, not a
  // second copy of the tree: a tree that is unlimited in depth (T-1) is
  // unlimited in this column too, and the nav below it goes off the bottom of
  // the screen long before the tree does. A *fixed* second level is bounded the
  // way a mirrored one is not, and it is where the second place worth starting
  // usually sits. The tree view draws the rest of the nesting and breadcrumbs
  // (T-9) climb back out of it.
  //
  // T-17: that second level starts closed, so a device that never opens one
  // draws exactly the column it drew before. Which rows are open is this
  // device's own and is not T-8's collapse state — past_decision.md §17.
  //
  // Finished and deleted branches are already gone: sidebarChildren reads the
  // filtered set, so T-11 and T-7 take them out of here without this file
  // knowing.
  import { sidebarChildren } from '../core/tree';
  import { ROOT, type NodeId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import type { ViewState } from '../app/view-state.svelte';
  import { nodeHref } from '../app/router.svelte';
  import KindIcon from './KindIcon.svelte';

  let {
    session,
    view,
    currentId,
    onNavigate,
  }: {
    session: Session;
    view: ViewState;
    currentId: string | null;
    onNavigate?: (() => void) | undefined;
  } = $props();

  const links = $derived(sidebarChildren(session.tree, ROOT));
</script>

{#snippet entry(id: NodeId, nested: boolean)}
  {@const node = session.tree.nodes[id]!}
  <a
    href={nodeHref(id)}
    class="sidebar-text flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-sunken"
    class:bg-accent-soft={id === currentId}
    class:text-accent={id === currentId}
    class:text-ink-muted={id !== currentId}
    data-testid="sidebar-link"
    data-sidebar-depth={nested ? 1 : 0}
    data-row-id={id}
    onclick={() => onNavigate?.()}
  >
    <KindIcon kind={node.kind} class="sidebar-icon" />
    <span class="truncate">{node.title || 'Untitled'}</span>
  </a>
{/snippet}

{#each links as id (id)}
  {@const children = sidebarChildren(session.tree, id)}
  {@const open = view.isSidebarOpen(id)}
  <div class="flex items-center">
    <!-- Drawn on every row and hidden on the childless ones, so the titles keep
         one left edge rather than stepping in and out with the tree. -->
    <button
      type="button"
      class="row-control row-icon sidebar-disclosure rounded text-ink-faint hover:text-ink"
      class:invisible={children.length === 0}
      aria-label={open ? 'Collapse' : 'Expand'}
      aria-expanded={children.length > 0 ? open : undefined}
      data-testid="sidebar-disclosure"
      data-row-id={id}
      onclick={() => view.toggleSidebarOpen(id)}
    >
      <span class="inline-block transition-transform" class:-rotate-90={!open} aria-hidden="true">▾</span>
    </button>
    {@render entry(id, false)}
  </div>

  {#if open}
    {#each children as childId (childId)}
      <div class="sidebar-indent flex items-center">
        {@render entry(childId, true)}
      </div>
    {/each}
  {/if}
{/each}
