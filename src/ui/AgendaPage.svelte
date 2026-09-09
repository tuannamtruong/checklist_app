<script lang="ts">
  // G-1 to G-7: Today and Tomorrow, which are one page asked about two days.
  //
  // The rows are ordinary rows under `AGENDA`, so this file adds no rendering:
  // K-8's line at the top and T-14's tree under it, exactly as a list page has
  // them. What it does add is the day — the line files under this page's day
  // (G-5), and the tree draws the items whose day this page is asking about
  // (G-3) — requirements.md §4.4.
  import { agendaIds, dayOfList, type AgendaList } from '../core/agenda';
  import { AGENDA } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import type { ViewState } from '../app/view-state.svelte';
  import type { RowFocus } from './focus.svelte';
  import QuickAdd from './QuickAdd.svelte';
  import TreeView from './TreeView.svelte';

  let {
    session,
    view,
    focus,
    list,
    now,
  }: {
    session: Session;
    view: ViewState;
    focus: RowFocus;
    list: AgendaList;
    /** G-3. The day is asked of a clock the app owns, never of this layer. */
    now: number;
  } = $props();

  const day = $derived(dayOfList(list, now));
  const only = $derived(agendaIds(session.tree, list, now));
  const title = $derived(list === 'today' ? 'Today' : 'Tomorrow');
</script>

<!-- X-26 and X-27, the same header every list page has: pinned, `md` and up,
     because below it the phone's top bar is this group. -->
<header
  class="sticky top-0 z-20 hidden border-b border-line bg-surface px-4 py-3 md:block"
  data-testid="page-header"
>
  <div class="flex max-w-3xl">
    <div class="flex max-w-xl flex-1">
      <QuickAdd {session} {focus} parent={AGENDA} {day} />
    </div>
  </div>
</header>

<!-- X-23. Left-aligned like every other page, so nothing moves sideways. -->
<div class="flex max-w-3xl flex-col gap-4 px-4 py-6" data-testid="agenda-page" data-agenda={list}>
  <h1 class="text-2xl font-semibold" data-testid="page-title">{title}</h1>
  <TreeView {session} {view} {focus} parent={AGENDA} {now} {only} />

  <!-- G-4. An empty day is a state worth saying out loud: the list is empty
       because nothing is filed for it, not because a filter is on. -->
  {#if only.size === 0}
    <p class="px-2 py-6 text-sm text-ink-muted" data-testid="agenda-empty">
      {list === 'today' ? 'Nothing for today.' : 'Nothing for tomorrow yet.'}
    </p>
  {/if}
</div>
