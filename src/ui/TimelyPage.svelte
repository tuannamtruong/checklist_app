<script lang="ts">
  // R-1 to R-8: Timely, the third list that is not the tree.
  //
  // Like the agenda's page this adds no rendering of its own: K-8's line at the
  // top and T-14's tree under it, exactly as a list page has them. What it adds
  // is the period — the line files a row that repeats from the moment it exists
  // (R-2) — and the two things the list refuses: a kind other than a task, and a
  // second level. Both are `canMoveTo`'s rather than this file's, so the tree
  // view under it is the ordinary one — requirements.md §4.5.
  import { TIMELY } from '../core/types';
  import { DEFAULT_PERIOD, formatPeriod } from '../core/timely';
  import type { Session } from '../app/Session.svelte';
  import type { ViewState } from '../app/view-state.svelte';
  import type { RowFocus } from './focus.svelte';
  import QuickAdd from './QuickAdd.svelte';
  import TreeView from './TreeView.svelte';

  let {
    session,
    view,
    focus,
    now,
  }: {
    session: Session;
    view: ViewState;
    focus: RowFocus;
    /** R-4. The day is asked of a clock the app owns, never of the logic layer. */
    now: number;
  } = $props();

  const every = formatPeriod(DEFAULT_PERIOD);
</script>

<!-- X-26 and X-27, the same header every list page has: pinned, `md` and up,
     because below it the phone's top bar is this group. -->
<header
  class="sticky top-0 z-20 hidden border-b border-line bg-surface px-4 py-3 md:block"
  data-testid="page-header"
>
  <div class="flex max-w-3xl">
    <div class="flex max-w-xl flex-1">
      <QuickAdd {session} {focus} parent={TIMELY} {every} taskOnly />
    </div>
  </div>
</header>

<!-- X-23. Left-aligned like every other page, so nothing moves sideways. -->
<div class="flex max-w-3xl flex-col gap-4 px-4 py-6" data-testid="timely-page">
  <h1 class="text-2xl font-semibold" data-testid="page-title">Timely</h1>

  <TreeView {session} {view} {focus} parent={TIMELY} {now} />
</div>
