<script lang="ts">
  // The editable title of the node a page or a pane *is*, and A-2's flag beside
  // it. Both belong here rather than on the row, because the row is one level up
  // and the page is where the node is the subject — requirements.md §4.1.
  //
  // It is one component and not two copies of one because X-21 put a second
  // node on screen: the list on the left and the note on the right are the same
  // heading with the same draft rule — §10.3.
  import { setTitle } from '../core/edit';
  import type { NodeId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import PriorityFlag from './PriorityFlag.svelte';

  let { session, id }: { session: Session; id: NodeId } = $props();

  const node = $derived(session.tree.nodes[id]);

  // The same draft rule the rows use: a title arriving from a peer shows, but
  // never over what this device is halfway through typing — X-10 with a caret.
  let draft = $state('');
  let editing = $state(false);

  $effect(() => {
    const title = node?.title ?? '';
    if (!editing) draft = title;
  });
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
  <input
    bind:value={draft}
    class="min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none placeholder:text-ink-faint"
    placeholder="Untitled"
    aria-label="Title"
    data-testid="page-title"
    oninput={() => (editing = true)}
    onblur={() => {
      editing = false;
      session.run((tree, ctx) => setTitle(tree, ctx, id, draft));
    }}
  />
  <PriorityFlag {session} {id} priority={node?.priority ?? 'none'} />
</div>
