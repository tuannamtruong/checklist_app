<script lang="ts">
  // X-12. Everything that is about this device rather than about the tree, in
  // one place — requirements.md §10.
  //
  // Four things share it and they are the same kind of thing: which folder this
  // device syncs through (X-15, X-16), what it calls itself (D-1), what it has
  // written (D-4), and how it looks — the theme (X-13), the two colours picked
  // over it (X-35) and the size of the sidebar's type (X-25), which are three
  // settings rather than one because a theme is fourteen colours and never a
  // size (§10.1), and because two of those fourteen are a taste rather than a
  // palette (past_decision.md §20). Only the name writes an op; the rest is device-local, which is why none of this needed a nav entry
  // of its own before there was a screen to gather them onto.
  //
  // X-33 adds a fifth that changes nothing at all: the keyboard reference. It
  // is here because it is the same *kind* of thing — a fact about how this
  // device is driven — and because a reference belongs somewhere a person goes
  // once, not on every row's menu where it was read once and then scrolled past
  // ten times a day.
  import { THEMES } from '../core/themes';
  import { COLOUR_PICKS, normaliseHex, type ColourRole } from '../core/colour';
  import { KEY_HELP } from './keyboard';
  import { SIDEBAR_SIZES } from '../core/sidebar-size';
  import type { OpenFolder } from '../app/folder-choice';
  import { shellActions } from '../app/shell';
  import type { Theme } from '../app/theme.svelte';
  import { wornColour, type ThemeColours } from '../app/theme-colour.svelte';
  import type { SidebarSize } from '../app/sidebar-size.svelte';
  import type { Session } from '../app/Session.svelte';
  import { DEVICES_HREF, LOGS_HREF } from '../app/router.svelte';

  let {
    session,
    theme,
    colours,
    sidebarSize,
    folder,
  }: {
    session: Session;
    theme: Theme;
    colours: ThemeColours;
    sidebarSize: SidebarSize;
    folder: OpenFolder;
  } = $props();

  // X-35. Three pieces of state per colour, and none of them is the colour: the
  // pick itself lives in `colours`, and these are what a *picker* needs.
  //
  // `worn` is what the app is wearing right now — the pick, or the theme's own
  // where there is none — read off the swatch after every paint, because
  // `<input type="color">` opens on its own value and black is not where anyone
  // wants to start.
  //
  // `typed` is what is in the field while somebody is typing into it, and it is
  // there so that the field is never rewritten under the caret: `#abc` is a
  // colour the moment it is three characters, and a field showing the pick
  // would expand it to `#aabbcc` with three more characters still to come. It
  // falls back to `null` — follow the pick — the moment the field is left or
  // the colour is set from anywhere else.
  const swatch = $state<Record<ColourRole, HTMLElement | undefined>>({
    accent: undefined,
    ink: undefined,
  });
  const worn = $state<Record<ColourRole, string>>({ accent: '#000000', ink: '#000000' });
  const typed = $state<Record<ColourRole, string | null>>({ accent: null, ink: null });

  $effect(() => {
    // Re-read whenever either half of the answer moves: the theme under the
    // pick, or the pick itself.
    void theme.current;
    void colours.picks.accent;
    void colours.picks.ink;
    for (const pick of COLOUR_PICKS) {
      const element = swatch[pick.id];
      if (!element) continue;
      const hex = wornColour(element);
      if (hex) worn[pick.id] = hex;
    }
  });

  /** A typed code applies the moment it is a colour, and stays on screen until it is one. */
  function typeColour(role: ColourRole, value: string): void {
    typed[role] = value;
    if (value.trim() === '') colours.clear(role);
    else colours.set(role, value);
  }

  /** What the field shows: what is being typed, or the pick, or nothing at all. */
  function shown(role: ColourRole): string {
    return typed[role] ?? colours.picks[role] ?? '';
  }

  /** Half a hex code is not a colour yet, and the field says so rather than swallowing it. */
  function halfTyped(role: ColourRole): boolean {
    const value = typed[role];
    return value !== null && value.trim() !== '' && normaliseHex(value) === null;
  }

  const self = $derived(session.devices.find((device) => device.self));
  const peers = $derived(session.devices.length - 1);

  // X-15 and X-16. What this shell can do, asked once per folder rather than
  // assumed: an APK older than X-15 has no `openFolder`, and a browser has none
  // of it — architecture.md §4.1.
  const shell = $derived(shellActions(folder.source));
  let folderProblem = $state<string | null>(null);

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
  </header>

  <!-- X-15 and X-16. What this device writes to, how to look inside it, and how
       to point it somewhere else — requirements.md §10.2. The buttons a shell
       cannot honour are absent rather than dead. -->
  <section class="flex flex-col gap-3" data-testid="settings-folder">
    <div class="flex flex-col gap-0.5">
      <h2 class="text-sm font-semibold">Sync folder</h2>
    </div>

    <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
      <dt class="text-ink-faint">Folder</dt>
      <dd class="min-w-0 truncate" data-testid="settings-folder-label">
        {folder.source === 'local' ? 'local browser storage' : folder.label}
      </dd>
      <dt class="text-ink-faint">Reaches</dt>
      <!-- A peer in the folder outranks what the adapter says it can do: a
           device that is reading another's file is reaching it, whatever the
           fallback's label claims. The sidebar's warning is the other half of
           this and is not conditional on the count — architecture.md §4. -->
      <dd class="min-w-0" data-testid="settings-folder-synced">
        {#if session.peers > 0}
          {session.peers} other device{session.peers === 1 ? '' : 's'}
        {:else if !folder.synced}
          local browser
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

    {#if folderProblem}
      <p class="text-sm text-danger" data-testid="folder-problem">{folderProblem}</p>
    {/if}
  </section>

  <!-- X-13. The swatch carries `data-theme` itself, so each button previews the
       palette it names rather than the one the page is wearing — §10.1. -->
  <section class="flex flex-col gap-3" data-testid="settings-appearance">
    <div class="flex flex-col gap-0.5">
      <h2 class="text-sm font-semibold">Appearance</h2>
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

    <!-- X-35. Two of the theme's fourteen tokens, picked over whichever theme is
         chosen — §10.1. Each row is one control wearing three hats: the swatch
         shows the colour the app is in whether or not anything is picked, the
         transparent `<input type="color">` over it is what opens the system's
         picker, and the field beside it takes a code that is already written
         down somewhere. Clearing is drawn only while there is something to
         clear, which is what says "this one is the theme's". -->
    <div class="flex flex-col gap-2" data-testid="settings-colours">
      <div class="flex flex-col gap-0.5">
        <h3 class="text-sm font-medium">Colours</h3>
      </div>

      {#each COLOUR_PICKS as pick (pick.id)}
        <div
          class="flex items-center gap-3"
          data-testid="colour-pick"
          data-colour-role={pick.id}
        >
          <span class="relative inline-flex size-9 shrink-0">
            <input
              type="color"
              class="row-control absolute inset-0 size-full cursor-pointer opacity-0"
              value={colours.picks[pick.id] ?? worn[pick.id]}
              aria-label={pick.label}
              data-testid="colour-picker"
              oninput={(event) => {
                colours.set(pick.id, event.currentTarget.value);
                typed[pick.id] = null;
              }}
            />
            <span
              class="colour-swatch pointer-events-none size-full rounded border border-line"
              style="--swatch-colour: var({pick.token})"
              bind:this={swatch[pick.id]}
              data-testid="colour-swatch"
              aria-hidden="true"
            ></span>
          </span>

          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-sm">{pick.label}</span>
            <span class="truncate text-xs text-ink-faint">{pick.note}</span>
          </span>

          <input
            type="text"
            class="w-36 rounded-md border bg-surface-raised px-2 py-1 font-mono text-sm"
            class:border-danger={halfTyped(pick.id)}
            class:border-line={!halfTyped(pick.id)}
            value={shown(pick.id)}
            placeholder="From the theme"
            spellcheck="false"
            autocapitalize="off"
            aria-label="{pick.label} as a hex code"
            aria-invalid={halfTyped(pick.id)}
            data-testid="colour-hex"
            oninput={(event) => typeColour(pick.id, event.currentTarget.value)}
            onblur={() => (typed[pick.id] = null)}
          />

          {#if colours.picks[pick.id]}
            <button
              type="button"
              class="row-control rounded-md border border-line px-2 py-1 text-sm text-ink-muted hover:bg-surface-sunken"
              data-testid="colour-clear"
              onclick={() => {
                colours.clear(pick.id);
                typed[pick.id] = null;
              }}
            >
              Reset
            </button>
          {/if}
        </div>
      {/each}
    </div>

    <!-- X-25. The sidebar's type, not its width: the width is dragged by the
         grip on the column's own edge (X-20), and a preset here would undo a
         drag the reader made — §10.4. Each button carries `data-sidebar-size`
         itself, so the sample inside it is drawn at the step it names — X-13's
         swatch, applied to type rather than to colour. -->
    <div class="flex flex-col gap-2" data-testid="settings-sidebar-size">
      <div class="flex flex-col gap-0.5">
        <h3 class="text-sm font-medium">Sidebar text</h3>
      </div>

      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {#each SIDEBAR_SIZES as choice (choice.id)}
          <button
            type="button"
            class="row-control flex items-center gap-2 rounded-md border px-2 py-2 text-left hover:bg-surface-sunken"
            class:border-accent={sidebarSize.current === choice.id}
            class:border-line={sidebarSize.current !== choice.id}
            data-testid="sidebar-size-option"
            data-sidebar-size={choice.id}
            aria-pressed={sidebarSize.current === choice.id}
            onclick={() => sidebarSize.set(choice.id)}
          >
            <span class="sidebar-text truncate" aria-hidden="true">Aa</span>
            <span class="flex min-w-0 flex-col">
              <span class="truncate text-sm">{choice.label}</span>
              <span class="truncate text-xs text-ink-faint">{choice.note}</span>
            </span>
          </button>
        {/each}
      </div>
    </div>
  </section>

  <!-- X-33. The whole keyboard, in one place, from the one list `keyboard.ts`
       binds — a second copy of it here would be a second thing to keep true,
       which is exactly what the row menu's copy became. `keyboard.test.ts`
       fails if a key is bound and not taught here. -->
  <section class="flex flex-col gap-3" data-testid="settings-keyboard">
    <h2 class="text-sm font-semibold">Keyboard</h2>

    <dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm" data-testid="key-help">
      {#each KEY_HELP as entry (entry.keys)}
        <dt class="min-w-0 text-ink-muted">{entry.label}</dt>
        <dd class="shrink-0 text-right">
          <kbd class="rounded border border-line bg-surface-sunken px-1.5 py-0.5 text-xs">
            {entry.keys}
          </kbd>
        </dd>
      {/each}
    </dl>
  </section>

  <!-- D-1. The one editor for the name: `#/devices` lists what every device has
       said about itself and edits none of them — requirements.md §8. -->
  <section class="flex flex-col gap-3" data-testid="settings-device">
    <div class="flex flex-col gap-0.5">
      <h2 class="text-sm font-semibold">This device</h2>
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
