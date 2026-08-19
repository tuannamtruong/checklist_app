// "How can this browser reach a folder?", asked once at startup —
// architecture.md §4 draws the flowchart this file is.
//
// The order matters and is not the order of preference. What the user already
// chose comes first, so a device does not silently change how it reaches its
// data because a browser gained an API overnight; then the two shells that hand
// a folder in unasked; then the picker; then the browser-only fallback, which
// is a working application that cannot sync and says so.

import { androidFolder, bridge } from '../adapters/android-folder';
import { ensurePermission, fsaaFolder, loadHandle, pickFolder, supported } from '../adapters/fsaa-folder';
import { helperInfo, httpFolder } from '../adapters/http-folder';
import { localFolder, localFolderHasData } from '../adapters/local-folder';
import { memoryFolder } from '../adapters/memory-folder';
import type { FolderAdapter } from '../core/folder';

const MODE_KEY = 'checklist.folder.mode';

/** Only the two the user can be asked for. The rest are decided by the shell. */
export type FolderMode = 'local' | 'fsaa';

export interface OpenFolder {
  kind: 'folder';
  folder: FolderAdapter;
  /** What the shell tells the user it is writing to. */
  label: string;
  /** False when this folder reaches no other device, so the shell can say so. */
  synced: boolean;
  uiTest: boolean;
}

/** No folder yet, and the way to get one needs a click — a picker or a grant. */
export interface NeedsFolder {
  kind: 'setup';
  how: 'fsaa' | 'fsaa-regrant' | 'android' | 'none';
  /** Every browser can fall back to itself, so this is never a dead end. */
  reason: string;
}

export type FolderChoice = OpenFolder | NeedsFolder;

function isUiTest(search: string): boolean {
  return new URLSearchParams(search).has('uitest');
}

export function storedMode(storage: Storage): FolderMode | null {
  const stored = storage.getItem(MODE_KEY);
  return stored === 'local' || stored === 'fsaa' ? stored : null;
}

export function rememberMode(mode: FolderMode, storage: Storage = window.localStorage): void {
  storage.setItem(MODE_KEY, mode);
}

/**
 * The browser-only fallback. It is a real choice rather than a failure: the
 * whole application works, and only sync does not — so the label says that
 * everywhere it appears, because a user who believes they are synced and is not
 * is the one failure this design must never produce quietly.
 */
export function browserOnly(storage: Storage = window.localStorage): OpenFolder {
  return {
    kind: 'folder',
    folder: localFolder(storage),
    label: 'This browser only — not synced',
    synced: false,
    uiTest: false,
  };
}

async function fromHandle(): Promise<FolderChoice | null> {
  const handle = await loadHandle();
  if (!handle) return null;
  if (!(await ensurePermission(handle))) {
    return { kind: 'setup', how: 'fsaa-regrant', reason: `${handle.name} needs permission again` };
  }
  return {
    kind: 'folder',
    folder: fsaaFolder(handle),
    label: handle.name,
    synced: true,
    uiTest: false,
  };
}

export async function chooseFolder(
  location: Location = window.location,
  storage: Storage = window.localStorage,
): Promise<FolderChoice> {
  if (isUiTest(location.search)) {
    return {
      kind: 'folder',
      folder: memoryFolder(),
      label: 'UI test folder (in memory)',
      synced: false,
      uiTest: true,
    };
  }

  // A folder that already holds this device's log is a choice the user made,
  // whether or not this key records it: M1 shipped before the key existed, and
  // "where did my checklist go" is not a question to answer with a migration note.
  const mode = storedMode(storage) ?? (localFolderHasData(storage) ? 'local' : null);
  if (mode === 'local') return browserOnly(storage);
  if (mode === 'fsaa') {
    const chosen = await fromHandle();
    if (chosen) return chosen;
    return { kind: 'setup', how: 'fsaa', reason: 'the folder this device used is no longer available' };
  }

  const android = bridge();
  if (android) {
    if (!android.hasFolder()) {
      return { kind: 'setup', how: 'android', reason: 'this app has not been given a folder yet' };
    }
    return {
      kind: 'folder',
      folder: androidFolder(android),
      label: android.folderName(),
      synced: true,
      uiTest: false,
    };
  }

  const helper = await helperInfo();
  if (helper.configured) {
    return {
      kind: 'folder',
      folder: httpFolder(),
      label: helper.name ?? 'the folder this device serves',
      synced: true,
      uiTest: false,
    };
  }

  if (supported()) {
    return { kind: 'setup', how: 'fsaa', reason: 'no folder has been picked on this device yet' };
  }
  return { kind: 'setup', how: 'none', reason: 'this browser cannot open a folder' };
}

/** The setup screen's button, for the two branches that have one. */
export async function grantFolder(): Promise<FolderChoice> {
  const handle = await pickFolder();
  if (!(await ensurePermission(handle, { prompt: true }))) {
    return { kind: 'setup', how: 'fsaa', reason: `${handle.name} was not granted` };
  }
  rememberMode('fsaa');
  return {
    kind: 'folder',
    folder: fsaaFolder(handle),
    label: handle.name,
    synced: true,
    uiTest: false,
  };
}
