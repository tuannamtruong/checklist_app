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
  //
  // A-8 is the one piece of grammar in the line: `#errand #town Buy milk` is a
  // row called "Buy milk" carrying two tags. Leading tokens only, and the whole
  // rule is `parseTagged` in `src/core/tags.ts` — this file decides *where* the
  // row goes and never what a tag looks like. It is what tagging at creation is
  // now that A-6's filter is gone: typed rather than inherited, which is a thing
  // the reader did rather than a thing a mode did to them.
  import { createLastChild, createLastChildren } from '../core/edit';
  import { splitPastedTitles } from '../core/paste';
  import { parseTagged } from '../core/tags';
  import type { Kind, ParentId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import type { RowFocus } from './focus.svelte';

  let {
    session,
    focus,
    parent,
    day = null,
    every = null,
    taskOnly = false,
  }: {
    session: Session;
    focus: RowFocus;
    parent: ParentId;
    /** G-5. The day this page files under, and null on every list in the tree. */
    day?: string | null;
    /**
     * R-2. The period this page files under, and null everywhere but Timely: a
     * chore repeats from the moment it exists, or its first tick would have
     * nothing to add to.
     */
    every?: string | null;
    /**
     * R-1. Timely holds check items and nothing else, so the two kind buttons
     * are not drawn there. It is the page saying what its list is rather than a
     * setting — the model refuses the move that would carry another kind in.
     */
    taskOnly?: boolean;
  } = $props();

  let draft = $state('');
  let input = $state<HTMLInputElement | null>(null);

  /**
   * A-8. A line that is *only* tags writes nothing and keeps what was typed:
   * there is no row in `#errand`, and clearing the line would throw away a
   * prefix the reader is halfway through — the title is the next word.
   */
  function commit(): void {
    const { title, tags } = parseTagged(draft);
    if (title === '') return;
    draft = '';
    session.run((tree, ctx) => createLastChild(tree, ctx, parent, { title, tags, day, every }));
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
    // A-8 per line rather than per paste: each line of a pasted list carries
    // its own prefix, and a line that is only tags is no row at all.
    const rows = splitPastedTitles(draft.slice(0, caret) + pasted + draft.slice(end))
      .map((line) => parseTagged(line))
      .filter((row) => row.title !== '');
    draft = '';
    if (rows.length === 0) return;
    session.run((tree, ctx) => createLastChildren(tree, ctx, parent, rows, { day, every }));
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
    // A-8 reads the same prefix here: `#errand Trip` and `+ Note` is one note
    // called "Trip" carrying `errand`. A line of tags alone makes the untitled
    // row the empty line always made, carrying them — the caret lands in its
    // title, which is the word that was missing.
    const { title, tags } = parseTagged(draft);
    draft = '';
    const ops = session.run((tree, ctx) =>
      createLastChild(
        tree,
        ctx,
        parent,
        title === '' ? { kind, tags, day, every } : { kind, title, tags, day, every },
      ),
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
    aria-label="Add a task"
    placeholder="Add a task, or #tag it first"
    data-testid="quick-add"
    onkeydown={onKeyDown}
    onpaste={onPaste}
    onblur={onBlur}
  />
  {#if !taskOnly}
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
  {/if}
</div>
