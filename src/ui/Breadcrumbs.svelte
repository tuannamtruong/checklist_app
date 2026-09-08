<script lang="ts">
  // T-9. The path climbs the resolved parent, never the stored one: a node
  // repaired out of a cycle has to lead somewhere, and the raw chain would not
  // terminate — sync-flow.md §6.2.
  import { ancestorsOf } from '../core/tree';
  import type { NodeId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import { nodeHref } from '../app/router.svelte';
  import { rootLabelOf } from './paths';

  let { session, id }: { session: Session; id: NodeId } = $props();

  const trail = $derived(ancestorsOf(session.tree, id));
  // G-1. The first crumb is the root this row actually hangs under, which is
  // `All` for the tree and one of the two day lists for an agenda item.
  const root = $derived(rootLabelOf(session.tree, id, Date.now()));
</script>

<nav class="flex flex-wrap items-center gap-1 text-sm text-ink-muted" aria-label="Breadcrumb" data-testid="breadcrumbs">
  <a class="rounded px-1 hover:text-accent hover:underline" href={root.href} data-testid="crumb-root">
    {root.label}
  </a>
  {#each trail as ancestorId (ancestorId)}
    <span aria-hidden="true" class="text-ink-faint">/</span>
    <a class="rounded px-1 hover:text-accent hover:underline" href={nodeHref(ancestorId)}>
      {session.tree.nodes[ancestorId]?.title || 'Untitled'}
    </a>
  {/each}
</nav>
