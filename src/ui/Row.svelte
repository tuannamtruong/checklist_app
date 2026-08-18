<script lang="ts">
  // One row of the tree: a checkbox or a kind icon, an editable title, and the
  // menu that carries every action the keyboard has.
  //
  // The title in the input is a draft, not the node's title. An op is emitted
  // when the edit is committed, so a rename costs one write rather than one per
  // keystroke — and Escape can put the row back without ever having written.
  import { setTitle, toggleDone } from '../core/edit';
  import { childrenOf } from '../core/tree';
  import type { NodeId } from '../core/types';
  import type { RowActionContext } from './actions';
  import { handleRowKey } from './keyboard';
  import KindIcon from './KindIcon.svelte';
  import RowMenu from './RowMenu.svelte';
  import { nodeHref } from '../app/router.svelte';

  let { ctx, depth }: { ctx: RowActionContext; depth: number } = $props();

  const id: NodeId = $derived(ctx.id);
  const session = $derived(ctx.session);
  const view = $derived(ctx.view);
  const focus = $derived(ctx.focus);

  const node = $derived(session.tree.nodes[id]);
  const children = $derived(childrenOf(session.tree, id));
  const collapsed = $derived(view.isCollapsed(id));

  let input = $state<HTMLInputElement | null>(null);
  let editing = $state(false);
  let draft = $state('');

  // A rename that arrives from outside — a peer's, in M2 — must show without
  // stealing what this device is halfway through typing. X-10 with a caret.
  $effect(() => {
    const title = node?.title ?? '';
    if (!editing) draft = title;
  });

  $effect(() => {
    focus.seq;
    if (focus.id !== id || !input) return;
    input.focus();
    const at = focus.caret === 'start' ? 0 : input.value.length;
    input.setSelectionRange(at, at);
  });

  function commit(): void {
    editing = false;
    session.run((tree, c) => setTitle(tree, c, id, draft));
  }

  function onKeyDown(event: KeyboardEvent): void {
    const handled = handleRowKey(event, {
      ...ctx,
      draft,
      discardDraft: () => {
        draft = node?.title ?? '';
        editing = false;
      },
    });
    if (handled) event.preventDefault();
  }
</script>

{#if node}
  <div
    class="group flex items-center gap-1 rounded-md pr-1 hover:bg-surface-sunken"
    style="padding-left: {depth * 1.25}rem"
    data-testid="row"
    data-row-id={id}
    data-kind={node.kind}
    data-depth={depth}
  >
    <button
      type="button"
      class="row-control w-5 shrink-0 text-ink-faint hover:text-ink"
      class:invisible={children.length === 0}
      aria-label={collapsed ? 'Expand' : 'Collapse'}
      aria-expanded={children.length > 0 ? !collapsed : undefined}
      data-testid="disclosure"
      onclick={() => view.toggleCollapsed(id)}
    >
      <span class="inline-block transition-transform" class:-rotate-90={collapsed} aria-hidden="true">▾</span>
    </button>

    {#if node.kind === 'task'}
      <input
        type="checkbox"
        class="row-control size-4 shrink-0 accent-accent"
        checked={node.done}
        aria-label="Done"
        data-testid="done"
        onchange={() => session.run((tree, c) => toggleDone(tree, c, id))}
      />
    {:else}
      <a
        href={nodeHref(id)}
        class="row-control shrink-0 text-ink-muted hover:text-accent"
        aria-label="Open {node.title || 'untitled'}"
        data-testid="open"
      >
        <KindIcon kind={node.kind} class="size-4" />
      </a>
    {/if}

    <input
      bind:this={input}
      bind:value={draft}
      class="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-ink-faint"
      class:line-through={node.kind === 'task' && node.done}
      class:text-ink-muted={node.kind === 'task' && node.done}
      placeholder="Untitled"
      data-testid="title"
      onfocus={() => {
        editing = true;
        focus.id = id;
      }}
      oninput={() => (editing = true)}
      onblur={commit}
      onkeydown={onKeyDown}
    />

    <RowMenu {ctx} />
  </div>
{/if}
