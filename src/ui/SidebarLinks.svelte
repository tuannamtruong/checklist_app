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
  // T-18: every entry carries the same `⋮` menu the tree's rows do. A sidebar
  // row is one of the few rows a person sees all day and it was the only one
  // with nothing but a link on it — renaming a top-level folder meant navigating
  // to a page to reach a row that was already on screen. It is the *same*
  // component over the same `actions.ts` list, so what the menu offers here is
  // whatever it offers anywhere, and nothing new can drift into it.
  //
  // Finished and deleted branches are already gone: sidebarChildren reads the
  // filtered set, so T-11 and T-7 take them out of here without this file
  // knowing.
  import { sidebarChildren } from '../core/tree';
  import { ROOT, type NodeId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import type { ViewState } from '../app/view-state.svelte';
  import { nodeHref } from '../app/router.svelte';
  import type { RowFocus } from './focus.svelte';
  import KindIcon from './KindIcon.svelte';
  import RowMenu from './RowMenu.svelte';

  let {
    session,
    view,
    focus,
    now,
    currentId,
    onNavigate,
  }: {
    session: Session;
    view: ViewState;
    /** T-18. The menu's edits put the caret on what they made, as they do anywhere. */
    focus: RowFocus;
    /** T-18. G-6's and R-4's clock, handed down as every other caller hands it. */
    now: number;
    currentId: string | null;
    onNavigate?: (() => void) | undefined;
  } = $props();

  const links = $derived(sidebarChildren(session.tree, ROOT));

  /**
   * T-18. The context the menu runs against. `rows` is empty and stays empty:
   * it exists so that deleting a row can put the caret on the one above it, and
   * this column has no caret in it — the tree's rows are where a title is typed.
   * `editRepeat` is absent for the reason `actions.ts` already gives: it opens
   * a field *on the row*, and a nav entry has nowhere to put one — the menu
   * shows it disabled rather than lying about where the period lives. It never
   * comes up here anyway: R-7's entry is a timely row's, and nothing in Timely
   * is in this column.
   */
  function ctxFor(id: NodeId) {
    return { session, view, focus, rows: [], id, now };
  }
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
    <RowMenu ctx={ctxFor(id)} />
  </div>

  {#if open}
    {#each children as childId (childId)}
      <div class="sidebar-indent flex items-center">
        {@render entry(childId, true)}
        <RowMenu ctx={ctxFor(childId)} />
      </div>
    {/each}
  {/if}
{/each}
