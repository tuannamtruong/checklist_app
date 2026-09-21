<script lang="ts">
  // X-12. Everything that is about this device rather than about the tree, in
  // one place — requirements.md §10.
  //
  // Four things share it and they are the same kind of thing: which folder this
  // device syncs through (X-15 to X-17), what it calls itself (D-1), what it has
  // written (D-4), and how it looks (X-13). Only the name writes an op; the rest
  // is device-local, which is why none of this needed a nav entry of its own
  // before there was a screen to gather them onto.
  import { PROVIDERS, isProviderId } from '../core/providers';
  import { THEMES } from '../core/themes';
  import type { OpenFolder } from '../app/folder-choice';
  import { rememberProvider, storedProvider } from '../app/provider';
  import { shellActions } from '../app/shell';
  import type { Theme } from '../app/theme.svelte';
  import type { Session } from '../app/Session.svelte';
  import { DEVICES_HREF, LOGS_HREF } from '../app/router.svelte';

  let {
    session,
    theme,
    folder,
  }: { session: Session; theme: Theme; folder: OpenFolder } = $props();

  const self = $derived(session.devices.find((device) => device.self));
  const peers = $derived(session.devices.length - 1);

  // X-15 to X-17. What this shell can do, asked once per folder rather than
  // assumed: an APK older than X-15 has no `openFolder`, and a browser has none
  // of it — architecture.md §4.1.
  const shell = $derived(shellActions(folder.source));
  let provider = $state(storedProvider());
  let folderProblem = $state<string | null>(null);

  function chooseProvider(value: string): void {
    const id = isProviderId(value) ? value : null;
    rememberProvider(id);
    provider = PROVIDERS.find((candidate) => candidate.id === id) ?? null;
  }

  /** Every folder button reports the same way: the shell throws, the row says so. */
  async function attempt(action: () => Promise<void>): Promise<void> {
    folderProblem = null;
    try {
      await action();
    } catch (error) {
      folderProblem = String(error instanceof Error ? error.message : error);
    }
  }

  /**
   * Changing the folder reloads, and a reload after an unflushed edit would
   * leave that edit in a folder this device is walking away from — §10.2.
   */
  async function changeFolder(): Promise<void> {
    const change = shell.changeFolder;
    if (!change) return;
    await session.flush();
    await attempt(change);
  }
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6" data-testid="settings-page">
  <header class="flex flex-col gap-1">
    <h1 class="text-2xl font-semibold" data-testid="page-title">Settings</h1>
    <p class="text-sm text-ink-muted">
      This device: which folder it syncs through, what it is called, what it has written, and how it
      looks. Only the name travels to the other devices — the rest is this device's own.
    </p>
  </header>

  <!-- X-15 to X-17. What this device writes to, how to look inside it, and how
       to point it somewhere else — requirements.md §10.2. The buttons a shell
       cannot honour are absent rather than dead. -->
  <section class="flex flex-col gap-3" data-testid="settings-folder">
    <div class="flex flex-col gap-0.5">
      <h2 class="text-sm font-semibold">Sync folder</h2>
      <p class="text-xs text-ink-faint">
        This device writes one file into it and reads every other device's. Nothing is uploaded by
        this app — the folder's own client carries it.
      </p>
    </div>

    <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
      <dt class="text-ink-faint">Folder</dt>
      <dd class="min-w-0 truncate" data-testid="settings-folder-label">{folder.label}</dd>
      <dt class="text-ink-faint">Reaches</dt>
      <!-- A peer in the folder outranks what the adapter says it can do: a
           device that is reading another's file is reaching it, whatever the
           fallback's label claims. The sidebar's warning is the other half of
           this and is not conditional on the count — architecture.md §4. -->
      <dd class="min-w-0" data-testid="settings-folder-synced">
        {#if session.peers > 0}
          {session.peers} other device{session.peers === 1 ? '' : 's'}
        {:else if !folder.synced}
          This device only — nothing here syncs
        {:else}
          No other device yet
        {/if}
      </dd>
    </dl>

    <div class="flex flex-wrap gap-2">
      {#if shell.openFolder}
        <button
          type="button"
          class="row-control rounded-md border border-line px-2.5 py-1.5 text-sm hover:border-accent hover:text-accent"
          data-testid="open-folder"
          onclick={() => attempt(shell.openFolder!)}
        >
          Open the folder
        </button>
      {/if}
      {#if shell.changeFolder}
        <button
          type="button"
          class="row-control rounded-md border border-line px-2.5 py-1.5 text-sm hover:border-accent hover:text-accent"
          data-testid="change-folder"
          onclick={changeFolder}
        >
          Use a different folder…
        </button>
      {/if}
    </div>

    <!-- The note outranks the default line: a shell that named one is saying
         who decides the folder instead, which the default does not —
         requirements.md §10.2. -->
    {#if shell.changeNote}
      <p class="text-xs text-ink-faint" data-testid="change-note">{shell.changeNote}</p>
    {:else if shell.changeFolder}
      <p class="text-xs text-ink-faint">
        A different folder is read from scratch: the rows already written stay in this one.
      </p>
    {/if}

    <!-- X-17. The provider is a label this device keeps, and the one thing it
         buys is the button beside it. A device that has named none has none. -->
    <div class="flex flex-wrap items-end gap-2">
      <label class="flex flex-col gap-1">
        <span class="text-xs text-ink-muted">Cloud app</span>
        <select
          class="rounded border border-line bg-surface-raised px-2 py-1.5 text-sm"
          data-testid="provider"
          value={provider?.id ?? ''}
          onchange={(event) => chooseProvider(event.currentTarget.value)}
        >
          <option value="">Not set</option>
          {#each PROVIDERS as choice (choice.id)}
            <option value={choice.id}>{choice.label}</option>
          {/each}
        </select>
      </label>
      {#if shell.openApp && provider}
        <button
          type="button"
          class="row-control rounded-md border border-line px-2.5 py-1.5 text-sm hover:border-accent hover:text-accent"
          data-testid="open-provider"
          onclick={() => attempt(() => shell.openApp!(provider!))}
        >
          Open {provider.label}
        </button>
      {/if}
    </div>

    {#if folderProblem}
      <p class="text-sm text-danger" data-testid="folder-problem">{folderProblem}</p>
    {/if}
  </section>

  <!-- X-13. The swatch carries `data-theme` itself, so each button previews the
       palette it names rather than the one the page is wearing — §10.1. -->
  <section class="flex flex-col gap-3" data-testid="settings-appearance">
    <div class="flex flex-col gap-0.5">
      <h2 class="text-sm font-semibold">Appearance</h2>
      <p class="text-xs text-ink-faint">
        Stays on this device. The phone and the laptop can look nothing alike.
      </p>
    </div>

    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {#each THEMES as choice (choice.id)}
        <button
          type="button"
          class="row-control flex items-center gap-3 rounded-md border px-2 py-2 text-left hover:bg-surface-sunken"
          class:border-accent={theme.current === choice.id}
          class:border-line={theme.current !== choice.id}
          data-testid="theme-option"
          data-theme-id={choice.id}
          aria-pressed={theme.current === choice.id}
          onclick={() => theme.set(choice.id)}
        >
          <span
            class="flex size-9 shrink-0 flex-col justify-between overflow-hidden rounded border border-line bg-surface p-1"
            data-theme={choice.id}
            aria-hidden="true"
          >
            <span class="h-1.5 w-full rounded-full bg-accent"></span>
            <span class="h-1 w-2/3 rounded-full bg-ink-muted"></span>
            <span class="h-1 w-1/2 rounded-full bg-line"></span>
          </span>
          <span class="flex min-w-0 flex-col">
            <span class="truncate text-sm">{choice.label}</span>
            <span class="truncate text-xs text-ink-faint">{choice.note}</span>
          </span>
        </button>
      {/each}
    </div>
  </section>

  <!-- D-1. The one editor for the name: `#/devices` lists what every device has
       said about itself and edits none of them — requirements.md §8. -->
  <section class="flex flex-col gap-3" data-testid="settings-device">
    <div class="flex flex-col gap-0.5">
      <h2 class="text-sm font-semibold">This device</h2>
      <p class="text-xs text-ink-faint">
        The name travels in the file this device writes, so it is the name the other devices see —
        on a conflict row, and in the list. Naming another one means opening the app on it.
      </p>
    </div>

    <label class="flex flex-col gap-1">
      <span class="text-xs text-ink-muted">Device name</span>
      <input
        type="text"
        class="w-full rounded border border-line bg-surface-raised px-2 py-1.5 text-sm"
        placeholder="Name this device"
        maxlength="64"
        data-testid="device-name"
        value={self?.name ?? ''}
        oninput={(event) => session.rename(event.currentTarget.value)}
      />
    </label>

    <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
      <dt class="text-ink-faint">Device id</dt>
      <dd class="min-w-0 truncate font-mono" data-testid="settings-device-id">{session.deviceId}</dd>
    </dl>

    <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      <!-- D-4, and the only way to the log — requirements.md §5. -->
      <a href={LOGS_HREF} class="text-ink-muted hover:text-accent" data-testid="log-link">
        View log →
      </a>
      <a href={DEVICES_HREF} class="text-ink-muted hover:text-accent" data-testid="devices-link">
        {peers === 0 ? 'Devices' : `Devices (${peers} other${peers === 1 ? '' : 's'})`} →
      </a>
    </div>
  </section>
</div>
