// How a device decides which folder it reaches the tree through, and — X-18 —
// how it gets back off the browser-only fallback once it is on it.
//
// architecture.md §4 draws the flowchart; these are its branches. The two
// things a browser answers with are globals (`AndroidFolder`,
// `showDirectoryPicker`) and the third is a fetch, so all three are stubbed and
// nothing here needs a browser.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseFolder, shellFolder, storedMode } from './folder-choice';
import { offeredFolder, shellActions } from './shell';
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('storedMode', () => {
  it('reads the three values and nothing else', () => {
    expect(storedMode(fakeStorage({ 'checklist.folder.mode': 'local' }))).toBe('local');
    expect(storedMode(fakeStorage({ 'checklist.folder.mode': 'fsaa' }))).toBe('fsaa');
    expect(storedMode(fakeStorage({ 'checklist.folder.mode': 'shell' }))).toBe('shell');
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

  it('keeps a stored `local` even while the helper is serving a folder', async () => {
    // Deliberate, and the reason X-18 exists: the stored choice outranks every
    // shell, so the way back is a button rather than a startup rule.
    helperServing('Dropbox-checklist');
    const chosen = await chooseFolder(NOWHERE, fakeStorage({ 'checklist.folder.mode': 'local' }));
    expect(chosen).toMatchObject({ kind: 'folder', source: 'local', synced: false });
  });

  it('reads a browser holding an op log as a stored `local`', async () => {
    helperServing('Dropbox-checklist');
    const storage = fakeStorage({ 'checklist:folder:checklist.aaaa0001.ops.jsonl': '{}' });
    expect(await chooseFolder(NOWHERE, storage)).toMatchObject({ source: 'local' });
  });

  it('takes the shell folder once the device has been moved onto it — X-18', async () => {
    helperServing('Dropbox-checklist');
    // The log the device wrote while it was on the fallback is still here. The
    // `shell` mode is what stops the inference above from reclaiming it.
    const storage = fakeStorage({
      'checklist.folder.mode': 'shell',
      'checklist:folder:checklist.aaaa0001.ops.jsonl': '{}',
    });
    expect(await chooseFolder(NOWHERE, storage)).toMatchObject({ source: 'http', synced: true });
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

describe('shellFolder', () => {
  it('is the folder the helper is holding, or null', async () => {
    helperServing('Dropbox-checklist');
    expect(await shellFolder()).toMatchObject({ source: 'http', label: 'Dropbox-checklist' });

    helperServing(null);
    expect(await shellFolder()).toBeNull();

    noHelper();
    expect(await shellFolder()).toBeNull();
  });
});

describe('offeredFolder — X-18', () => {
  it('offers the helper folder only to the browser-only fallback', async () => {
    helperServing('Dropbox-checklist');
    expect(await offeredFolder('local')).toBe('Dropbox-checklist');
    // Every other source is already on the folder this would offer.
    expect(await offeredFolder('http')).toBeNull();
    expect(await offeredFolder('fsaa')).toBeNull();
    expect(await offeredFolder('android')).toBeNull();
  });
});

describe('shellActions on the browser-only fallback', () => {
  it('offers the folder the launcher is holding, and names it', () => {
    const shell = shellActions('local', 'Dropbox-checklist');
    expect(shell.changeFolder).not.toBeNull();
    expect(shell.changeLabel).toBe('Use Dropbox-checklist');
    expect(shell.changeNote).toContain('stay in this browser');
  });

  it('falls back to the picker where the browser has one', () => {
    vi.stubGlobal('showDirectoryPicker', () => Promise.resolve());
    const shell = shellActions('local', null);
    expect(shell.changeFolder).not.toBeNull();
    expect(shell.changeLabel).toBeNull();
  });

  it('has no button, and says why, when neither is on offer', () => {
    // This is Firefox with no helper — the one dead end left, and it is a true
    // one: there is no folder on this device to reach.
    const shell = shellActions('local', null);
    expect(shell.changeFolder).toBeNull();
    expect(shell.changeNote).toContain('nothing on this device is offering one');
  });
});
