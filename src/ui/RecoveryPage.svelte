<script lang="ts">
  // X-11. A link can outlive the row it points at — the row was deleted here, or
  // deleted on another device and the deletion arrived. Either way the app owes
  // a page rather than a blank screen or a thrown error.
  import type { Session } from '../app/Session.svelte';

  let { session, id }: { session: Session; id: string | null } = $props();

  const node = $derived(id === null ? undefined : session.tree.nodes[id]);
  const wasDeleted = $derived(node !== undefined);
</script>

<div class="mx-auto flex max-w-3xl flex-col items-start gap-3 px-4 py-16" data-testid="recovery">
  <h1 class="text-xl font-semibold">
    {wasDeleted ? 'This row was deleted' : 'Nothing here'}
  </h1>
  <p class="text-sm text-ink-muted">
    {#if wasDeleted}
      “{node?.title || 'Untitled'}” and everything inside it was deleted. Deleted rows are kept rather
      than removed, so this link will keep working even though the row is gone.
    {:else}
      That link does not name a row this device knows about. It may belong to a device whose file has
      not arrived yet.
    {/if}
  </p>
  <a class="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent hover:text-accent" href="#/">
    Back to all lists
  </a>
</div>
