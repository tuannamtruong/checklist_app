// One suite, run against every adapter that can run here — S-18, test.md §3.3.
//
// It asserts the contract and never the implementation, because the contract is
// the entire reason the merge logic can be tested against a plain object and
// shipped against a phone. Each adapter is exercised elsewhere only by whatever
// test happens to use it, and that is exactly how a set of adapters drifts
// apart: one starts throwing where another returns null, and the difference is
// found on the device rather than here.
//
// Exported as one function an adapter is passed to, rather than written out per
// adapter, because a suite that is copied is a suite that diverges. The one
// clause it cannot check is S-8's atomicity: a writer cannot observe its own
// write being partial.

import { expect, test } from 'vitest';
import type { FolderAdapter } from '../core/folder';

export interface AdapterUnderTest {
  name: string;
  /** A folder with nothing in it. Every case builds its own — test.md §4. */
  open: () => Promise<FolderAdapter> | FolderAdapter;
  close?: () => Promise<void> | void;
  /** False for `local-folder`, which refuses to write a picture at all — P-8. */
  pictures?: boolean;
}

/** A device file name, since that is the only shape any adapter has to carry. */
const FILE = 'checklist.1111aaaa.ops.jsonl';

/** P-4's shape, as a pasted picture is named. */
const PICTURE = 'pictures/0123456789abcdef0123456789abcdef.webp';

/** Every byte value, so an adapter that passes a picture through text is caught. */
const BYTES = Uint8Array.from({ length: 256 }, (_, i) => i);

export function folderContract({ name, open, close, pictures = true }: AdapterUnderTest): void {
  const withFolder = async (run: (folder: FolderAdapter) => Promise<void>) => {
    const folder = await open();
    try {
      await run(folder);
    } finally {
      await close?.();
    }
  };

  test(`${name}: an empty folder lists nothing`, () =>
    withFolder(async (folder) => {
      expect(await folder.list()).toEqual([]);
    }));

  test(`${name}: read of an absent name answers null rather than throwing`, () =>
    withFolder(async (folder) => {
      // The normal state of a folder a peer has not written to yet, so it must
      // not be an error — core/folder.ts.
      expect(await folder.read(FILE)).toBe(null);
    }));

  test(`${name}: write then read round-trips exactly`, () =>
    withFolder(async (folder) => {
      // Newlines and a trailing one, because JSON Lines is the payload and a
      // helpful adapter that trims either would lose the last op.
      const content = '{"v":1}\n{"op":"set"}\n';
      await folder.write(FILE, content);
      expect(await folder.read(FILE)).toBe(content);
    }));

  test(`${name}: a second write replaces the first`, () =>
    withFolder(async (folder) => {
      // The adapter has no append, so every write is the whole file — this is
      // the property the op log depends on most.
      await folder.write(FILE, 'first\n');
      await folder.write(FILE, 'second\n');
      expect(await folder.read(FILE)).toBe('second\n');
      expect((await folder.list()).length).toBe(1);
    }));

  test(`${name}: list returns names, not paths`, () =>
    withFolder(async (folder) => {
      await folder.write(FILE, 'x\n');
      await folder.write('checklist.2222bbbb.ops.jsonl', 'y\n');
      expect([...(await folder.list())].sort()).toEqual([
        FILE,
        'checklist.2222bbbb.ops.jsonl',
      ]);
    }));

  test(`${name}: a name of dots, dashes and underscores survives`, () =>
    withFolder(async (folder) => {
      // Not the alphabet an adapter can carry, but the one every adapter must:
      // the loopback helper validates names against exactly this set, so a case
      // built from spaces or slashes would assert a contract the helper refuses
      // to sign rather than a bug in anyone's adapter.
      const awkward = 'a-name_with.mixed-parts.jsonl';
      await folder.write(awkward, 'z\n');
      expect(await folder.read(awkward)).toBe('z\n');
      expect((await folder.list()).includes(awkward)).toBe(true);
    }));

  test(`${name}: an empty file is content, not absence`, () =>
    withFolder(async (folder) => {
      await folder.write(FILE, '');
      expect(await folder.read(FILE)).toBe('');
    }));

  test(`${name}: a picture round-trips byte for byte, or is refused`, () =>
    withFolder(async (folder) => {
      const write = folder.write(PICTURE, new Blob([BYTES]));
      if (!pictures) {
        await expect(write).rejects.toThrow();
        expect(await folder.list()).toEqual([]);
        return;
      }
      await write;
      const back = await folder.read(PICTURE);
      expect(back).toBeInstanceOf(Blob);
      expect(new Uint8Array(await (back as Blob).arrayBuffer())).toEqual(BYTES);
      expect(await folder.list()).toEqual([PICTURE]);
    }));

  if (pictures) {
    test(`${name}: remove takes a picture out of the folder`, () =>
      withFolder(async (folder) => {
        await folder.write(PICTURE, new Blob([BYTES]));
        await folder.remove(PICTURE);
        expect(await folder.list()).toEqual([]);
        expect(await folder.read(PICTURE)).toBe(null);
        // Absent is the normal state of a picture a peer already took away.
        await folder.remove(PICTURE);
      }));
  }

  test(`${name}: remove refuses anything that is not a picture`, () =>
    withFolder(async (folder) => {
      // The whole safety argument, S-3: no device may take a log away.
      await folder.write(FILE, 'x\n');
      await expect(folder.remove(FILE)).rejects.toThrow();
      expect(await folder.read(FILE)).toBe('x\n');
    }));
}
