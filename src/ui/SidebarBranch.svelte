<script lang="ts">
  // T-10: the sidebar carries containers only — folders and lists. A note owns
  // children (K-4) but is a place the user goes rather than goes through, and
  // tasks are the bulk of a checklist, so either would bury the navigation.
  //
  // Finished and deleted branches are already gone: childrenOf is the filtered
  // set, so T-11 and T-7 take them out of here without this file knowing.
  import { childrenOf } from '../core/tree';
  import { CONTAINER_KINDS, type ParentId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import { nodeHref } from '../app/router.svelte';
  import KindIcon from './KindIcon.svelte';
  import SidebarBranch from './SidebarBranch.svelte';

  let {
    session,
    parent,
    currentId,
    depth = 0,
    onNavigate,
  }: {
    session: Session;
    parent: ParentId;
    currentId: string | null;
    depth?: number;
    onNavigate?: (() => void) | undefined;
  } = $props();

  const containers = $derived(
    childrenOf(session.tree, parent).filter((id) =>
      CONTAINER_KINDS.includes(session.tree.nodes[id]!.kind),
    ),
  );
</script>

{#each containers as id (id)}
  {@const node = session.tree.nodes[id]!}
  <a
    href={nodeHref(id)}
    class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-sunken"
    class:bg-accent-soft={id === currentId}
    class:text-accent={id === currentId}
    class:text-ink-muted={id !== currentId}
    style="padding-left: {0.5 + depth * 0.75}rem"
    data-testid="sidebar-link"
    data-row-id={id}
    onclick={() => onNavigate?.()}
  >
    <KindIcon kind={node.kind} class="size-4 shrink-0" />
    <span class="truncate">{node.title || 'Untitled'}</span>
  </a>
  <SidebarBranch {session} parent={id} {currentId} depth={depth + 1} {onNavigate} />
{/each}
