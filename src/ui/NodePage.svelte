<script lang="ts">
  // One node's page: its path, its title, its body if it is a note, and its
  // children. The root gets the same page with no node, which is why the tree
  // and the sidebar need no special case for the top level.
  //
  // Since X-21 this is also the *left* pane of a note's route: the list the note
  // hangs under, drawn exactly as it is drawn on its own — requirements.md §10.3.
  import { ROOT, type NodeId, type ParentId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import type { ViewState } from '../app/view-state.svelte';
  import type { RowFocus } from './focus.svelte';
  import Breadcrumbs from './Breadcrumbs.svelte';
  import NoteBody from './NoteBody.svelte';
  import PageTitle from './PageTitle.svelte';
  import QuickAdd from './QuickAdd.svelte';
  import TagEditor from './TagEditor.svelte';
  import TagFilter from './TagFilter.svelte';
  import TreeView from './TreeView.svelte';

  let {
    session,
    view,
    focus,
    id,
  }: { session: Session; view: ViewState; focus: RowFocus; id: NodeId | null } = $props();

  const node = $derived(id === null ? null : session.tree.nodes[id]);
  const parent: ParentId = $derived(id ?? ROOT);
</script>

<!-- K-8. The line is the page's header rather than the list's last row: at a
     fixed place on every list page it is the reflex the app is mostly used for,
     where the end of a long list is below the fold and moves down with every row
     added — requirements.md §4. Narrow, because a full-width input across a
     header reads as a search bar, and at the head of the page's own column
     rather than in the middle of the header, so it does not move sideways when
     the note pane opens beside it — X-23. -->
<header class="border-b border-line px-4 py-3" data-testid="page-header">
  <div class="flex max-w-3xl">
    <div class="flex max-w-sm flex-1">
      <QuickAdd {session} {view} {parent} />
    </div>
  </div>
</header>

<!-- X-23. Left-aligned rather than centred, whether or not a note is open: a
     centred column slides sideways the moment the pane appears, so every open
     and close would move the list under the reader. -->
<div class="flex max-w-3xl flex-col gap-4 px-4 py-6">
  {#if node && id}
    <Breadcrumbs {session} {id} />

    <!-- A-1 and A-2 for the row this page *is*, since its own row is one level
         up and a task's row has no page link — requirements.md §4.1. -->
    <PageTitle {session} {id} />

    <TagEditor {session} {id} />

    <!-- K-4. A note's body, and then whatever it owns, with nothing between
         them: the children read as the note's own list. Changing what this row
         *is* is the row menu's (K-5), one level up, and is the only place it
         ever was — K-6. -->
    {#if node.kind === 'note'}
      <NoteBody {session} {id} />
    {/if}
  {:else}
    <h1 class="text-2xl font-semibold" data-testid="page-title">All lists</h1>
  {/if}

  <!-- A-4. The bar is the tree's, and it sits with the tree — §4.2. -->
  <TagFilter {session} {view} />

  <TreeView {session} {view} {focus} {parent} />
</div>
