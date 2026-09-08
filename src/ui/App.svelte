<script lang="ts">
  // Startup: find a folder, open this device's log, fold it into the store, and
  // hand the store to the views. Everything asynchronous happens here, once.
  //
  // Two things arrive with M2. The folder may need a click before it exists at
  // all — architecture.md §4 — so the shell can be a setup screen rather than a
  // tree; and the sync cycle runs from here, driven by activity and focus
  // rather than by a timer (S-19).
  import { isVisible } from '../core/tree';
  import { dayOfList } from '../core/agenda';
  import { AGENDA, ROOT } from '../core/types';
  import { deviceId, suggestedDeviceName } from '../app/device';
  import { chooseFolder, type FolderChoice } from '../app/folder-choice';
  import { Dismissals } from '../app/dismissals.svelte';
  import { Router } from '../app/router.svelte';
  import { Session } from '../app/Session.svelte';
  import { Theme } from '../app/theme.svelte';
  import { SidebarSize } from '../app/sidebar-size.svelte';
  import { SyncCadence } from '../app/sync-cadence';
  import { ViewState } from '../app/view-state.svelte';
  import { RowFocus } from './focus.svelte';
  import { panesFor } from './panes';
  import { searchHref } from '../app/router.svelte';
  import AgendaPage from './AgendaPage.svelte';
  import ConflictsPage from './ConflictsPage.svelte';
  import DevicesPage from './DevicesPage.svelte';
  import DonePage from './DonePage.svelte';
  import FolderSetup from './FolderSetup.svelte';
  import LogPage from './LogPage.svelte';
  import NodePage from './NodePage.svelte';
  import NotePane from './NotePane.svelte';
  import QuickAdd from './QuickAdd.svelte';
  import RecoveryPage from './RecoveryPage.svelte';
  import SearchPage from './SearchPage.svelte';
  import SettingsPage from './SettingsPage.svelte';
  import Shell from './Shell.svelte';

  const router = new Router();
  const view = new ViewState();
  // X-14. Constructed here rather than in the settings screen: the theme is the
  // whole app's, and the screen that changes it is one of the pages wearing it.
  const theme = new Theme();
  // X-25. Beside the theme and for its reasons: the size is the sidebar's, which
  // every page is drawn next to, and the screen that changes it is one of them.
  const sidebarSize = new SidebarSize();
  const focus = new RowFocus();
  const dismissals = new Dismissals();

  /**
   * G-3. What day it is, asked once and refreshed whenever the app comes back:
   * the two lists turn over at midnight, and a tab left open overnight has to
   * turn with them. The logic layer never reads a clock — this is the app layer
   * holding one and handing it down, exactly as `now()` is handed to an edit.
   */
  let now = $state(Date.now());
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
  const todayOpen = $derived(router.route.name === 'today');
  const tomorrowOpen = $derived(router.route.name === 'tomorrow');
  const agendaList = $derived(todayOpen ? 'today' : 'tomorrow');
  const agendaOpen = $derived(todayOpen || tomorrowOpen);
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
   * X-21 and X-30. What the two columns draw, from the route and from the row
   * holding the caret — `src/ui/panes.ts`, which is the whole of both rules and
   * is unit-tested there rather than guessed at from the markup here.
   *
   * A note's route draws two things: the note, and the page of the list it
   * hangs under. Both are derived rather than remembered, which is why there is
   * no second route and no stored pair — a link pasted into another device opens
   * the same two panes (X-8), and Back closes the note by leaving the route
   * exactly as it always did. Only a note splits: a folder is a list, and a list
   * beside a list is the same drawing twice; a task has no page to open.
   *
   * X-30 adds the caret as a second way in, and it moves nothing: the left
   * column is a function of the route alone, so a note whose title is being
   * typed opens beside the list the reader is already on. Only a *note's* title
   * feeds it — `focus.noteId` — so a caret landing in a folder or a task leaves
   * the pane exactly as it was. requirements.md §10.3.
   */
  const panes = $derived(
    session === null
      ? { listId: currentId, noteId: null, fromCaret: false }
      : panesFor(session.tree, currentId, focus.noteId),
  );
  const noteId = $derived(panes.noteId);
  const listId = $derived(panes.listId);

  /**
   * X-27. Whether this route draws a list, which is the one question the phone's
   * top bar asks: a bar over Search, Settings or the Done archive has nothing to
   * add to, so it carries the `☰` alone rather than a line that would write into
   * whatever list was last open.
   */
  const listOpen = $derived(
    session !== null &&
      router.route.name !== 'unknown' &&
      !doneOpen &&
      !agendaOpen &&
      !conflictsOpen &&
      !searchOpen &&
      !settingsOpen &&
      !devicesOpen &&
      !logsOpen &&
      (currentId === null || isVisible(session.tree, currentId)),
  );

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
  //
  // X-30's other end, on the same signal: a navigation is the reader choosing
  // what is on screen, so the route decides both panes again and a note the
  // caret raised on the page being left does not follow them to the next one.
  $effect(() => {
    router.route;
    now = Date.now();
    focus.clearNote();
    session?.commitAllBodies();
  });

  function flush(): void {
    void session?.flush();
  }

  function refresh(): void {
    now = Date.now();
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
  <!-- X-27. The phone's top bar, handed to the shell rather than built there:
       the group belongs to a list and only this route knows which list that is —
       the same `listId` the page on the left is drawn from. -->
  {#snippet topbar()}
    {#if listOpen && session}
      <QuickAdd {session} {view} {focus} parent={listId ?? ROOT} />
    {:else if agendaOpen && session}
      <!-- G-5. The same line on a phone, filing under the page's own day. -->
      <QuickAdd {session} {view} {focus} parent={AGENDA} day={dayOfList(agendaList, now)} />
    {/if}
  {/snippet}

  <Shell
    {session}
    {view}
    {dismissals}
    {topbar}
    {currentId}
    {todayOpen}
    {tomorrowOpen}
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
    {:else if agendaOpen}
      <AgendaPage {session} {view} {focus} list={agendaList} {now} />
    {:else if router.route.name === 'unknown'}
      <RecoveryPage {session} id={null} />
    {:else if searchOpen}
      <SearchPage {session} {query} onquery={setQuery} />
    {:else if settingsOpen}
      <SettingsPage {session} {theme} {sidebarSize} {folder} />
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
        <div class="min-w-0 flex-1 {noteId !== null && !panes.fromCaret ? 'pb-[60dvh] lg:pb-0' : ''}">
          <NodePage {session} {view} {focus} id={listId} />
        </div>
        {#if noteId !== null}
          <!-- X-30. The ✕ is the only thing that differs by how the pane was
               opened: a route's closes by leaving the route, and the caret's
               has no route to leave, so it clears the caret instead. -->
          <NotePane
            {session}
            {view}
            {focus}
            id={noteId}
            fromCaret={panes.fromCaret}
            onclose={() => focus.clearNote()}
          />
        {/if}
      </div>
    {/if}
  </Shell>
{:else if choice && choice.kind === 'setup'}
  <FolderSetup need={choice} onchoose={(chosen) => void open(chosen)} />
{:else}
  <p class="p-6 text-sm text-ink-muted" data-testid="loading">Opening the folder…</p>
{/if}
