// What the shell around the page can do besides hold the folder — X-15 to X-17,
// architecture.md §4.1.
//
// This is deliberately *not* the folder adapter. The adapter is three methods
// and stays three, because a fourth exists for one shell and is a stub in the
// other five — code-standard.md §3. Opening a folder window, launching the
// provider's app and re-picking the folder are none of the adapter's business,
// nothing in the sync path calls any of them, and a shell that offers none at
// all syncs identically.
//
// A capability this shell does not have is `null` rather than a function that
// fails: the settings screen renders the buttons it is given, so an absent
// capability is an absent button.

import { bridge } from '../adapters/android-folder';
import { supported } from '../adapters/fsaa-folder';
import { grantFolder, type FolderSource } from './folder-choice';
import type { Provider } from '../core/providers';

/** The loopback helper's own prefix, beside `/folder` — packaging/windows/serve.py. */
const SHELL_BASE = '/shell';

export interface ShellActions {
  /** Show the folder in whatever the system opens folders with. */
  openFolder: (() => Promise<void>) | null;
  /** Launch the provider's own client, so it can carry what this device wrote. */
  openApp: ((provider: Provider) => Promise<void>) | null;
  /**
   * Point this device at a different folder. It reloads the page: the tree is
   * read from the folder at startup and nowhere else, so a new folder is a new
   * startup — requirements.md §10.2.
   */
  changeFolder: (() => Promise<void>) | null;
  /** Who decides the folder instead, when this shell does not offer to. */
  changeNote: string | null;
}

const NONE: ShellActions = { openFolder: null, openApp: null, changeFolder: null, changeNote: null };

/** The bridge's contract: an empty string, or a message the page shows. */
function orThrow(failure: string | undefined): void {
  if (failure) throw new Error(failure);
}

async function askHelper(body: Record<string, string>): Promise<void> {
  const response = await fetch(`${SHELL_BASE}/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.ok) return;
  // A helper older than X-15 has no route at all, which reads as a 404 like any
  // other miss. Say what it means rather than showing the status.
  if (response.status === 404) {
    const answer = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(answer?.error ?? 'this helper is too old to open anything');
  }
  throw new Error(`the helper answered ${response.status}`);
}

/** The picker, then a reload — the caller has already flushed what it owed. */
async function pickAndReload(): Promise<void> {
  const chosen = await grantFolder();
  if (chosen.kind !== 'folder') throw new Error(chosen.reason);
  window.location.reload();
}

export function shellActions(source: FolderSource): ShellActions {
  switch (source) {
    case 'android': {
      const android = bridge();
      if (!android) return NONE;
      return {
        openFolder: android.openFolder ? async () => orThrow(android.openFolder?.()) : null,
        openApp: android.openApp
          ? async (provider) => orThrow(android.openApp?.(provider.android))
          : null,
        // The system picker takes over from here and the page reloads once a
        // folder comes back, so this resolves without having changed anything.
        changeFolder: async () => android.pickFolder(),
        changeNote: null,
      };
    }
    case 'http':
      return {
        openFolder: () => askHelper({ what: 'folder' }),
        openApp: (provider) => askHelper({ what: 'app', command: provider.command }),
        changeFolder: null,
        changeNote: 'the folder is the one this device was launched with — `--folder` on the launcher',
      };
    case 'fsaa':
      // A page holds a directory handle, not a window: there is no folder to
      // show and no app to start. The picker is the one thing a browser has.
      return { ...NONE, changeFolder: pickAndReload };
    case 'local':
      // No button can reach a folder the shell is not holding, and one it *is*
      // holding was taken at startup rather than offered here — X-18. So this
      // is the browser's own picker or nothing, and on Firefox it is nothing.
      return {
        ...NONE,
        changeFolder: supported() ? pickAndReload : null,
        changeNote: supported()
          ? null
          : 'this browser cannot open a folder, and nothing on this device is serving one',
      };
    case 'memory':
      return { ...NONE, changeNote: 'this is the in-memory folder the UI test runs against' };
  }
}
