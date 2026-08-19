<script lang="ts">
  // The one screen that asks for anything — architecture.md §4's branches that
  // need a click.
  //
  // It has two buttons and no third state: pick a folder, or work in this
  // browser alone. A browser that cannot hold a folder handle is still a
  // browser the whole application runs in, and the folder is what it is missing
  // — so the fallback is offered rather than an apology, and what it costs is
  // said plainly here and again in the footer for as long as it is in use.
  import { browserOnly, grantFolder, rememberMode, type FolderChoice, type NeedsFolder } from '../app/folder-choice';
  import { bridge } from '../adapters/android-folder';

  let { need, onchoose }: { need: NeedsFolder; onchoose: (choice: FolderChoice) => void } = $props();

  let failure = $state<string | null>(null);

  async function pick(): Promise<void> {
    failure = null;
    try {
      onchoose(await grantFolder());
    } catch (error) {
      // A cancelled picker throws, and cancelling is not an error to report as
      // one — the screen simply stays where it was.
      failure = String(error);
    }
  }

  function pickOnAndroid(): void {
    // The system picker is the shell's, and the page reloads once it is granted.
    bridge()?.pickFolder();
  }

  function useThisBrowser(): void {
    rememberMode('local');
    onchoose(browserOnly());
  }
</script>

<div class="mx-auto flex max-w-lg flex-col gap-4 px-4 py-10" data-testid="folder-setup">
  <h1 class="text-2xl font-semibold">Where should this device keep its checklist?</h1>
  <p class="text-sm text-ink-muted">
    Pick the folder your cloud app already syncs — the same one on every device. Nothing is uploaded
    by this app: it writes one file, and the folder's own client carries it.
  </p>
  <p class="text-sm text-ink-faint" data-testid="setup-reason">{need.reason}</p>

  <div class="flex flex-col gap-2">
    {#if need.how === 'android'}
      <button
        type="button"
        class="row-control rounded-md bg-accent px-3 py-2 text-sm font-medium text-surface-raised"
        data-testid="setup-pick"
        onclick={pickOnAndroid}
      >
        Choose a folder
      </button>
    {:else if need.how === 'fsaa' || need.how === 'fsaa-regrant'}
      <button
        type="button"
        class="row-control rounded-md bg-accent px-3 py-2 text-sm font-medium text-surface-raised"
        data-testid="setup-pick"
        onclick={pick}
      >
        {need.how === 'fsaa-regrant' ? 'Open the folder again' : 'Choose a folder'}
      </button>
    {/if}

    <button
      type="button"
      class="row-control rounded-md border border-line px-3 py-2 text-sm hover:bg-surface-sunken"
      data-testid="setup-local"
      onclick={useThisBrowser}
    >
      Use this browser only — no sync
    </button>
  </div>

  {#if failure}
    <p class="text-sm text-danger" data-testid="setup-failure">{failure}</p>
  {/if}

  <p class="text-xs text-ink-faint">
    "This browser only" keeps everything on this device, in this browser. It can be changed later,
    but the rows already written here do not follow — they are in this browser, not in a folder.
  </p>
</div>
