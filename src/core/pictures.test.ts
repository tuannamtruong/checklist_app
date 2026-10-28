import { describe, expect, it } from 'vitest';
import { createLastChild, remove, setBody } from './edit';
import {
  droppedPictures,
  flagged,
  flaggedCopy,
  flaggedName,
  namedBy,
  pictureName,
  referencedPictures,
  tidyPlan,
} from './pictures';
import { FakeContext, Session } from './test-support';
import { ROOT } from './types';

const A = 'pictures/0123456789abcdef0123456789abcdef.webp';
const B = 'pictures/fedcba9876543210fedcba9876543210.webp';

/** 2026-10-28, 10:00 local. */
const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();

/** A tree of notes, one per body, and the id of each. */
function notes(...bodies: string[]): { session: Session; ctx: FakeContext; ids: string[] } {
  const session = new Session();
  const ctx = new FakeContext();
  const ids = bodies.map((body) => {
    const ops = createLastChild(session.tree, ctx.tick(), ROOT, { kind: 'note', title: 'n' });
    session.apply(ops);
    const id = ops[0]!.id;
    session.apply(setBody(session.tree, ctx.tick(), id, body));
    return id;
  });
  return { session, ctx, ids };
}

describe('the name — P-4', () => {
  it('is the first 32 hex digits of the digest', () => {
    const digest = Uint8Array.from({ length: 32 }, (_, i) => i).buffer;
    expect(pictureName(digest, 'webp')).toBe('pictures/000102030405060708090a0b0c0d0e0f.webp');
  });

  it('tells bytes that are the picture from bytes that half-arrived — P-5', () => {
    const digest = Uint8Array.from({ length: 32 }, (_, i) => i).buffer;
    expect(namedBy('pictures/000102030405060708090a0b0c0d0e0f.webp', digest)).toBe(true);
    expect(namedBy(A, digest)).toBe(false);
    // Put there by hand: nothing to check it against.
    expect(namedBy('pictures/receipt.jpg', digest)).toBe(true);
  });

  it('flags and unflags without losing the name', () => {
    const name = flaggedName(A, '2026-10-28');
    expect(name).toBe('pictures/del_2026-10-28_0123456789abcdef0123456789abcdef.webp');
    expect(flagged(name)).toEqual({ day: '2026-10-28', name: A });
    expect(flagged(A)).toBe(null);
    expect(flaggedCopy([B, name], A)).toBe(name);
    expect(flaggedCopy([B], A)).toBe(null);
  });
});

describe('taking a picture away — P-6', () => {
  it('drops what the last body pointed at and nothing now does', () => {
    const { session } = notes('plain text');
    expect(droppedPictures(`![](${A})\n![](${B})`, session.tree.nodes)).toEqual([A, B]);
  });

  it('keeps a picture another body still points at', () => {
    const { session } = notes(`![](${A})`);
    expect(droppedPictures(`![](${A})\n![](${B})`, session.tree.nodes)).toEqual([B]);
  });

  it('counts a deleted row as pointing, so T-13 brings its pictures back', () => {
    const { session, ctx, ids } = notes(`![](${A})`);
    session.apply(remove(session.tree, ctx.tick(), ids[0]!));
    expect(referencedPictures(session.tree.nodes).has(A)).toBe(true);
    expect(droppedPictures(`![](${A})`, session.tree.nodes)).toEqual([]);
  });
});

describe('the cycle — P-7', () => {
  it('puts a flagged picture back once a body points at it again', () => {
    const { session } = notes(`![](${A})`);
    const kept = flaggedName(A, '2026-10-27');
    expect(tidyPlan([kept], session.tree.nodes, NOW)).toEqual({ restore: [[kept, A]], remove: [] });
    // Already back under its own name: the flagged copy is only a spare.
    expect(tidyPlan([kept, A], session.tree.nodes, NOW)).toEqual({ restore: [], remove: [kept] });
  });

  it('removes one flagged more than 30 days ago, and keeps one flagged 30 days ago', () => {
    const { session } = notes('nothing');
    const old = flaggedName(A, '2026-09-27');
    const edge = flaggedName(B, '2026-09-28');
    expect(tidyPlan([old, edge], session.tree.nodes, NOW)).toEqual({ restore: [], remove: [old] });
  });

  it('never touches a picture nobody flagged, even one nothing points at', () => {
    // A peer's paste arrives before its body does — past_decision.md §23.3.
    const { session } = notes('nothing');
    expect(tidyPlan([A, 'checklist.1111aaaa.ops.jsonl'], session.tree.nodes, NOW)).toEqual({
      restore: [],
      remove: [],
    });
  });
});
