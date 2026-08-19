<script lang="ts">
  // requirements.md §8. Every device the folder knows about, and a name for the
  // one you are holding.
  //
  // Only this device's name is editable, and that is the design rather than a
  // simplification: the name rides the header of the file this device owns, so
  // naming stays inside the one-writer-per-file rule the whole sync design
  // rests on — past_decision.md §8. Renaming the phone means opening the app on
  // the phone, and the page says so rather than leaving it to be discovered.
  import { labelOf, type DeviceRecord } from '../core/devices';
  import type { Session } from '../app/Session.svelte';
  import { LOGS_HREF } from '../app/router.svelte';

  let { session }: { session: Session } = $props();

  const devices = $derived(session.devices);

  /** D-2 is advisory, so it is worded as an estimate rather than a timestamp. */
  function seen(device: DeviceRecord): string {
    if (device.self) return 'this device';
    if (device.absent) return 'no file in the folder';
    if (device.lastSeen === null) return 'before this version';
    const days = Math.floor((Date.now() - device.lastSeen) / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    return `${Math.floor(days / 30)} months ago`;
  }
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6" data-testid="devices-page">
  <header class="flex flex-col gap-1">
    <h1 class="text-2xl font-semibold" data-testid="page-title">Devices</h1>
    <p class="text-sm text-ink-muted">
      Every device that has written to this folder. A device joins by writing a file and is never
      removed — a retired one costs a few bytes and stops taking part on its own.
    </p>
  </header>

  <ul class="flex flex-col gap-2">
    {#each devices as device (device.id)}
      <li
        class="flex flex-col gap-1 rounded-md border border-line bg-surface-raised px-3 py-2"
        data-testid="device-row"
        data-device={device.id}
        data-self={device.self}
      >
        {#if device.self}
          <label class="flex flex-col gap-1">
            <span class="text-xs text-ink-muted">This device</span>
            <input
              type="text"
              class="w-full rounded border border-line bg-surface px-2 py-1 text-sm"
              placeholder="Name this device"
              maxlength="64"
              data-testid="device-name"
              value={device.name}
              oninput={(event) => session.rename(event.currentTarget.value)}
            />
          </label>
        {:else}
          <span class="text-sm" data-testid="device-label">{labelOf(device)}</span>
        {/if}
        <span class="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
          <span data-testid="device-id">{device.id}</span>
          <span data-testid="device-seen">· {seen(device)}</span>
          {#if device.self}
            <!-- D-4. Only this device's log is readable, and only from the row
                 that is this device — requirements.md §8. -->
            <a href={LOGS_HREF} class="ml-auto text-ink-muted hover:text-accent" data-testid="log-link">
              View log →
            </a>
          {/if}
        </span>
      </li>
    {/each}
  </ul>

  <p class="px-1 text-xs text-ink-faint">
    Only this device can be renamed from here. The name travels in the file this device writes, and
    no device ever writes another's — which is what keeps two devices from ever disagreeing about a
    name. Open the app on the other one to name it.
  </p>
</div>
