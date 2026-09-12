<script lang="ts">
  // One node's page: its path, its title and its children. The root gets the
  // same page with no node, which is why the tree and the sidebar need no
  // special case for the top level.
  //
  // Since X-21 this is also the *left* pane of a body's route: the list the row
  // hangs under, drawn exactly as it is drawn on its own — requirements.md
  // §10.3. That is also why no body is drawn here. `panesFor` hands this page
  // the nearest list *above* a row that has one, so the id it is given never has
  // a body of its own, and the editor for one lives in the pane — X-31.
  import { ROOT, type NodeId, type ParentId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import type { ViewState } from '../app/view-state.svelte';
  import type { RowFocus } from './focus.svelte';
  import Breadcrumbs from './Breadcrumbs.svelte';
  import PageTitle from './PageTitle.svelte';
  import QuickAdd from './QuickAdd.svelte';
  import TagEditor from './TagEditor.svelte';
  import TreeView from './TreeView.svelte';

  let {
    session,
    view,
    focus,
    id,
    now,
  }: {
    session: Session;
    view: ViewState;
    focus: RowFocus;
    id: NodeId | null;
    /** Handed down to the rows, which is where a day is asked about — TreeView. */
    now: number;
  } = $props();

  const node = $derived(id === null ? null : session.tree.nodes[id]);
  const parent: ParentId = $derived(id ?? ROOT);
</script>

<!-- K-8. The line is the page's header rather than the list's last row: at a
     fixed place on every list page it is the reflex the app is mostly used for,
     where the end of a long list is below the fold and moves down with every row
     added — requirements.md §4. Narrow, because a full-width input across a
     header reads as a search bar, and at the head of the page's own column
     rather than in the middle of the header, so it does not move sideways when
     the note pane opens beside it — X-23.

     K-10 puts the two kind buttons in it, and X-26 pins the header to the top of
     the window: one `sticky` and an opaque surface, so the one control the app is
     mostly used for is where it was however far the list has scrolled.

     `md` and up only: below it the group is the phone's top bar rather than a
     second header under it — X-27, and one group at either width. -->
<header
  class="sticky top-0 z-20 hidden border-b border-line bg-surface px-4 py-3 md:block"
  data-testid="page-header"
>
  <div class="flex max-w-3xl">
    <div class="flex max-w-xl flex-1">
      <QuickAdd {session} {focus} {parent} />
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

  {:else}
    <h1 class="text-2xl font-semibold" data-testid="page-title">All</h1>
  {/if}

  <TreeView {session} {view} {focus} {parent} {now} />
</div>
