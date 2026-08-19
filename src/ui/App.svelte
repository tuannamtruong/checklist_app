<script lang="ts">
  // Startup: find a folder, open this device's log, fold it into the store, and
  // hand the store to the views. Everything asynchronous happens here, once.
  //
  // Two things arrive with M2. The folder may need a click before it exists at
  // all — architecture.md §4 — so the shell can be a setup screen rather than a
  // tree; and the sync cycle runs from here, driven by activity and focus
  // rather than by a timer (S-19).
  import { isVisible } from '../core/tree';
  import { deviceId } from '../app/device';
  import { chooseFolder, type FolderChoice } from '../app/folder-choice';
  import { Dismissals } from '../app/dismissals.svelte';
  import { Router } from '../app/router.svelte';
  import { Session } from '../app/Session.svelte';
  import { SyncCadence } from '../app/sync-cadence';
  import { ViewState } from '../app/view-state.svelte';
  import { RowFocus } from './focus.svelte';
  import ConflictsPage from './ConflictsPage.svelte';
  import DonePage from './DonePage.svelte';
  import FolderSetup from './FolderSetup.svelte';
  import NodePage from './NodePage.svelte';
  import RecoveryPage from './RecoveryPage.svelte';
  import Shell from './Shell.svelte';

  const router = new Router();
  const view = new ViewState();
  const focus = new RowFocus();
  const dismissals = new Dismissals();

  let choice = $state<FolderChoice | null>(null);
  let session = $state<Session | null>(null);
  let cadence: SyncCadence | null = null;

  void chooseFolder().then((chosen) => open(chosen));

  async function open(chosen: FolderChoice): Promise<void> {
    choice = chosen;
    if (chosen.kind !== 'folder') return;
    const opened = await Session.open(chosen.folder, deviceId());
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

<svelte:window
  onpagehide={flush}
  onfocus={refresh}
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
    folderLabel={folder.label}
    synced={folder.synced}
    onrefresh={refresh}
  >
    {#if conflictsOpen}
      <ConflictsPage {session} {dismissals} />
    {:else if router.route.name === 'unknown'}
      <RecoveryPage {session} id={null} />
    {:else if doneOpen}
      <DonePage {session} />
    {:else if currentId !== null && !isVisible(session.tree, currentId)}
      <RecoveryPage {session} id={currentId} />
    {:else}
      <NodePage {session} {view} {focus} id={currentId} />
    {/if}
  </Shell>
{:else if choice && choice.kind === 'setup'}
  <FolderSetup need={choice} onchoose={(chosen) => void open(chosen)} />
{:else}
  <p class="p-6 text-sm text-ink-muted" data-testid="loading">Opening the folder…</p>
{/if}
