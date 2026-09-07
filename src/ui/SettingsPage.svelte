<script lang="ts">
  // X-12. Everything that is about this device rather than about the tree, in
  // one place — requirements.md §10.
  //
  // Three things share it and they are the same kind of thing: what this device
  // calls itself (D-1), what it has written (D-4), and how it looks (X-13). Only
  // the first of them writes an op; the other two are device-local, which is why
  // none of this needed a nav entry of its own before there was a screen to
  // gather them onto.
  import { THEMES } from '../core/themes';
  import type { Theme } from '../app/theme.svelte';
  import type { Session } from '../app/Session.svelte';
  import { DEVICES_HREF, LOGS_HREF } from '../app/router.svelte';

  let { session, theme }: { session: Session; theme: Theme } = $props();

  const self = $derived(session.devices.find((device) => device.self));
  const peers = $derived(session.devices.length - 1);
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6" data-testid="settings-page">
  <header class="flex flex-col gap-1">
    <h1 class="text-2xl font-semibold" data-testid="page-title">Settings</h1>
    <p class="text-sm text-ink-muted">
      This device: what it is called, what it has written, and how it looks. Only the name travels to
      the other devices — the rest is this device's own.
    </p>
  </header>

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
