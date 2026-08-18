<script lang="ts">
  // X-1 and X-2: one layout for both. The sidebar is permanent from `md` up and
  // a dismissible drawer below it — the same markup either way, so a phone is a
  // narrower desktop rather than a second application.
  import type { Snippet } from 'svelte';
  import type { Session } from '../app/Session.svelte';
  import type { ViewState } from '../app/view-state.svelte';
  import SidebarBranch from './SidebarBranch.svelte';
  import { ROOT } from '../core/types';

  let {
    session,
    view,
    currentId,
    folderLabel,
    children,
  }: {
    session: Session;
    view: ViewState;
    currentId: string | null;
    folderLabel: string;
    children: Snippet;
  } = $props();
</script>

<div class="flex min-h-dvh bg-surface text-ink">
  <!-- The drawer's backdrop only exists while the drawer does. -->
  {#if view.drawerOpen}
    <button
      type="button"
      class="fixed inset-0 z-30 bg-ink/20 md:hidden"
      aria-label="Close navigation"
      data-testid="drawer-backdrop"
      onclick={() => view.setDrawer(false)}
    ></button>
  {/if}

  <aside
    class="fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-line bg-surface-raised transition-transform md:static md:translate-x-0"
    class:-translate-x-full={!view.drawerOpen}
    data-testid="sidebar"
    data-open={view.drawerOpen}
  >
    <div class="flex items-center justify-between border-b border-line px-3 py-3">
      <a href="#/" class="text-sm font-semibold" onclick={() => view.setDrawer(false)}>Checklist</a>
      <button
        type="button"
        class="row-control rounded px-2 text-ink-muted hover:text-ink md:hidden"
        aria-label="Close navigation"
        onclick={() => view.setDrawer(false)}
      >
        ✕
      </button>
    </div>

    <nav class="flex-1 overflow-y-auto p-2" aria-label="Lists">
      <SidebarBranch
        {session}
        parent={ROOT}
        {currentId}
        onNavigate={() => view.setDrawer(false)}
      />
    </nav>

    <footer class="border-t border-line px-3 py-2 text-xs text-ink-faint">
      <p data-testid="device-id">Device {session.deviceId}</p>
      <p>{folderLabel}</p>
    </footer>
  </aside>

  <div class="flex min-w-0 flex-1 flex-col">
    <header class="flex items-center gap-2 border-b border-line px-3 py-2 md:hidden">
      <button
        type="button"
        class="row-control rounded px-2 py-1 text-ink-muted hover:text-ink"
        aria-label="Open navigation"
        data-testid="drawer-button"
        onclick={() => view.setDrawer(true)}
      >
        ☰
      </button>
      <span class="text-sm font-semibold">Checklist</span>
    </header>

    {#if session.problem}
      <p class="border-b border-line bg-accent-soft px-4 py-2 text-sm text-danger" data-testid="problem">
        {session.problem}
      </p>
    {/if}

    <main class="min-w-0 flex-1">
      {@render children()}
    </main>
  </div>
</div>
