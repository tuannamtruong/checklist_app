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
import { grantFolder, rememberMode, shellFolder, type FolderSource } from './folder-choice';
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
  /** What that button says, when the default "somewhere else" is not what it does. */
  changeLabel: string | null;
  /** What the user should know: who decides the folder, or what taking one costs. */
  changeNote: string | null;
}

const NONE: ShellActions = {
  openFolder: null,
  openApp: null,
  changeFolder: null,
  changeLabel: null,
  changeNote: null,
};

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

/**
 * X-18. Leave the browser-only fallback for the folder the launcher is holding.
 *
 * It records the move before reloading rather than merely performing it: the
 * `local-folder` log stays in this browser, and startup reads a browser holding
 * one as a stored choice of `local` — so without the key, the reload would put
 * the device straight back where it was.
 */
async function adoptShellFolder(): Promise<void> {
  // Asked again rather than trusted from the render: the settings screen may
  // have been open since before the helper was given a folder, or since after
  // it lost one.
  if (!(await shellFolder())) {
    throw new Error('this device is no longer serving a folder');
  }
  rememberMode('shell');
  window.location.reload();
}

/**
 * X-18. What this shell is holding that the device is not using — the one
 * question here that a browser cannot answer synchronously, because it is a
 * `GET /folder/info` rather than a property of `globalThis`. Only the
 * browser-only fallback has anything to gain from the answer, so only it is
 * asked; every other source is already on the folder this would offer.
 */
export async function offeredFolder(source: FolderSource): Promise<string | null> {
  if (source !== 'local') return null;
  return (await shellFolder())?.label ?? null;
}

export function shellActions(source: FolderSource, offered: string | null = null): ShellActions {
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
      // The one source whose way out the browser does not own. Firefox has no
      // picker and is not getting one, but the process that served this page
      // may be holding a folder anyway — that is the whole reason the loopback
      // helper exists, and a device that fell back to the browser before the
      // helper had a folder has to be able to walk over to it. X-18.
      if (offered) {
        return {
          ...NONE,
          changeFolder: adoptShellFolder,
          changeLabel: `Use ${offered}`,
          changeNote: `This device is already serving ${offered}. Moving to it reads that folder from scratch — the rows written into this browser stay in this browser.`,
        };
      }
      return {
        ...NONE,
        changeFolder: supported() ? pickAndReload : null,
        changeNote: supported()
          ? null
          : 'this browser cannot open a folder, and nothing on this device is offering one',
      };
    case 'memory':
      return { ...NONE, changeNote: 'this is the in-memory folder the UI test runs against' };
  }
}
