<script lang="ts">
  // D-4. What this device has written into its own file, newest first —
  // requirements.md §8.
  //
  // Nothing on this page writes: the log is the record of every edit, and a view
  // of the record that can amend it is not a record. It is reached from the
  // "this device" row of #/devices rather than from the nav, because it is about
  // one device and that page is where a device is already the subject.
  //
  // Two honesty notes are on screen rather than in a comment. Compaction rewrote
  // this file (S-14), so what is listed is the ops that survived the cut and not
  // the history; and the byte count is what the last write cost, not what the
  // next one will, because the write is debounced by 250 ms.
  import { logEntries } from '../core/log-view';
  import { nameOf } from '../core/devices';
  import { deviceFileName } from '../core/op-log';
  import type { Session } from '../app/Session.svelte';
  import { SETTINGS_HREF, nodeHref } from '../app/router.svelte';

  let { session }: { session: Session } = $props();

  /** Long enough to cover a session's editing, short enough to render at once. */
  const PAGE = 200;

  let shown = $state(PAGE);

  const ops = $derived(session.ownOps);
  const entries = $derived(logEntries(ops, session.nodes, shown));
  const clock = $derived(session.ownClock);

  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

  /** Today by the clock on the wall, so a day-old op is not read as a fresh one. */
  function when(at: number): string {
    const date = new Date(at);
    const today = new Date();
    const sameDay =
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate();
    return sameDay ? time.format(date) : `${day.format(date)} ${time.format(date)}`;
  }

  /** A delete reads as loss and a restore as recovery; the rest are ordinary. */
  function tone(op: string): string {
    if (op === 'delete') return 'text-danger';
    if (op === 'restore' || op === 'create') return 'text-accent';
    return 'text-ink-muted';
  }
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6" data-testid="logs-page">
  <header class="flex flex-col gap-1">
    <a href={SETTINGS_HREF} class="text-xs text-ink-muted hover:text-accent" data-testid="back-link">
      ← Settings
    </a>
    <h1 class="text-2xl font-semibold" data-testid="page-title">Log</h1>
    <p class="text-sm text-ink-muted">
      Every op this device has written, newest first. This is the file itself, read back — no other
      device's log is here, and nothing on this page writes one.
    </p>
  </header>

  <dl
    class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-line bg-surface-raised px-3 py-2 text-xs"
    data-testid="log-header"
  >
    <dt class="text-ink-faint">File</dt>
    <dd class="min-w-0 truncate font-mono" data-testid="log-file">
      {deviceFileName(session.deviceId)}
    </dd>
    <dt class="text-ink-faint">Ops</dt>
    <dd data-testid="log-count">{ops.length}</dd>
    <dt class="text-ink-faint">Size</dt>
    <dd data-testid="log-bytes">{session.logBytes} bytes, as of the last write</dd>
    <dt class="text-ink-faint">Vector</dt>
    <dd class="flex flex-wrap gap-x-3 gap-y-1" data-testid="log-clock">
      <!-- The header line's own vector: this device's counter, then a receipt
           for every peer it has folded in — sync-flow.md §4.2. -->
      {#each Object.entries(clock) as [device, counter] (device)}
        <span class:text-accent={device === session.deviceId}>
          {nameOf(session.devices, device)}
          <span class="font-mono">{counter}</span>
        </span>
      {:else}
        <span class="text-ink-faint">nothing written yet</span>
      {/each}
    </dd>
  </dl>

  <ul class="flex flex-col">
    {#each entries as entry (entry.c + ':' + entry.id + ':' + entry.at)}
      <li
        class="flex flex-col gap-0.5 border-b border-line px-1 py-1.5 text-sm last:border-b-0 sm:flex-row sm:items-baseline sm:gap-2"
        data-testid="log-entry"
        data-op={entry.op}
      >
        <!-- Counter, clock and op are one meta line on a phone and three aligned
             columns from `sm` up: at 390px a fixed timestamp column wraps to
             three lines, and `contents` dissolves this wrapper so the columns are
             the row's own — X-1, one markup for both. -->
        <span class="flex items-baseline gap-2 sm:contents">
          <span
            class="shrink-0 text-right font-mono text-xs text-ink-faint sm:w-10"
            title="This device's counter for the op"
            data-testid="log-counter"
          >
            {entry.c}
          </span>
          <span
            class="shrink-0 font-mono text-xs text-ink-faint sm:w-36 sm:whitespace-nowrap"
            title={new Date(entry.at).toISOString()}
            data-testid="log-time"
          >
            {when(entry.at)}
          </span>
          <span class="shrink-0 text-xs font-medium sm:w-14 {tone(entry.op)}" data-testid="log-op">
            {entry.op}
          </span>
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          {#if entry.gone}
            <span class="truncate text-ink-faint italic" data-testid="log-title">
              {entry.id}
            </span>
          {:else}
            <a
              href={nodeHref(entry.id)}
              class="truncate hover:text-accent"
              data-testid="log-title"
            >
              {entry.title || 'Untitled'}
            </a>
          {/if}
          <span class="truncate text-xs text-ink-muted" data-testid="log-detail">
            {entry.detail}
          </span>
        </span>
        {#if entry.seen.length > 0}
          <!-- An op carrying a receipt is the one that recorded a peer's edit as
               folded in, which is what makes it not concurrent with what follows. -->
          <span
            class="shrink-0 rounded-full bg-accent-soft px-1.5 text-xs text-accent"
            title="Recorded a receipt for {entry.seen.join(', ')}"
            data-testid="log-seen"
          >
            seen {entry.seen.length}
          </span>
        {/if}
      </li>
    {:else}
      <li class="px-1 py-3 text-sm text-ink-muted" data-testid="log-empty">
        This device has written nothing yet. The first edit puts an op here.
      </li>
    {/each}
  </ul>

  {#if ops.length > entries.length}
    <button
      type="button"
      class="row-control self-start rounded border border-line px-2 py-1 text-xs hover:bg-surface-sunken"
      data-testid="log-more"
      onclick={() => (shown += PAGE)}
    >
      Show older ({ops.length - entries.length} more)
    </button>
  {/if}

  <p class="px-1 text-xs text-ink-faint">
    Compaction rewrites this file in place, dropping ops of this device's own that a later op of its
    own already overwrote — so a row edited many times shows the writes that survived rather than
    every one ever made. The tree it folds to is identical either way.
  </p>
</div>
