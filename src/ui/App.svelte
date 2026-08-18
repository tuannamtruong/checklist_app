<script lang="ts">
  // Startup: pick a folder, open this device's log, fold it into the store, and
  // hand the store to the views. Everything asynchronous happens here, once.
  import { isVisible } from '../core/tree';
  import { deviceId } from '../app/device';
  import { chooseFolder } from '../app/folder-choice';
  import { Router } from '../app/router.svelte';
  import { Session } from '../app/Session.svelte';
  import { ViewState } from '../app/view-state.svelte';
  import { RowFocus } from './focus.svelte';
  import DonePage from './DonePage.svelte';
  import NodePage from './NodePage.svelte';
  import RecoveryPage from './RecoveryPage.svelte';
  import Shell from './Shell.svelte';

  const choice = chooseFolder();
  const router = new Router();
  const view = new ViewState();
  const focus = new RowFocus();
  const opening = Session.open(choice.folder, deviceId());

  let session = $state<Session | null>(null);
  opening.then((opened) => (session = opened));

  const currentId = $derived(router.route.name === 'node' ? router.route.id : null);
  const doneOpen = $derived(router.route.name === 'done');

  // S-20's "on navigating away": leaving a note's page emits its body, and so
  // does leaving the page altogether.
  $effect(() => {
    router.route;
    session?.commitAllBodies();
  });

  function flush(): void {
    void session?.flush();
  }
</script>

<svelte:window
  onpagehide={flush}
  onvisibilitychange={() => document.visibilityState === 'hidden' && flush()}
/>

{#if session}
  <Shell {session} {view} {currentId} {doneOpen} folderLabel={choice.label}>
    {#if router.route.name === 'unknown'}
      <RecoveryPage {session} id={null} />
    {:else if doneOpen}
      <DonePage {session} />
    {:else if currentId !== null && !isVisible(session.tree, currentId)}
      <RecoveryPage {session} id={currentId} />
    {:else}
      <NodePage {session} {view} {focus} id={currentId} />
    {/if}
  </Shell>
{:else}
  <p class="p-6 text-sm text-ink-muted" data-testid="loading">Opening the folder…</p>
{/if}
