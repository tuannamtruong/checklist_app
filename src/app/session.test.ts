// requirements.md §8, D-5 at the seam it is actually applied: the suggested
// name reaches this device's header exactly when the header carries none, which
// is a rule about `Session.open` rather than about the name itself.

import { describe, expect, it } from 'vitest';
import { memoryFolder } from '../adapters/memory-folder';
import { deviceFileName, encodeLog, LOG_VERSION } from '../core/op-log';
import type { FolderAdapter } from '../core/folder';
import { Session } from './Session.svelte';

const DEVICE = 'a3f19c02';

/** A file this device already owns, carrying whatever its header said. */
async function seeded(name?: string): Promise<FolderAdapter> {
  const folder = memoryFolder();
  await folder.write(
    deviceFileName(DEVICE),
    encodeLog({ v: LOG_VERSION, dev: DEVICE, clock: {}, ...(name ? { name } : {}), at: 1_000 }, []),
  );
  return folder;
}

/** The name reaches the folder on the write debounce, not on the call. */
async function nameInFolder(session: Session, folder: FolderAdapter): Promise<string | undefined> {
  await session.flush();
  const text = await folder.read(deviceFileName(DEVICE));
  return JSON.parse(text!.split('\n')[0]!).name;
}

describe('Session.open and D-5', () => {
  it('names a device whose header carries no name', async () => {
    const folder = await seeded();
    const session = await Session.open(folder, DEVICE, 'Win-Chro-a3f1');
    expect(session.devices[0]!.name).toBe('Win-Chro-a3f1');
    expect(await nameInFolder(session, folder)).toBe('Win-Chro-a3f1');
  });

  it('leaves a name somebody typed alone', async () => {
    // The suggestion is what a device starts with, never what it reverts to.
    const folder = await seeded('the laptop');
    const session = await Session.open(folder, DEVICE, 'Win-Chro-a3f1');
    expect(session.devices[0]!.name).toBe('the laptop');
    expect(await nameInFolder(session, folder)).toBe('the laptop');
  });

  it('leaves the device unnamed when no suggestion is offered', async () => {
    // Every caller but the shell is in this case, and D-3 is why it is a state
    // rather than an error: a header with no name has always been legal.
    const folder = await seeded();
    const session = await Session.open(folder, DEVICE);
    expect(session.devices[0]!.name).toBe('');
  });

  it('names a device that has no file at all yet', async () => {
    const folder = memoryFolder();
    const session = await Session.open(folder, DEVICE, 'Andro-App-a3f1');
    expect(await nameInFolder(session, folder)).toBe('Andro-App-a3f1');
  });
});
