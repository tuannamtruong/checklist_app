<script lang="ts">
  // T-10: the sidebar carries the top-level folders and the top-level notes,
  // and nothing deeper. It is the way back to the few places worth starting
  // from, not a second copy of the tree — a tree that is unlimited in depth
  // (T-1) is unlimited in this column too, and the nav below it goes off the
  // bottom of the screen long before the tree does. The tree view draws the
  // nesting and breadcrumbs (T-9) climb back out of it.
  //
  // Finished and deleted branches are already gone: childrenOf is the filtered
  // set, so T-11 and T-7 take them out of here without this file knowing.
  import { childrenOf } from '../core/tree';
  import { ROOT, SIDEBAR_KINDS } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import { nodeHref } from '../app/router.svelte';
  import KindIcon from './KindIcon.svelte';

  let {
    session,
    currentId,
    onNavigate,
  }: {
    session: Session;
    currentId: string | null;
    onNavigate?: (() => void) | undefined;
  } = $props();

  const links = $derived(
    childrenOf(session.tree, ROOT).filter((id) =>
      SIDEBAR_KINDS.includes(session.tree.nodes[id]!.kind),
    ),
  );
</script>

{#each links as id (id)}
  {@const node = session.tree.nodes[id]!}
  <a
    href={nodeHref(id)}
    class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-sunken"
    class:bg-accent-soft={id === currentId}
    class:text-accent={id === currentId}
    class:text-ink-muted={id !== currentId}
    data-testid="sidebar-link"
    data-row-id={id}
    onclick={() => onNavigate?.()}
  >
    <KindIcon kind={node.kind} class="size-4 shrink-0" />
    <span class="truncate">{node.title || 'Untitled'}</span>
  </a>
{/each}
