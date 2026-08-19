<script lang="ts">
  // One row of the tree: a checkbox or a kind icon, an editable title, and the
  // menu that carries every action the keyboard has.
  //
  // The title in the input is a draft, not the node's title. An op is emitted
  // when the edit is committed, so a rename costs one write rather than one per
  // keystroke — and Escape can put the row back without ever having written.
  import { canDrop, dropOnto, setTitle, toggleDone } from '../core/edit';
  import { childrenOf } from '../core/tree';
  import type { NodeId } from '../core/types';
  import type { RowActionContext } from './actions';
  import { handleRowKey } from './keyboard';
  import { rowAbove, rowBelow } from './rows';
  import KindIcon from './KindIcon.svelte';
  import PriorityFlag from './PriorityFlag.svelte';
  import RowMenu from './RowMenu.svelte';
  import TagChips from './TagChips.svelte';
  import TagEditor from './TagEditor.svelte';
  import { nodeHref } from '../app/router.svelte';
  import type { RowDrag } from './drag.svelte';

  let { ctx, depth, drag }: { ctx: RowActionContext; depth: number; drag: RowDrag } = $props();

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
  /** A-1. The row's tag editor, opened from the menu and closed by Escape. */
  let taggingOpen = $state(false);

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

  // T-11: ticking removes the row from under the cursor, so the caret has to be
  // put somewhere. The row below is the one the user is working towards; the row
  // above is the fallback when this was the last one.
  function tick(): void {
    const next = rowBelow(ctx.rows, id) ?? rowAbove(ctx.rows, id);
    session.run((tree, c) => toggleDone(tree, c, id));
    if (next) focus.request(next);
  }

  // T-14. The whole gesture lives on the grip: it captures the pointer, so the
  // rows being crossed hear nothing and `RowDrag` hit-tests the document instead.
  const drop = $derived(drag.target?.id === id ? drag.target : null);
  const refused = $derived(drop !== null && drag.refused);

  function onDragStart(event: PointerEvent): void {
    // A pointer that started on the grip is a drag and nothing else: no scroll
    // on a phone, and no focus stolen from the title being typed.
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.start(id);
  }

  function onDragMove(event: PointerEvent): void {
    if (drag.id !== id) return;
    drag.over(event.clientX, event.clientY, (target) =>
      canDrop(session.tree, id, target.id, target.where),
    );
  }

  function onDragEnd(): void {
    const target = drag.end();
    if (!target) return;
    // A drop into a collapsed row would otherwise put the row somewhere the
    // user cannot see, which reads exactly like losing it.
    if (target.where === 'inside') view.expand(target.id);
    session.run((tree, c) => dropOnto(tree, c, id, target.id, target.where));
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
    class="group flex items-center gap-1 rounded-md border-y-2 border-transparent pr-1 hover:bg-surface-sunken"
    class:opacity-50={drag.id === id}
    class:border-t-accent={drop?.where === 'before' && !refused}
    class:border-b-accent={drop?.where === 'after' && !refused}
    class:bg-accent-soft={drop?.where === 'inside' && !refused}
    class:outline-2={refused}
    class:outline-danger={refused}
    style="padding-left: {depth * 1.25}rem"
    data-testid="row"
    data-row-id={id}
    data-kind={node.kind}
    data-depth={depth}
    data-drop={drop?.where ?? ''}
    data-drop-refused={refused}
  >
    <!-- T-14. Always there on a touch screen, on hover or focus otherwise: a
         grip on every row at rest is a column of dots down the page. -->
    <button
      type="button"
      class="drag-handle row-control w-4 shrink-0 cursor-grab text-ink-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      aria-label="Move {node.title || 'untitled'}"
      data-testid="drag-handle"
      onpointerdown={onDragStart}
      onpointermove={onDragMove}
      onpointerup={onDragEnd}
      onpointercancel={() => drag.cancel()}
    >
      <span aria-hidden="true">⠿</span>
    </button>

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

    <!-- Always unchecked in practice: T-11 takes a ticked row out of the tree,
         so the only place a checked box renders is the Done view. -->
    {#if node.kind === 'task'}
      <input
        type="checkbox"
        class="row-control size-4 shrink-0 accent-accent"
        checked={node.done}
        aria-label="Done"
        data-testid="done"
        onchange={tick}
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

    <!-- A-1 and A-2, right of the title: what the row is for, after what it is. -->
    <TagChips tags={node.tags} {view} />
    <PriorityFlag {session} {id} priority={node.priority} />

    <RowMenu ctx={{ ...ctx, editTags: () => (taggingOpen = true) }} />
  </div>

  <!-- Under the row rather than inside it: the row is what a drop is measured
       against — T-14 — and a row that grew when its tags opened would move the
       target out from under the pointer. -->
  {#if taggingOpen}
    <div class="pb-1" style="padding-left: {depth * 1.25 + 2.5}rem">
      <TagEditor {session} {id} autofocus onclose={() => (taggingOpen = false)} />
    </div>
  {/if}
{/if}
