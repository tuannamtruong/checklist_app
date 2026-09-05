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
  import { tick } from 'svelte';
  import { headingAt, parseBody, setHeading, toggleBold, type HeadingLevel } from '../core/markup';
  import type { NodeId } from '../core/types';
  import type { Session } from '../app/Session.svelte';

  let { session, id }: { session: Session; id: NodeId } = $props();

  const STORE_DEBOUNCE_MS = 1_000;
  const EMIT_AFTER_MS = 60_000;

  // Filled by the effect below, which is also what keeps it in step with a body
  // that changed from outside.
  let draft = $state('');
  let typing = $state(false);
  /** Whether the caret is in the field, which is what B-3 swaps the view on. */
  let editing = $state(false);
  let field = $state<HTMLTextAreaElement | null>(null);
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let longEdit: ReturnType<typeof setTimeout> | null = null;

  const blocks = $derived(parseBody(draft));

  // A body changed from outside — a peer's edit, in M2 — shows while this device
  // is not the one typing.
  $effect(() => {
    const body = session.tree.nodes[id]?.body ?? '';
    if (!typing) draft = body;
  });

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
    field?.focus();
    field?.setSelectionRange(edit.start, edit.end);
  }

  function bold(): void {
    if (!field) return;
    void apply(toggleBold(draft, field.selectionStart, field.selectionEnd));
  }

  /** Pressing the level a line already has takes it off — one control, both ways. */
  function heading(level: HeadingLevel): void {
    if (!field) return;
    const caret = field.selectionStart;
    void apply(setHeading(draft, caret, headingAt(draft, caret) === level ? 0 : level));
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
</script>

<!-- B-4. The controls are always here rather than only while the caret is in
     the field: a phone has no Ctrl key, so this row is the only way to reach
     them there — requirements.md §3.1 applied to a body rather than to a row. -->
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
    aria-label="Heading"
    title="Heading"
    data-testid="mark-heading1"
    onmousedown={keepCaret}
    onclick={() => heading(1)}
  >
    H1
  </button>
  <button
    type="button"
    class="row-control rounded border border-line px-2 py-1 text-xs font-semibold text-ink-muted hover:border-accent hover:text-accent"
    aria-label="Subheading"
    title="Subheading"
    data-testid="mark-heading2"
    onmousedown={keepCaret}
    onclick={() => heading(2)}
  >
    H2
  </button>
</div>

<div class="relative">
  <!-- The rendered view is what the same value looks like, so it is hidden from
       assistive technology: the textarea below carries the text itself, and one
       value announced twice is one value too many. -->
  {#if !editing}
    <div
      class="min-h-64 w-full rounded-lg border border-line bg-surface-raised p-3 text-sm leading-relaxed"
      aria-hidden="true"
      data-testid="note-rendered"
    >
      {#if draft === ''}
        <p class="text-ink-faint">Write anything here.</p>
      {:else}
        {#each blocks as block, index (index)}
          {#if block.kind === 'heading1'}
            <h3 class="mt-3 mb-1 text-base font-semibold first:mt-0">
              {#each block.spans as span, i (i)}{#if span.bold}<strong>{span.text}</strong
                  >{:else}{span.text}{/if}{/each}
            </h3>
          {:else if block.kind === 'heading2'}
            <h4 class="mt-2 mb-1 text-sm font-semibold text-ink-muted first:mt-0">
              {#each block.spans as span, i (i)}{#if span.bold}<strong>{span.text}</strong
                  >{:else}{span.text}{/if}{/each}
            </h4>
          {:else}
            <p>
              {#each block.spans as span, i (i)}{#if span.bold}<strong class="font-semibold"
                    >{span.text}</strong
                  >{:else}{span.text}{/if}{:else}&nbsp;{/each}
            </p>
          {/if}
        {/each}
      {/if}
    </div>
  {/if}

  <textarea
    bind:this={field}
    bind:value={draft}
    class="w-full rounded-lg border border-line bg-surface-raised p-3 text-sm leading-relaxed outline-none focus:border-accent"
    class:min-h-64={editing}
    class:resize-y={editing}
    class:absolute={!editing}
    class:inset-0={!editing}
    class:h-full={!editing}
    class:resize-none={!editing}
    class:opacity-0={!editing}
    placeholder="Write anything here."
    aria-label="Note body"
    data-testid="note-body"
    oninput={onInput}
    onkeydown={onKeyDown}
    onfocus={() => (editing = true)}
    onblur={onBlur}
  ></textarea>
</div>
