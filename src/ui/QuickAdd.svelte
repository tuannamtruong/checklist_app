<script lang="ts">
  // K-8. The line in every list page's header: type, press Enter, the row is a
  // task at the end of the list — requirements.md §4. Where the line sits and
  // where the row lands are two questions; only `createLastChild` answers the
  // second, and it is unchanged by the line having moved to the header.
  //
  // It keeps the caret rather than following the row it made, which is what
  // separates it from `Enter` on a row: that key is editing one row and moves
  // to the next, this line is filling a list and stays where it is.
  import { createLastChild } from '../core/edit';
  import type { ParentId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import type { ViewState } from '../app/view-state.svelte';

  let {
    session,
    view,
    parent,
  }: { session: Session; view: ViewState; parent: ParentId } = $props();

  let draft = $state('');

  /** A-6: under a filter, the new row carries it or it is created invisible. */
  function commit(): void {
    const title = draft.trim();
    if (title === '') return;
    draft = '';
    const tags = [...view.tagFilter];
    session.run((tree, ctx) => createLastChild(tree, ctx, parent, { title, tags }));
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      // The one way to throw away what is typed here, matching Escape on a
      // row's title — §4.
      event.preventDefault();
      draft = '';
    }
  }
</script>

<input
  bind:value={draft}
  class="min-w-0 flex-1 rounded-md border border-line bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
  placeholder="Add a task — type and press Enter"
  aria-label="Add a task"
  data-testid="quick-add"
  onkeydown={onKeyDown}
  onblur={commit}
/>
