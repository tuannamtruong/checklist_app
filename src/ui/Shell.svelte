<script lang="ts">
  // X-1 and X-2: one layout for both. The sidebar is permanent from `md` up and
  // a dismissible drawer below it — the same markup either way, so a phone is a
  // narrower desktop rather than a second application.
  import type { Snippet } from 'svelte';
  import type { Session } from '../app/Session.svelte';
  import type { Dismissals } from '../app/dismissals.svelte';
  import { SIDEBAR_WIDTH, type ViewState } from '../app/view-state.svelte';
  import SidebarLinks from './SidebarLinks.svelte';
  import WidthGrip from './WidthGrip.svelte';
  import { CONFLICTS_HREF, DONE_HREF, SEARCH_HREF, SETTINGS_HREF } from '../app/router.svelte';

  let {
    session,
    view,
    dismissals,
    topbar,
    currentId,
    doneOpen,
    conflictsOpen,
    searchOpen,
    settingsOpen,
    folderLabel,
    synced,
    onrefresh,
    children,
  }: {
    session: Session;
    view: ViewState;
    dismissals: Dismissals;
    /** X-27. The phone's top bar, when the route has one to give it. */
    topbar?: Snippet;
    currentId: string | null;
    doneOpen: boolean;
    conflictsOpen: boolean;
    searchOpen: boolean;
    settingsOpen: boolean;
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

<!-- X-29. The shell is the window's height and clips, rather than being the
     page's height and letting the document scroll: the sidebar is a flex child
     of this row, so a row as tall as a long list made a sidebar as tall as a
     long list, and the whole thing scrolled together. Each column below scrolls
     on its own instead — requirements.md §10. -->
<div class="flex h-dvh overflow-hidden bg-surface text-ink">
  <!-- The drawer's backdrop only exists while the drawer does. -->
  {#if view.drawerOpen}
    <button
      type="button"
      class="fixed inset-0 z-30 bg-scrim md:hidden"
      aria-label="Close navigation"
      data-testid="drawer-backdrop"
      onclick={() => view.setDrawer(false)}
    ></button>
  {/if}

  <!-- X-20. The width is a custom property rather than an inline `width`, so it
       reaches only the `md` rule that reads it: below that breakpoint the
       sidebar is a drawer laid over the page, where a width takes room from
       nothing and a dragged one would only make the drawer odd. `md:relative`
       rather than `md:static` is what the grip anchors to. -->
  <aside
    class="fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-line bg-surface-raised transition-transform md:relative md:w-[var(--sidebar-width)] md:translate-x-0"
    class:-translate-x-full={!view.drawerOpen}
    style="--sidebar-width: {view.sidebarWidth}px"
    data-testid="sidebar"
    data-open={view.drawerOpen}
  >
    <div class="flex items-center justify-between border-b border-line px-3 py-3">
      <!-- X-28. Named for the page it opens rather than for the application:
           this is the way back to the top of the tree, and that page has been
           headed "All lists" since it existed — requirements.md §10. -->
      <a
        href="#/"
        class="sidebar-text font-semibold"
        data-testid="all-lists-link"
        onclick={() => view.setDrawer(false)}
      >
        All lists
      </a>
      <button
        type="button"
        class="sidebar-text row-control rounded px-2 text-ink-muted hover:text-ink md:hidden"
        aria-label="Close navigation"
        onclick={() => view.setDrawer(false)}
      >
        ✕
      </button>
    </div>

    <nav class="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Lists">
      <SidebarLinks {session} {currentId} onNavigate={() => view.setDrawer(false)} />

      <!-- T-12 and F-5. Both are here even when empty: a view that appeared
           only once it had something in it is a view the user never learns
           exists — requirements.md §5. Settings is the third, and it sits in the
           footer instead; the device list and the log hang off it rather than
           taking entries of their own. -->
      <a
        href={SEARCH_HREF}
        class="sidebar-text mt-2 flex items-center gap-2 rounded-md border-t border-line px-2 pt-3 pb-1.5 hover:bg-surface-sunken"
        class:text-accent={searchOpen}
        class:text-ink-muted={!searchOpen}
        data-testid="search-link"
        onclick={() => view.setDrawer(false)}
      >
        <span class="sidebar-icon text-center" aria-hidden="true">⌕</span>
        <span class="truncate">Search</span>
        <span class="sidebar-note ml-auto shrink-0 text-ink-faint">/</span>
      </a>

      <a
        href={DONE_HREF}
        class="sidebar-text flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-sunken"
        class:text-accent={doneOpen}
        class:text-ink-muted={!doneOpen}
        data-testid="done-link"
        onclick={() => view.setDrawer(false)}
      >
        <span class="sidebar-icon text-center" aria-hidden="true">☑</span>
        <span class="truncate">Done</span>
      </a>

      {#if pending > 0 || conflictsOpen}
        <a
          href={CONFLICTS_HREF}
          class="sidebar-text flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-sunken"
          class:text-accent={conflictsOpen}
          class:text-ink-muted={!conflictsOpen}
          data-testid="conflicts-link"
          onclick={() => view.setDrawer(false)}
        >
          <span class="sidebar-icon text-center" aria-hidden="true">⚡</span>
          <span class="truncate">Merged</span>
          {#if pending > 0}
            <span class="sidebar-note ml-auto rounded-full bg-accent-soft px-1.5 text-accent">
              {pending}
            </span>
          {/if}
        </a>
      {/if}
    </nav>

    <!-- X-12. Settings is the foot of the sidebar rather than a fourth nav
         entry: the entries above it are places in the tree, and this one is the
         device the tree is being read on. What the footer used to spell out —
         the name, the folder, the peer count — is on that screen and says more
         there, so the corner is a door rather than a readout — §10. -->
    <footer class="border-t border-line p-2">
      <!-- The one exception, and it is a warning rather than a readout: a device
           that believes it is synced and is not is the failure this shell must
           never produce silently — architecture.md §4. The label says it in
           full, so the line is the label — folder-choice.ts. -->
      {#if !synced}
        <p class="sidebar-note px-2 pb-1.5 text-danger" data-testid="not-synced">{folderLabel}</p>
      {/if}

      <div class="flex items-center gap-1">
        <a
          href={SETTINGS_HREF}
          class="sidebar-text flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-sunken"
          class:text-accent={settingsOpen}
          class:text-ink-muted={!settingsOpen}
          data-testid="settings-link"
          onclick={() => view.setDrawer(false)}
        >
          <span class="sidebar-icon text-center" aria-hidden="true">⚙</span>
          <span class="truncate">Settings</span>
        </a>
        {#if synced}
          <!-- S-19: the idle triggers are focus and this button, because a timer
               in a hidden tab is throttled and a backgrounded PWA's is frozen.
               It stays in the corner rather than moving to the screen it now
               leads to — a sync you have to navigate to is one nobody presses. -->
          <button
            type="button"
            class="sidebar-text row-control shrink-0 rounded px-2 py-1.5 text-ink-faint hover:text-ink"
            aria-label="Sync now"
            title="Sync now"
            data-testid="sync-now"
            data-syncing={session.syncing}
            onclick={onrefresh}
          >
            {session.syncing ? '…' : '↻'}
          </button>
        {/if}
      </div>
    </footer>

    <!-- X-20. The grip is the sidebar's own right edge, and the width it
         reports is clamped by `view-state.svelte.ts` rather than here. -->
    <WidthGrip
      width={view.sidebarWidth}
      min={SIDEBAR_WIDTH.min}
      max={SIDEBAR_WIDTH.max}
      initial={SIDEBAR_WIDTH.default}
      label="Resize sidebar"
      testid="sidebar-resize"
      class="absolute inset-y-0 -right-1 z-10 hidden w-2 cursor-col-resize hover:bg-accent-soft focus-visible:bg-accent-soft md:block"
      onwidth={(px) => view.setSidebarWidth(px)}
    />
  </aside>

  <!-- X-29. The page area is the other scroller. Everything `sticky` inside it —
       X-26's add group, the phone's top bar, the note pane's edge — sticks to
       this column now rather than to a window the page slid under, which is the
       same behaviour by the same rules, one box in. -->
  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto" data-testid="page-scroll">
    <!-- X-27. The `☰` and, beside it, whatever the route gives this bar — which
         on a list is K-10's add group. It used to say the application's name,
         which is a thing to read once on an application with one tree in it,
         and this is the row X-26 pins: what is in it is on screen for the whole
         session, so the control the app is mostly used for is what earns it.
         Above `md` the bar is not drawn and the page header carries the group —
         requirements.md §10. -->
    <header
      class="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-surface px-3 py-2 md:hidden"
      data-testid="topbar"
    >
      <button
        type="button"
        class="row-control shrink-0 rounded px-2 py-1 text-ink-muted hover:text-ink"
        aria-label="Open navigation"
        data-testid="drawer-button"
        onclick={() => view.setDrawer(true)}
      >
        ☰
      </button>
      {#if topbar}
        {@render topbar()}
      {/if}
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
