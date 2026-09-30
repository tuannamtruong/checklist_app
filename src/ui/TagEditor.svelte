<script lang="ts">
  // A-1. Where a row's tags are typed — the row's `⋮` menu opens it under the
  // row, and a node's own page has it under the title.
  //
  // Every edit here is `setTags` writing the whole set, because that is what the
  // field is: one value, merged like a title — past_decision.md §10.
  import { addTag, removeTag } from '../core/edit';
  import { MAX_TAGS } from '../core/tags';
  import { tagTint } from '../core/tag-colour';
  import type { Session } from '../app/Session.svelte';

  let {
    session,
    id,
    autofocus = false,
    preview = false,
    onclose,
  }: {
    session: Session;
    id: string;
    autofocus?: boolean;
    /**
     * X-37. The peeked sheet, where every tap is swallowed: the input cannot be
     * typed into, so it is not drawn, and a row with no tags is not drawn at
     * all — the space goes to the note. Like `NoteBody`'s own flag this is a
     * `lg:` class rather than a measurement, because the pane above the
     * breakpoint is a column and is never peeked.
     */
    preview?: boolean;
    onclose?: () => void;
  } = $props();

  const tags = $derived(session.tree.nodes[id]?.tags ?? []);
  let draft = $state('');
  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (autofocus) input?.focus();
  });

  function commit(): void {
    // A comma is how people separate tags without thinking about it, so it
    // ends one here as surely as Enter does.
    for (const part of draft.split(',')) {
      session.run((tree, ctx) => addTag(tree, ctx, id, part));
    }
    draft = '';
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      draft = '';
      onclose?.();
    } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
      // The last tag, because that is the one the caret is sitting against.
      session.run((tree, ctx) => removeTag(tree, ctx, id, tags[tags.length - 1]!));
    }
  }
</script>

<div
  class="flex-wrap items-center gap-1 {preview && tags.length === 0 ? 'hidden lg:flex' : 'flex'}"
  data-testid="tag-editor"
>
  {#each tags as tag (tag)}
    <span
      class="tag-chip flex shrink-0 items-center gap-1 rounded-full border px-1.5 text-xs"
      style="--tag-tint: {tagTint(tag)}"
    >
      {tag}
      <button
        type="button"
        class="opacity-60 hover:text-danger hover:opacity-100"
        aria-label="Remove tag {tag}"
        data-testid="tag-remove"
        onclick={() => session.run((tree, ctx) => removeTag(tree, ctx, id, tag))}
      >
        ✕
      </button>
    </span>
  {/each}

  {#if tags.length < MAX_TAGS}
    <input
      bind:this={input}
      bind:value={draft}
      class="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-xs outline-none placeholder:text-ink-faint {preview
        ? 'hidden lg:block'
        : ''}"
      placeholder="Add a tag"
      aria-label="Add a tag"
      data-testid="tag-input"
      onkeydown={onKeyDown}
      onblur={commit}
    />
  {/if}
</div>
