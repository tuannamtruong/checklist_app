<script lang="ts">
  // K-3's full-page note body, and the two timings that keep it from flooding
  // the log.
  //
  // K-7: 1 s of quiet updates the store. S-20: an op is emitted on blur, on
  // navigating away, or after 60 s of continuous editing. A whole-body op is
  // orders of magnitude larger than a tick, so the emission trigger — not the
  // debounce — is what bounds the log's growth.
  //
  // B-3: the field is edited as text and read as rendered. The textarea is one
  // element that is never unmounted — it lies transparent over the rendered
  // blocks when the caret is elsewhere, so the click that reaches it *is* the
  // click that focuses it. Swapping two elements would drop the focus on the
  // way through, and a rich field would hand the caret to the browser, which is
  // the one thing K-7 and X-10 need to keep — requirements.md §4.3.
  import { onMount, tick } from 'svelte';
  import {
    headingAt,
    nextHeading,
    parseBody,
    setHeading,
    toggleBold,
    toggleCode,
    type Span,
  } from '../core/markup';
  import type { NodeId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import { textRect } from './text-rect';

  /**
   * `compact` is the note pane's floor rather than the page's — X-21. The
   * 16rem minimum exists so a full page's body is a target worth clicking; in a
   * pane the pane's own height already does that job, and on the phone's sheet
   * the floor would eat X-22's 60% before the note had said anything.
   *
   * `fill` is X-31: the field takes the height it is given rather than the
   * height of what is in it. It only means anything inside a flex column with a
   * height of its own — the pane above `lg`, and the sheet once it is expanded —
   * because `flex-1` distributes free space and an auto-height box has none. So
   * the peeked sheet keeps `compact`'s floor and X-22's rule with it, and the
   * caller passes both.
   */
  let {
    session,
    id,
    compact = false,
    fill = false,
  }: { session: Session; id: NodeId; compact?: boolean; fill?: boolean } = $props();

  const floor = $derived(compact ? 'min-h-32' : 'min-h-64');

  const STORE_DEBOUNCE_MS = 1_000;
  /** How long the Copy button says it copied. */
  const COPIED_MS = 1_500;
  const EMIT_AFTER_MS = 60_000;
  /** Between the top of the selected line and the controls above it. */
  const GAP = 8;

  // Filled by the effect below, which is also what keeps it in step with a body
  // that changed from outside.
  let draft = $state('');
  let typing = $state(false);
  /** Whether the caret is in the field, which is what B-3 swaps the view on. */
  let editing = $state(false);
  let field = $state<HTMLTextAreaElement | null>(null);
  /** B-3's rendered half, which `syncScroll` keeps under the field's own scroll. */
  let rendered = $state<HTMLDivElement | null>(null);
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let longEdit: ReturnType<typeof setTimeout> | null = null;

  /** Which code block last said "Copied", so one button answers rather than all of them. */
  let copied = $state<number | null>(null);

  // B-7. Where the selection is, and where on screen its first line begins.
  let start = $state(0);
  let end = $state(0);
  let at = $state<{ top: number; left: number } | null>(null);

  const blocks = $derived(parseBody(draft));
  const level = $derived(headingAt(draft, start));

  // A body changed from outside — a peer's edit, in M2 — shows while this device
  // is not the one typing.
  $effect(() => {
    const body = session.tree.nodes[id]?.body ?? '';
    if (!typing) draft = body;
  });

  /**
   * B-7. A selection is not an input event, and the field fires nothing when
   * the pointer drags a range out of it. `selectionchange` is the one signal
   * that covers a mouse, a keyboard and a long press on a phone alike.
   */
  onMount(() => {
    const onSelect = (): void => {
      if (document.activeElement !== field) return;
      readSelection();
    };
    document.addEventListener('selectionchange', onSelect);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('selectionchange', onSelect);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  });

  function readSelection(): void {
    if (!field) return;
    start = field.selectionStart;
    end = field.selectionEnd;
    place();
  }

  /** The controls sit above the line the selection starts on, or below it at the top of the page. */
  function place(): void {
    if (!field || start === end) {
      at = null;
      return;
    }
    const rect = textRect(field, start);
    if (rect === null) {
      at = null;
      return;
    }
    const box = field.getBoundingClientRect();
    // A selection scrolled out of the field would otherwise put the controls
    // over the page around it.
    if (rect.top + rect.height < box.top || rect.top > box.bottom) {
      at = null;
      return;
    }
    at = { top: rect.top - GAP, left: rect.left };
  }

  /**
   * B-3 draws one value in two boxes, and X-31's `fill` gives each of them a
   * scrollbar rather than one page that scrolls both. The transparent field is
   * the one on top, so it is the one the wheel reaches: the rendered view under
   * it is moved to match, or a note longer than the pane would sit frozen while
   * the field scrolled invisibly behind it.
   */
  function syncScroll(): void {
    if (rendered && field) rendered.scrollTop = field.scrollTop;
  }

  // And once more when the rendered half comes back, since the caret leaving
  // mounts a fresh element at the top of a body the reader had scrolled.
  $effect(() => {
    if (rendered) syncScroll();
  });

  function onScroll(): void {
    syncScroll();
    place();
  }

  function stopTimers(): void {
    if (debounce !== null) clearTimeout(debounce);
    if (longEdit !== null) clearTimeout(longEdit);
    debounce = null;
    longEdit = null;
  }

  function onInput(): void {
    typing = true;
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => session.stageBody(id, draft), STORE_DEBOUNCE_MS);
    if (longEdit === null) {
      longEdit = setTimeout(() => {
        session.stageBody(id, draft);
        session.commitBody(id);
        longEdit = null;
      }, EMIT_AFTER_MS);
    }
  }

  function onBlur(): void {
    stopTimers();
    typing = false;
    editing = false;
    at = null;
    session.stageBody(id, draft);
    session.commitBody(id);
  }

  /**
   * B-4. A control writes marks into the text and puts the caret back where the
   * edit left it, so it costs the field's own undo nothing: what a button did,
   * `Ctrl-Z` undoes, because it is only typing.
   */
  async function apply(edit: { text: string; start: number; end: number }): Promise<void> {
    draft = edit.text;
    onInput();
    await tick();
    // The caret is put back only if it is still here. A control keeps the focus
    // it never took (`keepCaret`), so this is the ordinary path — but the row of
    // controls is on screen whether the field has the caret or not, and an edit
    // made from outside it has no blur coming to emit its op (S-20). It emits
    // its own, or a reload would be the thing that lost it.
    if (!field || document.activeElement !== field) {
      session.stageBody(id, draft);
      session.commitBody(id);
      return;
    }
    field.setSelectionRange(edit.start, edit.end);
    readSelection();
  }

  function bold(): void {
    if (!field) return;
    void apply(toggleBold(draft, field.selectionStart, field.selectionEnd));
  }

  /**
   * B-8, B-9. One control for both code marks: `toggleCode` reads the selection
   * to decide which one, so a word becomes `` `code` `` and a caret becomes a
   * box — requirements.md §4.3.
   */
  function code(): void {
    if (!field) return;
    void apply(toggleCode(draft, field.selectionStart, field.selectionEnd));
  }

  /**
   * B-8. The one thing on the rendered half that is not a second drawing of the
   * text: a block of code is copied rather than read, and selecting it in the
   * field beneath means dragging over a box drawn on top of it.
   */
  async function copyCode(index: number, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copied = index;
      setTimeout(() => {
        if (copied === index) copied = null;
      }, COPIED_MS);
    } catch {
      // A clipboard the browser refuses is a button that does nothing rather
      // than an error over a note: the text is still in the field below it.
    }
  }

  /** One control, three states — `nextHeading` is the cycle, A-2's flag the precedent. */
  function heading(): void {
    if (!field) return;
    void apply(setHeading(draft, field.selectionStart, field.selectionEnd, nextHeading(level)));
  }

  function onKeyDown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      bold();
    }
  }

  /**
   * A control must not take the focus, or the blur it causes would commit the
   * body and move the caret out of the text the control is about to edit.
   */
  function keepCaret(event: MouseEvent): void {
    event.preventDefault();
  }

  const headingLabel = $derived(level === 0 ? 'H' : level === 1 ? 'H1' : 'H2');
</script>

<!-- The bold, code and plain runs of one line. One snippet rather than the same
     three branches under every block kind — and written tight, because a line
     break between two spans is a space the body never had. -->
{#snippet runs(spans: readonly Span[])}{#each spans as span, i (i)}{#if span.code}<code
        class="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[0.9em] text-ink"
        >{span.text}</code
      >{:else if span.bold}<strong class="font-semibold">{span.text}</strong>{:else}{span.text}{/if}{/each}{/snippet}

<!-- B-4. The controls are always here rather than only while the caret is in
     the field: a phone has no Ctrl key, so this row is the only way to reach
     them with nothing selected — requirements.md §3.1 applied to a body rather
     than to a row. B-7's pair is these same controls, at the selection. -->
<div class="mb-2 flex gap-1" data-testid="note-controls">
  <button
    type="button"
    class="row-control rounded border border-line px-2 py-1 text-xs font-bold text-ink-muted hover:border-accent hover:text-accent"
    aria-label="Bold"
    title="Bold — Ctrl-B"
    data-testid="mark-bold"
    onmousedown={keepCaret}
    onclick={bold}
  >
    B
  </button>
  <button
    type="button"
    class="row-control rounded border border-line px-2 py-1 text-xs font-semibold text-ink-muted hover:border-accent hover:text-accent"
    class:border-accent={level !== 0}
    class:text-accent={level !== 0}
    aria-label="Heading"
    title="Heading — none, heading, subheading"
    data-testid="mark-heading"
    data-level={level}
    onmousedown={keepCaret}
    onclick={heading}
  >
    {headingLabel}
  </button>
  <!-- B-8, B-9. One control for two marks: what it writes is decided by what is
       selected, which is `toggleCode`'s rule and not this button's. -->
  <button
    type="button"
    class="row-control rounded border border-line px-2 py-1 font-mono text-xs text-ink-muted hover:border-accent hover:text-accent"
    aria-label="Code"
    title="Code — a run inside a line, or a box of its own"
    data-testid="mark-code"
    onmousedown={keepCaret}
    onclick={code}
  >
    {'</>'}
  </button>
</div>

<!-- X-31's `fill` grows this box to the pane's height, and the floor is what
     stops it collapsing on a sheet that has no height to give.

     The field's own height is one expression in the class string and never a
     `class:h-full` beside it: a `class:` directive toggles that class *off*
     when its condition is false, whatever the string said, so a directive
     written for the overlay would take the height away from the field the
     moment the caret arrived and the note would be edited through two rows. -->
<div class="relative {fill ? `flex-1 ${floor}` : ''}">
  <!-- The rendered view is what the same value looks like, so it is hidden from
       assistive technology: the textarea below carries the text itself, and one
       value announced twice is one value too many. -->
  {#if !editing}
    <!-- `break-words` because the rendered view has to wrap everywhere the
         textarea over it does. A browser wraps a textarea's long run for us and
         wraps a paragraph's only between words, so a body with no spaces in it —
         a pasted URL, a key, a line of one repeated letter — was drawn running
         off the pane's right edge and clipped, and no width the divider could
         reach would ever have been enough. Marks are what B-2 keeps in the
         string; a line too long to fit is not one of them. -->
    <div
      bind:this={rendered}
      class="w-full rounded-lg border border-line bg-surface-raised p-3 text-sm leading-relaxed break-words {fill
        ? 'h-full overflow-y-auto'
        : floor}"
      aria-hidden="true"
      data-testid="note-rendered"
    >
      {#each blocks as block, index (index)}
        {#if block.kind === 'code'}
          <!-- B-8. The one thing here that is not a second drawing of the text:
               a block of code is copied rather than read. The button is
               `tabindex="-1"` inside this `aria-hidden` half, because the text
               itself is in the field beneath — which is what a screen reader
               reads and where Ctrl-C already works — and it is lifted over that
               field, which otherwise takes every click in this box. -->
          <div
            class="my-2 overflow-hidden rounded-lg border border-line bg-surface-sunken"
            data-testid="code-block"
          >
            <div class="flex items-center justify-between gap-2 px-3 pt-2 text-xs text-ink-faint">
              <span>Code</span>
              <button
                type="button"
                class="relative z-20 rounded px-1.5 py-0.5 hover:text-accent"
                tabindex="-1"
                data-testid="code-copy"
                onmousedown={keepCaret}
                onclick={() => void copyCode(index, block.spans[0]?.text ?? '')}
              >
                {copied === index ? 'Copied' : '⧉ Copy'}
              </button>
            </div>
            <pre
              class="overflow-x-auto px-3 pt-1 pb-3 font-mono text-xs leading-relaxed text-ink"><code
                >{block.spans[0]?.text ?? ''}</code
              ></pre>
          </div>
        {:else if block.kind === 'heading1'}
          <h3 class="mt-3 mb-1 text-base font-semibold first:mt-0">{@render runs(block.spans)}</h3>
        {:else if block.kind === 'heading2'}
          <h4 class="mt-2 mb-1 text-sm font-semibold text-ink-muted first:mt-0">
            {@render runs(block.spans)}
          </h4>
        {:else}
          <p>{#if block.spans.length > 0}{@render runs(block.spans)}{:else}&nbsp;{/if}</p>
        {/if}
      {/each}
    </div>
  {/if}

  <textarea
    bind:this={field}
    bind:value={draft}
    class="w-full rounded-lg border border-line bg-surface-raised p-3 text-sm leading-relaxed outline-none focus:border-accent {!editing ||
    fill
      ? 'h-full'
      : floor}"
    class:resize-y={editing && !fill}
    class:absolute={!editing}
    class:inset-0={!editing}
    class:resize-none={!editing || fill}
    class:opacity-0={!editing}
    aria-label="Note body"
    data-testid="note-body"
    oninput={onInput}
    onkeydown={onKeyDown}
    onselect={readSelection}
    onscroll={onScroll}
    onfocus={() => {
      editing = true;
      readSelection();
    }}
    onblur={onBlur}
  ></textarea>
</div>

<!-- B-7. Selected text is a question about those words, so the answer is beside
     them rather than at the top of the page — and it is the same controls,
     because a second vocabulary for one edit is a second thing to learn. -->
{#if at}
  <div
    class="fixed z-20 flex -translate-y-full gap-1 rounded-md border border-line bg-surface-raised p-1 shadow-lg"
    style="top: {at.top}px; left: {at.left}px"
    data-testid="selection-controls"
  >
    <button
      type="button"
      class="row-control rounded px-2 py-1 text-xs font-bold text-ink hover:bg-surface-sunken hover:text-accent"
      aria-label="Bold"
      data-testid="selection-bold"
      onmousedown={keepCaret}
      onclick={bold}
    >
      B
    </button>
    <button
      type="button"
      class="row-control rounded px-2 py-1 text-xs font-semibold text-ink hover:bg-surface-sunken hover:text-accent"
      class:text-accent={level !== 0}
      aria-label="Heading"
      data-testid="selection-heading"
      data-level={level}
      onmousedown={keepCaret}
      onclick={heading}
    >
      {headingLabel}
    </button>
    <button
      type="button"
      class="row-control rounded px-2 py-1 font-mono text-xs text-ink hover:bg-surface-sunken hover:text-accent"
      aria-label="Code"
      data-testid="selection-code"
      onmousedown={keepCaret}
      onclick={code}
    >
      {'</>'}
    </button>
  </div>
{/if}
