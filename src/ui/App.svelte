<script lang="ts">
  // Startup: find a folder, open this device's log, fold it into the store, and
  // hand the store to the views. Everything asynchronous happens here, once.
  //
  // Two things arrive with M2. The folder may need a click before it exists at
  // all — architecture.md §4 — so the shell can be a setup screen rather than a
  // tree; and the sync cycle runs from here, driven by activity and focus
  // rather than by a timer (S-19).
  import { isVisible, listAbove } from '../core/tree';
  import { ROOT } from '../core/types';
  import { deviceId, suggestedDeviceName } from '../app/device';
  import { chooseFolder, type FolderChoice } from '../app/folder-choice';
  import { Dismissals } from '../app/dismissals.svelte';
  import { Router } from '../app/router.svelte';
  import { Session } from '../app/Session.svelte';
  import { Theme } from '../app/theme.svelte';
  import { SyncCadence } from '../app/sync-cadence';
  import { ViewState } from '../app/view-state.svelte';
  import { RowFocus } from './focus.svelte';
  import { searchHref } from '../app/router.svelte';
  import ConflictsPage from './ConflictsPage.svelte';
  import DevicesPage from './DevicesPage.svelte';
  import DonePage from './DonePage.svelte';
  import FolderSetup from './FolderSetup.svelte';
  import LogPage from './LogPage.svelte';
  import NodePage from './NodePage.svelte';
  import NotePane from './NotePane.svelte';
  import RecoveryPage from './RecoveryPage.svelte';
  import SearchPage from './SearchPage.svelte';
  import SettingsPage from './SettingsPage.svelte';
  import Shell from './Shell.svelte';

  const router = new Router();
  const view = new ViewState();
  // X-14. Constructed here rather than in the settings screen: the theme is the
  // whole app's, and the screen that changes it is one of the pages wearing it.
  const theme = new Theme();
  const focus = new RowFocus();
  const dismissals = new Dismissals();

  let choice = $state<FolderChoice | null>(null);
  let session = $state<Session | null>(null);
  let cadence: SyncCadence | null = null;

  void chooseFolder().then((chosen) => open(chosen));

  async function open(chosen: FolderChoice): Promise<void> {
    choice = chosen;
    if (chosen.kind !== 'folder') return;
    // D-5. The device names itself here, on the one path that knows both the id
    // and the browser, and only if its own header carries no name already.
    const id = deviceId();
    const opened = await Session.open(chosen.folder, id, suggestedDeviceName(id));
    session = opened;
    // The cycle runs against every folder, including the ones that reach no
    // other device: "is there a peer file here" is a question about the folder
    // rather than about the adapter, and one `list()` is what answers it.
    cadence = new SyncCadence(() => opened.cycle());
    opened.onWrote = () => cadence?.activity();
    cadence.refresh();
  }

  const folder = $derived(choice !== null && choice.kind === 'folder' ? choice : null);
  const currentId = $derived(router.route.name === 'node' ? router.route.id : null);
  const doneOpen = $derived(router.route.name === 'done');
  const conflictsOpen = $derived(router.route.name === 'conflicts');
  const searchOpen = $derived(router.route.name === 'search');
  const settingsOpen = $derived(router.route.name === 'settings');
  // D-1's list and D-4's log both hang off the settings screen rather than the
  // nav, so all three light one entry — requirements.md §5.
  const devicesOpen = $derived(router.route.name === 'devices');
  const logsOpen = $derived(router.route.name === 'logs');
  const query = $derived(router.route.name === 'search' ? router.route.query : '');

  /**
   * X-21. A note's route draws two things: the note, and the page of the list it
   * hangs under. Both are derived from the one route rather than remembered
   * beside it, which is why there is no second route and no stored pair — a link
   * pasted into another device opens the same two panes (X-8), and Back closes
   * the note by leaving the route exactly as it always did. requirements.md §10.3.
   *
   * Only a note splits. A folder is a list, and a list beside a list is the same
   * drawing twice; a task has no page to open.
   */
  const noteId = $derived.by(() => {
    const open = session;
    if (!open || currentId === null) return null;
    if (!isVisible(open.tree, currentId)) return null;
    return open.tree.nodes[currentId]?.kind === 'note' ? currentId : null;
  });

  /**
   * The list behind the note: the nearest ancestor that is not itself a note,
   * over T-6-resolved parents, or the root.
   *
   * The walk is what keeps a sub-note out of the left column — X-21. A note's
   * children are in the pane (K-4), so opening one is a click *inside* the pane,
   * and the pane is the only thing that should answer it; the list on the left
   * is the one the reader navigated to and stays there until they navigate it.
   */
  const listId = $derived.by(() => {
    const open = session;
    if (!open || noteId === null) return currentId;
    const above = listAbove(open.tree, noteId);
    return above === ROOT ? null : above;
  });

  /**
   * F-5. Typing replaces the fragment rather than pushing it, or every keystroke
   * would be a history entry and Back would walk the query backwards one letter
   * at a time.
   */
  function setQuery(next: string): void {
    history.replaceState(null, '', searchHref(next));
  }

  /**
   * `/` is the one key that is not a row action — it acts on the application
   * rather than on the row under the caret, so it lives here and not in
   * `actions.ts` — requirements.md §3.1.
   */
  function globalKey(event: KeyboardEvent): void {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.isContentEditable) return;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    router.go({ name: 'search', query: '' });
  }

  // S-20's "on navigating away": leaving a note's page emits its body, and so
  // does leaving the page altogether.
  $effect(() => {
    router.route;
    session?.commitAllBodies();
  });

  function flush(): void {
    void session?.flush();
  }

  function refresh(): void {
    cadence?.refresh();
  }
</script>

<!-- X-24. The window's width is told to the view state rather than read from
     it: the class is constructed once and a window is resized all day, and what
     the divider is allowed to do depends on the room the window has. -->
<svelte:window
  onpagehide={flush}
  onfocus={refresh}
  onkeydown={globalKey}
  onresize={() => view.setViewport(window.innerWidth)}
  onvisibilitychange={() => (document.visibilityState === 'hidden' ? flush() : refresh())}
/>

{#if session && folder}
  <Shell
    {session}
    {view}
    {dismissals}
    {currentId}
    {doneOpen}
    {conflictsOpen}
    {searchOpen}
    settingsOpen={settingsOpen || devicesOpen || logsOpen}
    folderLabel={folder.label}
    synced={folder.synced}
    onrefresh={refresh}
  >
    {#if conflictsOpen}
      <ConflictsPage {session} {dismissals} />
    {:else if router.route.name === 'unknown'}
      <RecoveryPage {session} id={null} />
    {:else if searchOpen}
      <SearchPage {session} {query} onquery={setQuery} />
    {:else if settingsOpen}
      <SettingsPage {session} {theme} {folder} />
    {:else if devicesOpen}
      <DevicesPage {session} />
    {:else if logsOpen}
      <LogPage {session} />
    {:else if doneOpen}
      <DonePage {session} />
    {:else if currentId !== null && !isVisible(session.tree, currentId)}
      <RecoveryPage {session} id={currentId} />
    {:else}
      <!-- X-21 and X-22. Beside above `lg`, over below it: the pane takes itself
           out of the flow at the narrow width, so the list under it is the same
           single column it was before the note opened. The padding is what keeps
           the last rows out from under the peeked sheet — §10.3. -->
      <div class="flex flex-col lg:flex-row lg:items-start">
        <div class="min-w-0 flex-1 {noteId !== null ? 'pb-[60dvh] lg:pb-0' : ''}">
          <NodePage {session} {view} {focus} id={listId} />
        </div>
        {#if noteId !== null}
          <NotePane {session} {view} {focus} id={noteId} />
        {/if}
      </div>
    {/if}
  </Shell>
{:else if choice && choice.kind === 'setup'}
  <FolderSetup need={choice} onchoose={(chosen) => void open(chosen)} />
{:else}
  <p class="p-6 text-sm text-ink-muted" data-testid="loading">Opening the folder…</p>
{/if}
