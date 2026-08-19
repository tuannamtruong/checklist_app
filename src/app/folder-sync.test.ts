// One cycle over a folder — sync-flow.md §4.7. The adapter is a real one
// (`memory-folder`), wrapped only to record what was asked of it and to make
// the provider's client misbehave on cue.

import { describe, expect, it } from 'vitest';
import { memoryFolder } from '../adapters/memory-folder';
import type { FolderAdapter } from '../core/folder';
import { encodeLog, LOG_VERSION } from '../core/op-log';
import type { DeviceId, Op } from '../core/types';
import { FolderSync } from './folder-sync';

const OURS: DeviceId = 'aaaa0001';
const PEER: DeviceId = 'bbbb0002';

function ops(device: DeviceId, count: number): Op[] {
  return Array.from({ length: count }, (_, index) => ({
    op: 'create',
    id: `n_${device.slice(0, 4)}${index}`,
    parent: 'root',
    kind: 'task',
    order: `a${index}`,
    c: index + 1,
    at: 1_000 + index,
    dev: device,
  }));
}

function fileOf(device: DeviceId, count: number): string {
  const written = ops(device, count);
  return encodeLog({ v: LOG_VERSION, dev: device, clock: { [device]: count } }, written);
}

/** Records every read, and can be told to fail or truncate one. */
function watched(seed: Record<string, string>) {
  const inner = memoryFolder(seed);
  const reads: string[] = [];
  let fail: string | null = null;
  const folder: FolderAdapter = {
    list: () => inner.list(),
    read: (name) => {
      reads.push(name);
      if (name === fail) throw new Error('the provider client has the file');
      return inner.read(name);
    },
    write: (name, content) => inner.write(name, content),
  };
  return {
    folder,
    reads,
    put: (name: string, content: string) => inner.write(name, content),
    failOn: (name: string | null) => {
      fail = name;
    },
  };
}

describe('one sync cycle', () => {
  it('reads every peer file and never our own — S-3', async () => {
    const folder = watched({
      [`checklist.${OURS}.ops.jsonl`]: fileOf(OURS, 3),
      [`checklist.${PEER}.ops.jsonl`]: fileOf(PEER, 2),
      'notes.txt': 'not ours',
    });
    const sync = new FolderSync(folder.folder, OURS);

    const result = await sync.cycle();
    expect(result).toEqual({ peers: 1, skipped: [], changed: true });
    expect(folder.reads).toEqual([`checklist.${PEER}.ops.jsonl`]);
    expect(sync.logs).toEqual([{ device: PEER, ops: ops(PEER, 2) }]);
  });

  it('reports nothing changed when the folder has not moved', async () => {
    const folder = watched({ [`checklist.${PEER}.ops.jsonl`]: fileOf(PEER, 2) });
    const sync = new FolderSync(folder.folder, OURS);
    await sync.cycle();
    expect((await sync.cycle()).changed).toBe(false);
  });

  it('picks up a peer’s new ops on the next cycle', async () => {
    const folder = watched({ [`checklist.${PEER}.ops.jsonl`]: fileOf(PEER, 2) });
    const sync = new FolderSync(folder.folder, OURS);
    await sync.cycle();

    folder.put(`checklist.${PEER}.ops.jsonl`, fileOf(PEER, 5));
    expect((await sync.cycle()).changed).toBe(true);
    expect(sync.logs[0]!.ops.length).toBe(5);
  });

  it('skips a half-synced file and takes it whole next time — S-7', async () => {
    const name = `checklist.${PEER}.ops.jsonl`;
    const whole = fileOf(PEER, 4);
    // What a mid-download read looks like: a valid header and a torn last line.
    const half = whole.slice(0, whole.length - 30);
    const folder = watched({ [name]: half });
    const skips: string[] = [];
    const sync = new FolderSync(folder.folder, OURS, {
      onSkipped: (file, lines) => skips.push(`${file}:${lines}`),
    });

    const first = await sync.cycle();
    expect(first.changed).toBe(true);
    expect(skips).toEqual([`${name}:1`]);
    expect(sync.logs[0]!.ops.length).toBe(3);

    folder.put(name, whole);
    expect((await sync.cycle()).changed).toBe(true);
    expect(sync.logs[0]!.ops.length).toBe(4);
  });

  it('refuses a file that does not decode at all', async () => {
    const name = `checklist.${PEER}.ops.jsonl`;
    const folder = watched({ [name]: 'not json at all\n' });
    const sync = new FolderSync(folder.folder, OURS);

    expect(await sync.cycle()).toEqual({ peers: 1, skipped: [name], changed: false });
    expect(sync.logs).toEqual([]);
  });

  it('keeps what it holds when a read comes back short', async () => {
    const name = `checklist.${PEER}.ops.jsonl`;
    const folder = watched({ [name]: fileOf(PEER, 5) });
    const sync = new FolderSync(folder.folder, OURS);
    await sync.cycle();

    // An append-only file cannot shrink, so this is a partial download wearing
    // a valid header. Adopting it would drop ops this device already had.
    folder.put(name, fileOf(PEER, 2));
    const result = await sync.cycle();
    expect(result.skipped).toEqual([name]);
    expect(sync.logs[0]!.ops.length).toBe(5);
  });

  it('survives a read the provider’s client is holding', async () => {
    const name = `checklist.${PEER}.ops.jsonl`;
    const folder = watched({ [name]: fileOf(PEER, 2) });
    const errors: unknown[] = [];
    const sync = new FolderSync(folder.folder, OURS, { onError: (error) => errors.push(error) });
    folder.failOn(name);

    expect((await sync.cycle()).skipped).toEqual([name]);
    expect(errors.length).toBe(1);

    folder.failOn(null);
    expect((await sync.cycle()).changed).toBe(true);
  });

  it('survives a folder that cannot be listed', async () => {
    const errors: unknown[] = [];
    const folder: FolderAdapter = {
      list: () => Promise.reject(new Error('the folder is gone')),
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
    };
    const sync = new FolderSync(folder, OURS, { onError: (error) => errors.push(error) });

    expect(await sync.cycle()).toEqual({ peers: 0, skipped: [], changed: false });
    expect(errors.length).toBe(1);
  });
});
