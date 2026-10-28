// P-5 to P-7 against a real adapter — the in-memory one, since the logic is
// the same over every folder and the conformance suite covers the rest. `add`
// is not here: it needs a canvas, which is the smoke run's (test.md §3.5).

import { describe, expect, it } from 'vitest';
import { memoryFolder } from '../adapters/memory-folder';
import { createLastChild, setBody } from '../core/edit';
import { flaggedName, pictureName } from '../core/pictures';
import { FakeContext, Session } from '../core/test-support';
import { ROOT, type NodeMap } from '../core/types';
import { Pictures } from './pictures.svelte';

/** 2026-10-28, 10:00 local. */
const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

const BYTES = new Blob([Uint8Array.from([1, 2, 3])]);

/** The name these bytes are owed — P-4. */
async function nameOf(blob: Blob): Promise<string> {
  return pictureName(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()), 'webp');
}

function tree(...bodies: string[]): NodeMap {
  const session = new Session();
  const ctx = new FakeContext();
  for (const body of bodies) {
    const ops = createLastChild(session.tree, ctx.tick(), ROOT, { kind: 'note', title: 'n' });
    session.apply(ops);
    session.apply(setBody(session.tree, ctx.tick(), ops[0]!.id, body));
  }
  return session.tree.nodes;
}

async function opened() {
  const folder = memoryFolder();
  const errors: unknown[] = [];
  const pictures = new Pictures(folder, (error) => errors.push(error));
  const name = await nameOf(BYTES);
  await folder.write(name, BYTES);
  return { folder, pictures, name, errors };
}

describe('pictures in a folder — P-5 to P-7', () => {
  it('flags a picture the body dropped, and still draws it from the flagged name', async () => {
    const { folder, pictures, name, errors } = await opened();
    await pictures.commit(`![](${name})`, tree('nothing'), NOW);

    const kept = flaggedName(name, '2026-10-28');
    expect(await folder.list()).toEqual([kept]);
    // A mark brought back by undo draws from the flagged name the cycle listed,
    // before the cycle that would put the picture back under its own.
    await pictures.tidy(await folder.list(), tree('nothing'), NOW);
    expect(await pictures.url(name)).toMatch(/^blob:/);
    expect(errors).toEqual([]);
  });

  it('puts it back once a body points at it again, and removes it 31 days on', async () => {
    const { folder, pictures, name } = await opened();
    await pictures.commit(`![](${name})`, tree('nothing'), NOW);

    await pictures.tidy(await folder.list(), tree(`![](${name})`), NOW);
    expect(await folder.list()).toEqual([name]);

    await pictures.commit(`![](${name})`, tree('nothing'), NOW);
    await pictures.tidy(await folder.list(), tree('nothing'), NOW + 30 * DAY);
    expect(await folder.list()).toEqual([flaggedName(name, '2026-10-28')]);
    await pictures.tidy(await folder.list(), tree('nothing'), NOW + 31 * DAY);
    expect(await folder.list()).toEqual([]);
  });

  it('draws bytes that do not hash to their name as missing', async () => {
    const { folder, pictures, name } = await opened();
    // What a picture that half-arrived looks like from here.
    await folder.write(name, new Blob([Uint8Array.from([1, 2])]));
    expect(await pictures.url(name)).toBe(null);
    expect(await pictures.url('pictures/never-written.webp')).toBe(null);
  });
});
