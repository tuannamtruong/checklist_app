<script lang="ts">
  // Where a phone reaches a row's edits — requirements.md §3.1.
  //
  // X-34: edits and nothing else. It carried each action's key and a block of
  // caret hints besides, which made a control opened ten times a day the place
  // a reference read once was kept; that reference is on the settings screen
  // now (X-33). It also carried indent, outdent and the two nudges, which a
  // finger already does by dragging (T-14, T-16) — the four are the keyboard's,
  // and `menuActions` is where that line is drawn.
  import { menuActions, type RowActionContext } from './actions';

  let { ctx }: { ctx: RowActionContext } = $props();

  let open = $state(false);
  let menu = $state<HTMLDivElement | null>(null);
  let button = $state<HTMLButtonElement | null>(null);

  const actions = $derived(menuActions(ctx));

  function close(returnFocus = true): void {
    open = false;
    if (returnFocus) button?.focus();
  }

  // The menu takes focus when it opens, so a keyboard can walk it and Escape
  // reaches it — a menu that can only be dismissed with a mouse would put the
  // phone and the desktop back on different paths.
  $effect(() => {
    if (open) menu?.focus();
  });

  function onWindowPointerDown(event: PointerEvent): void {
    if (!open) return;
    const target = event.target as globalThis.Node;
    if (menu?.contains(target) || button?.contains(target)) return;
    close(false);
  }

  function onWindowKeyDown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') close();
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeyDown} />

<div class="relative">
  <button
    bind:this={button}
    type="button"
    class="row-control rounded px-1.5 py-1 text-ink-faint hover:bg-surface-sunken hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label="Row actions"
    data-testid="row-menu-button"
    onclick={() => (open = !open)}
  >
    <span aria-hidden="true">⋮</span>
  </button>

  {#if open}
    <div
      bind:this={menu}
      class="row-menu absolute right-0 z-20 mt-1 w-56 rounded-lg border border-line bg-surface-raised py-1 shadow-lg"
      role="menu"
      tabindex="-1"
      data-testid="row-menu"
    >
      {#each actions as action (action.name)}
        <button
          type="button"
          role="menuitem"
          class="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent"
          class:text-danger={action.danger}
          disabled={!action.enabled}
          data-action={action.name}
          onclick={() => {
            action.run();
            close();
          }}
        >
          <span>{action.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
