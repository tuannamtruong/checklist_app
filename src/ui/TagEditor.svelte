<script lang="ts">
  // A-1. Where a row's tags are typed — the row's `⋮` menu opens it under the
  // row, and a node's own page has it under the title.
  //
  // Every edit here is `setTags` writing the whole set, because that is what the
  // field is: one value, merged like a title — past_decision.md §10.
  import { addTag, removeTag } from '../core/edit';
  import { MAX_TAGS } from '../core/tags';
  import type { Session } from '../app/Session.svelte';

  let {
    session,
    id,
    autofocus = false,
    onclose,
  }: {
    session: Session;
    id: string;
    autofocus?: boolean;
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

<div class="flex flex-wrap items-center gap-1" data-testid="tag-editor">
  {#each tags as tag (tag)}
    <span class="flex shrink-0 items-center gap-1 rounded-full border border-line px-1.5 text-xs text-ink-muted">
      {tag}
      <button
        type="button"
        class="text-ink-faint hover:text-danger"
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
      class="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-xs outline-none placeholder:text-ink-faint"
      placeholder="Add a tag"
      aria-label="Add a tag"
      data-testid="tag-input"
      onkeydown={onKeyDown}
      onblur={commit}
    />
  {/if}
</div>
