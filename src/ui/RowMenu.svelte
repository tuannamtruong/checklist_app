<script lang="ts">
  // Where a phone reaches everything the keyboard offers — requirements.md §3.1.
  // The menu also shows each action's key, so it is where the keyboard model is
  // taught rather than a second, quieter implementation of it.
  import { CARET_KEYS, rowActions, type RowActionContext } from './actions';

  let { ctx }: { ctx: RowActionContext } = $props();

  let open = $state(false);
  let menu = $state<HTMLDivElement | null>(null);
  let button = $state<HTMLButtonElement | null>(null);

  const actions = $derived(rowActions(ctx));

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
      class="row-menu absolute right-0 z-20 mt-1 w-64 rounded-lg border border-line bg-surface-raised py-1 shadow-lg"
      role="menu"
      tabindex="-1"
      data-testid="row-menu"
    >
      {#each actions as action (action.name)}
        <button
          type="button"
          role="menuitem"
          class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent"
          class:text-danger={action.danger}
          disabled={!action.enabled}
          data-action={action.name}
          onclick={() => {
            action.run();
            close();
          }}
        >
          <span>{action.label}</span>
          {#if action.keys}
            <kbd class="shrink-0 text-xs text-ink-faint">{action.keys}</kbd>
          {/if}
        </button>
      {/each}

      <div class="mt-1 border-t border-line px-3 pt-2 pb-1">
        <p class="text-xs font-medium text-ink-muted">Keyboard</p>
        {#each CARET_KEYS as hint (hint.keys)}
          <p class="flex justify-between gap-3 py-0.5 text-xs text-ink-faint">
            <span>{hint.label}</span><kbd>{hint.keys}</kbd>
          </p>
        {/each}
      </div>
    </div>
  {/if}
</div>
