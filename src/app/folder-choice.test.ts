// How a device decides which folder it reaches the tree through, and — X-18 —
// how it gets back off the browser-only fallback once it is on it.
//
// architecture.md §4 draws the flowchart; these are its branches. The two
// things a browser answers with are globals (`AndroidFolder`,
// `showDirectoryPicker`) and the third is a fetch, so all three are stubbed and
// nothing here needs a browser.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseFolder, storedMode } from './folder-choice';
import { shellActions } from './shell';
import { helperInfo } from '../adapters/http-folder';

/** `localStorage` as the two functions that read it actually use it. */
function fakeStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
  } as Storage;
}

const NOWHERE = { search: '' } as Location;

/** The loopback helper, answering `GET /folder/info` and nothing else. */
function helperServing(name: string | null): void {
  vi.stubGlobal('fetch', async (input: string) => {
    expect(String(input)).toBe('/folder/info');
    return {
      ok: true,
      json: async () => (name === null ? { configured: false } : { configured: true, name }),
    } as Response;
  });
}

/** No helper: a page served by something else refuses to connect. */
function noHelper(): void {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('failed to fetch');
  });
}

/**
 * IndexedDB holding no handle. Enough to let the `fsaa` branch run to its end
 * in Node — which is all a test of *which branch was taken* needs. Every
 * callback fires on a microtask, because that is when the code under test has
 * finished assigning them.
 */
function emptyHandleStore(): void {
  const store = { get: () => ({ result: undefined }) };
  const db = {
    transaction: () => {
      const tx: Record<string, unknown> = { objectStore: () => store };
      queueMicrotask(() => (tx.oncomplete as (() => void) | undefined)?.());
      return tx;
    },
    close: () => {},
  };
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request: Record<string, unknown> = { result: db };
      queueMicrotask(() => (request.onsuccess as (() => void) | undefined)?.());
      return request;
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('storedMode', () => {
  it('reads the two the user can be asked for, and nothing else', () => {
    expect(storedMode(fakeStorage({ 'checklist.folder.mode': 'local' }))).toBe('local');
    expect(storedMode(fakeStorage({ 'checklist.folder.mode': 'fsaa' }))).toBe('fsaa');
    expect(storedMode(fakeStorage({ 'checklist.folder.mode': 'http' }))).toBeNull();
    expect(storedMode(fakeStorage())).toBeNull();
  });
});

describe('helperInfo', () => {
  it('tells a helper holding nothing from no helper at all', async () => {
    helperServing(null);
    expect(await helperInfo()).toEqual({ present: true, configured: false });

    noHelper();
    expect(await helperInfo()).toEqual({ present: false, configured: false });
  });
});

describe('chooseFolder', () => {
  it('takes the helper folder when nothing has been stored', async () => {
    helperServing('Dropbox-checklist');
    const chosen = await chooseFolder(NOWHERE, fakeStorage());
    expect(chosen).toMatchObject({ kind: 'folder', source: 'http', label: 'Dropbox-checklist', synced: true });
  });

  it('leaves a stored `local` for a folder the helper is holding — X-18', async () => {
    // The bug this test is here for: the device said "this browser only" once,
    // on a launch that had no folder. It is not a preference to be honoured
    // forever against a launcher that is now holding one.
    helperServing('Dropbox-checklist');
    const chosen = await chooseFolder(NOWHERE, fakeStorage({ 'checklist.folder.mode': 'local' }));
    expect(chosen).toMatchObject({ kind: 'folder', source: 'http', synced: true });
  });

  it('leaves an inferred `local` the same way, log and all — X-18', async () => {
    helperServing('Dropbox-checklist');
    const storage = fakeStorage({ 'checklist:folder:checklist.aaaa0001.ops.jsonl': '{}' });
    expect(await chooseFolder(NOWHERE, storage)).toMatchObject({ source: 'http', synced: true });
  });

  it('keeps the fallback when nothing is holding a folder for it', async () => {
    noHelper();
    const chosen = await chooseFolder(NOWHERE, fakeStorage({ 'checklist.folder.mode': 'local' }));
    expect(chosen).toMatchObject({ kind: 'folder', source: 'local', synced: false });
  });

  it('does not override a picked folder with the helper\u2019s', async () => {
    // `fsaa` is a folder this device chose and is using; only `local` — which
    // is the absence of one — yields. The handle lives in IndexedDB, so this
    // reaches for it and lands on the re-pick branch rather than on `http`.
    helperServing('Dropbox-checklist');
    emptyHandleStore();
    const chosen = await chooseFolder(NOWHERE, fakeStorage({ 'checklist.folder.mode': 'fsaa' }));
    expect(chosen).toMatchObject({ kind: 'setup', how: 'fsaa' });
    expect(chosen.kind === 'setup' && chosen.reason).toContain('no longer available');
  });

  it('names the launcher, not the browser, when the helper has no folder yet', async () => {
    helperServing(null);
    const chosen = await chooseFolder(NOWHERE, fakeStorage());
    expect(chosen).toMatchObject({ kind: 'setup', how: 'none' });
    expect(chosen.kind === 'setup' && chosen.reason).toContain('has not been given a folder');
  });

  it('blames the browser when nothing is serving this page', async () => {
    noHelper();
    const chosen = await chooseFolder(NOWHERE, fakeStorage());
    expect(chosen).toMatchObject({ kind: 'setup', how: 'none' });
    expect(chosen.kind === 'setup' && chosen.reason).toBe('this browser cannot open a folder');
  });
});

describe('shellActions on the browser-only fallback', () => {
  it('offers the picker where the browser has one', () => {
    vi.stubGlobal('showDirectoryPicker', () => Promise.resolve());
    expect(shellActions('local').changeFolder).not.toBeNull();
  });

  it('has no button, and says why, where it has none', () => {
    // Firefox with no helper. It is a true dead end rather than the old false
    // one: there is no folder on this device to reach, so there is nothing the
    // screen could offer — X-18 handles the case where there is.
    const shell = shellActions('local');
    expect(shell.changeFolder).toBeNull();
    expect(shell.changeNote).toContain('nothing on this device is serving one');
  });
});
