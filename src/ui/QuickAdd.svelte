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
  //
  // K-10 puts the other two kinds here as well. They were buttons under the
  // list, a scroll away on any list long enough to want one, and one group is
  // what makes adding one place on the page whichever kind is being added.
  import { createLastChild, createLastChildren } from '../core/edit';
  import { splitPastedTitles } from '../core/paste';
  import type { Kind, ParentId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import type { ViewState } from '../app/view-state.svelte';
  import type { RowFocus } from './focus.svelte';

  let {
    session,
    view,
    focus,
    parent,
  }: { session: Session; view: ViewState; focus: RowFocus; parent: ParentId } = $props();

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

  /**
   * K-11. One group is one control, so a kind button makes a row of that kind
   * out of whatever is in the line: a title and `+ Note` is one note carrying
   * it. The caret stays here, exactly as `Enter` leaves it.
   *
   * An empty line is the button as it always was under the list: an untitled
   * row of that kind, holding the caret in its own title field, because a row
   * with no title yet is a row about to be named.
   */
  function addKind(kind: Kind): void {
    const title = draft.trim();
    const tags = [...view.tagFilter];
    draft = '';
    const ops = session.run((tree, ctx) =>
      createLastChild(tree, ctx, parent, title === '' ? { kind, tags } : { kind, title, tags }),
    );
    if (title === '' && ops[0]) focus.request(ops[0].id);
  }

  /**
   * The buttons sit beside an input that commits on blur, so pressing one must
   * not take the caret out of the line on its way to the click: that blur would
   * write the typed title as a task and the button would then add a second row.
   * Preventing `pointerdown`'s default suppresses the focus change on every
   * pointer, and the blur guard is what catches a browser that focuses anyway.
   */
  function keepCaret(event: PointerEvent): void {
    event.preventDefault();
  }

  function onBlur(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof HTMLElement && next.closest('[data-testid="add-row"]')) return;
    commit();
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

<!-- K-10. One group: the line first, because a task is what it makes with no
     button pressed at all, then the two kinds that need one. -->
<div class="flex min-w-0 flex-1 items-center gap-2" data-testid="add-row">
  <input
    bind:this={input}
    bind:value={draft}
    class="min-w-0 flex-1 rounded-md border border-line bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
    placeholder="Add a task — type and press Enter"
    aria-label="Add a task"
    data-testid="quick-add"
    onkeydown={onKeyDown}
    onpaste={onPaste}
    onblur={onBlur}
  />
  <button
    type="button"
    class="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-sm text-ink-muted hover:border-accent hover:text-accent"
    data-testid="add-note"
    onpointerdown={keepCaret}
    onclick={() => addKind('note')}
  >
    + Note
  </button>
  <button
    type="button"
    class="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-sm text-ink-muted hover:border-accent hover:text-accent"
    data-testid="add-folder"
    onpointerdown={keepCaret}
    onclick={() => addKind('folder')}
  >
    + Folder
  </button>
</div>
