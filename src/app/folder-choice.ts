// "How can this browser reach a folder?", asked once at startup.
//
// architecture.md §4 draws the full flowchart — Android bridge, loopback
// helper, File System Access handle. M1 has one device and no Sync Folder, so
// only two of its branches are reachable: the UI-test folder, and the
// localStorage-backed one S-21 names. M2 fills in the rest; this function is
// where they go, and its callers do not change when they arrive.

import { localFolder } from '../adapters/local-folder';
import { memoryFolder } from '../adapters/memory-folder';
import type { FolderAdapter } from '../core/folder';

export interface FolderChoice {
  folder: FolderAdapter;
  /** What the shell tells the user it is writing to. */
  label: string;
  uiTest: boolean;
}

/** Reachable only by explicit opt-in, and it holds nothing after a reload. */
function isUiTest(search: string): boolean {
  return new URLSearchParams(search).has('uitest');
}

export function chooseFolder(location: Location = window.location): FolderChoice {
  if (isUiTest(location.search)) {
    return { folder: memoryFolder(), label: 'UI test folder (in memory)', uiTest: true };
  }
  return { folder: localFolder(), label: 'This browser', uiTest: false };
}
