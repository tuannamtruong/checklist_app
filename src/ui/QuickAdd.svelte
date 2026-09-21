<script lang="ts">
  // K-8. The line in every list page's header: type, press Enter, the row is a
  // task at the end of the list — requirements.md §4. Where the line sits and
  // where the row lands are two questions; only `createLastChild` answers the
  // second, and it is unchanged by the line having moved to the header.
  //
  // It keeps the caret rather than following the row it made, which is what
  // separates it from `Enter` on a row: that key is editing one row and moves
  // to the next, this line is filling a list and stays where it is.
  //
  // K-9 is the same line asked for several rows at once: a paste with a line
  // break in it is a list somebody already wrote, and typing Enter after each
  // line of it is work the paste already did.
  import { createLastChild, createLastChildren } from '../core/edit';
  import { splitPastedTitles } from '../core/paste';
  import type { ParentId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import type { ViewState } from '../app/view-state.svelte';

  let {
    session,
    view,
    parent,
  }: { session: Session; view: ViewState; parent: ParentId } = $props();

  let draft = $state('');
  let input = $state<HTMLInputElement | null>(null);

  /** A-6: under a filter, the new row carries it or it is created invisible. */
  function commit(): void {
    const title = draft.trim();
    if (title === '') return;
    draft = '';
    const tags = [...view.tagFilter];
    session.run((tree, ctx) => createLastChild(tree, ctx, parent, { title, tags }));
  }

  /**
   * K-9. A paste carrying a line break is a paragraph, and every line of it is
   * a row. Anything already in the line is part of it, split at the caret: the
   * browser would have put the text there, and a paste after "Buy " has to mean
   * "Buy milk" rather than losing the two words in front of it.
   *
   * A paste with no line break in it is left entirely alone — that is an
   * ordinary paste into an input, and nothing is written until Enter or blur.
   */
  function onPaste(event: ClipboardEvent): void {
    const pasted = event.clipboardData?.getData('text/plain') ?? '';
    if (!/[\r\n]/.test(pasted)) return;
    event.preventDefault();
    const caret = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? draft.length;
    const titles = splitPastedTitles(draft.slice(0, caret) + pasted + draft.slice(end));
    draft = '';
    if (titles.length === 0) return;
    const tags = [...view.tagFilter];
    session.run((tree, ctx) => createLastChildren(tree, ctx, parent, titles, { tags }));
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
  bind:this={input}
  bind:value={draft}
  class="min-w-0 flex-1 rounded-md border border-line bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
  placeholder="Add a task — type and press Enter"
  aria-label="Add a task"
  data-testid="quick-add"
  onkeydown={onKeyDown}
  onpaste={onPaste}
  onblur={commit}
/>
