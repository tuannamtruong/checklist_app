<script lang="ts">
  // One node's page: its path, its title, its body if it is a note, and its
  // children. The root gets the same page with no node, which is why the tree
  // and the sidebar need no special case for the top level.
  import { setTitle, turnInto } from '../core/edit';
  import { ROOT, type NodeId, type ParentId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import type { ViewState } from '../app/view-state.svelte';
  import type { RowFocus } from './focus.svelte';
  import Breadcrumbs from './Breadcrumbs.svelte';
  import NoteBody from './NoteBody.svelte';
  import TreeView from './TreeView.svelte';
  import { kindLabel } from './actions';

  let {
    session,
    view,
    focus,
    id,
  }: { session: Session; view: ViewState; focus: RowFocus; id: NodeId | null } = $props();

  const node = $derived(id === null ? null : session.tree.nodes[id]);
  const parent: ParentId = $derived(id ?? ROOT);

  let titleDraft = $state('');
  let editingTitle = $state(false);

  $effect(() => {
    const title = node?.title ?? '';
    if (!editingTitle) titleDraft = title;
  });
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
  {#if node && id}
    <Breadcrumbs {session} {id} />
    <div class="flex flex-wrap items-center justify-between gap-3">
      <input
        bind:value={titleDraft}
        class="min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none placeholder:text-ink-faint"
        placeholder="Untitled"
        aria-label="Title"
        data-testid="page-title"
        oninput={() => (editingTitle = true)}
        onblur={() => {
          editingTitle = false;
          session.run((tree, ctx) => setTitle(tree, ctx, id, titleDraft));
        }}
      />
      <span class="rounded-full bg-surface-sunken px-2.5 py-1 text-xs text-ink-muted" data-testid="page-kind">
        {kindLabel(node.kind)}
      </span>
    </div>

    {#if node.kind === 'note'}
      <NoteBody {session} {id} />
      <div>
        <!-- K-6: a note that has turned into a checklist keeps its body, so the
             promotion is reversible from the same menu. -->
        <button
          type="button"
          class="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink-muted hover:border-accent hover:text-accent"
          data-testid="promote-to-list"
          onclick={() => session.run((tree, ctx) => turnInto(tree, ctx, id, 'list'))}
        >
          Promote to checklist
        </button>
      </div>
    {/if}

    {#if node.kind === 'note'}
      <h2 class="mt-2 text-sm font-medium text-ink-muted">Checklist</h2>
    {/if}
  {:else}
    <h1 class="text-2xl font-semibold" data-testid="page-title">All lists</h1>
  {/if}

  <TreeView {session} {view} {focus} {parent} />
</div>
