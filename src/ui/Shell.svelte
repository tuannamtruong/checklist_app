<script lang="ts">
  // X-1 and X-2: one layout for both. The sidebar is permanent from `md` up and
  // a dismissible drawer below it — the same markup either way, so a phone is a
  // narrower desktop rather than a second application.
  import type { Snippet } from 'svelte';
  import type { Session } from '../app/Session.svelte';
  import type { Dismissals } from '../app/dismissals.svelte';
  import type { ViewState } from '../app/view-state.svelte';
  import SidebarBranch from './SidebarBranch.svelte';
  import { CONFLICTS_HREF, DONE_HREF } from '../app/router.svelte';
  import { ROOT } from '../core/types';

  let {
    session,
    view,
    dismissals,
    currentId,
    doneOpen,
    conflictsOpen,
    folderLabel,
    synced,
    onrefresh,
    children,
  }: {
    session: Session;
    view: ViewState;
    dismissals: Dismissals;
    currentId: string | null;
    doneOpen: boolean;
    conflictsOpen: boolean;
    folderLabel: string;
    synced: boolean;
    onrefresh: () => void;
    children: Snippet;
  } = $props();

  // §9: the entry appears when there is something in it and is absent
  // otherwise. A permanent one would be empty almost always, which is how a nav
  // entry teaches a user to stop reading it.
  const pending = $derived(session.conflicts.filter((row) => !dismissals.has(row.id)).length);
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

      <!-- T-12. Always here, even when empty: a view that appeared only once it
           had something in it is a view the user never learns exists. -->
      <a
        href={DONE_HREF}
        class="mt-2 flex items-center gap-2 rounded-md border-t border-line px-2 pt-3 pb-1.5 text-sm hover:bg-surface-sunken"
        class:text-accent={doneOpen}
        class:text-ink-muted={!doneOpen}
        data-testid="done-link"
        onclick={() => view.setDrawer(false)}
      >
        <span class="size-4 shrink-0 text-center" aria-hidden="true">☑</span>
        <span class="truncate">Done</span>
      </a>

      {#if pending > 0 || conflictsOpen}
        <a
          href={CONFLICTS_HREF}
          class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-sunken"
          class:text-accent={conflictsOpen}
          class:text-ink-muted={!conflictsOpen}
          data-testid="conflicts-link"
          onclick={() => view.setDrawer(false)}
        >
          <span class="size-4 shrink-0 text-center" aria-hidden="true">⚡</span>
          <span class="truncate">Merged</span>
          {#if pending > 0}
            <span class="ml-auto rounded-full bg-accent-soft px-1.5 text-xs text-accent">
              {pending}
            </span>
          {/if}
        </a>
      {/if}
    </nav>

    <footer class="border-t border-line px-3 py-2 text-xs text-ink-faint">
      <p data-testid="device-id">Device {session.deviceId}</p>
      <p class="flex items-center gap-1">
        <span class="min-w-0 truncate" data-testid="folder-label">{folderLabel}</span>
        {#if synced}
          <!-- S-19: the idle triggers are focus and this button, because a timer
               in a hidden tab is throttled and a backgrounded PWA's is frozen. -->
          <button
            type="button"
            class="row-control ml-auto shrink-0 rounded px-1 hover:text-ink"
            aria-label="Sync now"
            title="Sync now"
            data-testid="sync-now"
            data-syncing={session.syncing}
            onclick={onrefresh}
          >
            {session.syncing ? '…' : '↻'}
          </button>
        {/if}
      </p>
      {#if synced || session.peers > 0}
        <p data-testid="peer-count">
          {session.peers === 0 ? 'No other device yet' : `${session.peers} other device${session.peers === 1 ? '' : 's'}`}
        </p>
      {/if}
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
