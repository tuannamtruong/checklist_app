<script lang="ts">
  // T-9. The path climbs the resolved parent, never the stored one: a node
  // repaired out of a cycle has to lead somewhere, and the raw chain would not
  // terminate — sync-flow.md §6.2.
  import { ancestorsOf } from '../core/tree';
  import type { NodeId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import { nodeHref } from '../app/router.svelte';

  let { session, id }: { session: Session; id: NodeId } = $props();

  const trail = $derived(ancestorsOf(session.tree, id));
</script>

<nav class="flex flex-wrap items-center gap-1 text-sm text-ink-muted" aria-label="Breadcrumb" data-testid="breadcrumbs">
  <a class="rounded px-1 hover:text-accent hover:underline" href="#/">All lists</a>
  {#each trail as ancestorId (ancestorId)}
    <span aria-hidden="true" class="text-ink-faint">/</span>
    <a class="rounded px-1 hover:text-accent hover:underline" href={nodeHref(ancestorId)}>
      {session.tree.nodes[ancestorId]?.title || 'Untitled'}
    </a>
  {/each}
</nav>
