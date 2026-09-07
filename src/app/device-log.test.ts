// The one write path — S-1 — and the two things M3 added to it: the header
// fields D-1 and D-2 ride on, and S-14's compaction of this device's own file.
//
// The adapter is a real one (`memory-folder`); what is asserted is the bytes
// that land in the folder, because that is the whole of what a peer ever sees.

import { describe, expect, it } from 'vitest';
import { memoryFolder } from '../adapters/memory-folder';
import { decodeLog, deviceFileName } from '../core/op-log';
import { ROOT, type DeviceId, type Op } from '../core/types';
import { DeviceLog } from './device-log';

const DEV: DeviceId = 'aaaa0001';
const FILE = deviceFileName(DEV);

function create(c: number, at: number): Op {
  return { op: 'create', id: `n_${c}`, parent: ROOT, kind: 'task', order: `a${c}`, c, at, dev: DEV };
}

function title(id: string, text: string, c: number, at: number): Op {
  return { op: 'set', id, title: text, c, at, dev: DEV };
}

async function opened(seed: Record<string, string> = {}) {
  const folder = memoryFolder(seed);
  const { log } = await DeviceLog.open(folder, DEV);
  return { folder, log };
}

async function written(folder: { read: (name: string) => Promise<string | null> }) {
  const text = await folder.read(FILE);
  expect(text).not.toBeNull();
  return decodeLog(text!)!;
}

describe('what reaches the file', () => {
  it('stamps an advisory lastSeen on every write — D-2', async () => {
    const { folder, log } = await opened();
    log.append([create(1, 1_000)]);
    await log.flush();

    const decoded = await written(folder);
    expect(decoded.header.at).toBeTypeOf('number');
    // Advisory means advisory: it is when the device wrote, not when the op
    // happened, and nothing in the merge reads either.
    expect(decoded.header.at).toBeGreaterThan(1_000);
  });

  it('carries a name once the device has one, and not before — D-1', async () => {
    const { folder, log } = await opened();
    log.append([create(1, 1_000)]);
    await log.flush();
    expect((await written(folder)).header.name).toBeUndefined();

    log.rename('  the   laptop  ');
    await log.flush();
    // Collapsed and trimmed on the way in, because it is one line in a file
    // somebody may open by hand.
    expect((await written(folder)).header.name).toBe('the laptop');
  });

  it('reads its own name back on the next launch', async () => {
    const { folder, log } = await opened();
    log.append([create(1, 1_000)]);
    log.rename('the phone');
    await log.flush();

    const { log: reopened } = await DeviceLog.open(folder, DEV);
    expect(reopened.name).toBe('the phone');
  });

  it('does not rewrite the file for a name it already has', async () => {
    const { folder, log } = await opened();
    log.rename('the laptop');
    await log.flush();
    const before = await folder.read(FILE);
    log.rename('the laptop');
    await log.flush();
    expect(await folder.read(FILE)).toBe(before);
  });
});

describe('compaction — S-14', () => {
  /** Ten titles on one node: nine of them are this device's own superseded writes. */
  function repeated(): Op[] {
    const ops: Op[] = [create(1, 1_000)];
    for (let i = 2; i <= 11; i++) ops.push(title('n_1', `title ${i}`, i, 1_000 + i));
    return ops;
  }

  it('shrinks the file and leaves the fold saying the same thing', async () => {
    const { folder, log } = await opened();
    log.append(repeated());
    await log.flush();
    const before = (await folder.read(FILE))!;

    expect(log.compact()).toBe(true);
    await log.flush();
    const after = (await folder.read(FILE))!;

    expect(after.length).toBeLessThan(before.length);
    const kept = decodeLog(after)!;
    expect(kept.ops.map((op) => op.op)).toEqual(['create', 'set']);
    expect((kept.ops[1] as { title: string }).title).toBe('title 11');
  });

  it('keeps the top counter, so a peer does not read the file as stale', async () => {
    // sync-flow.md §4.8.2: FolderSync skips a peer file holding fewer of that
    // peer's own ops than it already has, and counters are how it counts.
    const { folder, log } = await opened();
    log.append(repeated());
    log.compact();
    await log.flush();
    expect((await written(folder)).header.clock[DEV]).toBe(11);
  });

  it('says no when there is nothing to cut, rather than rewriting the file', async () => {
    const { folder, log } = await opened();
    log.append([create(1, 1_000), create(2, 1_001)]);
    await log.flush();
    const before = await folder.read(FILE);

    expect(log.compact()).toBe(false);
    await log.flush();
    expect(await folder.read(FILE)).toBe(before);
  });

  it('leaves a compacted file loadable on the next launch', async () => {
    const { folder, log } = await opened();
    log.append(repeated());
    log.compact();
    await log.flush();

    const { log: reopened, ops } = await DeviceLog.open(folder, DEV);
    expect(ops.length).toBe(2);
    // The counter must resume above the top of what survived, or the next op
    // reuses a counter a peer has already receipted.
    expect(reopened.nextCounter()).toBe(12);
  });
});
