// A-4 and A-5 — requirements.md §4.2. The filter is a read of the tree, so
// everything here is one: no state, no index, nothing to invalidate.

import { beforeEach, describe, expect, it } from 'vitest';
import { filteredIds, matchCount, tagsInTree } from './filter';
import { createFirstChild, createLastChild, remove, setTags, toggleDone } from './edit';
import { FakeContext, Session } from './test-support';
import { ROOT, type NodeId } from './types';

let ctx: FakeContext;
let session: Session;

beforeEach(() => {
  ctx = new FakeContext();
  session = new Session();
});

function add(parent: string, title: string, tags: readonly string[] = []): NodeId {
  ctx.tick();
  const ops = createLastChild(session.tree, ctx, parent, { title, tags });
  session.apply(ops);
  return ops[0]!.id;
}

describe('the tags a tree offers', () => {
  it('counts the rows carrying each, most used first', () => {
    add(ROOT, 'a', ['town']);
    add(ROOT, 'b', ['town', 'errand']);
    expect(tagsInTree(session.tree)).toEqual([
      { tag: 'town', count: 2 },
      { tag: 'errand', count: 1 },
    ]);
  });

  // The filter is the tree's, and neither a finished row nor a deleted one is
  // in the tree — T-11 and T-7 took them out before this ever ran.
  it('does not offer a tag only a finished or deleted row carries', () => {
    const done = add(ROOT, 'done', ['gone']);
    const dead = add(ROOT, 'dead', ['gone']);
    add(ROOT, 'here', ['town']);
    ctx.tick();
    session.apply(toggleDone(session.tree, ctx, done));
    ctx.tick();
    session.apply(remove(session.tree, ctx, dead));
    expect(tagsInTree(session.tree).map((row) => row.tag)).toEqual(['town']);
  });
});

describe('what a filter shows', () => {
  it('filters nothing when nothing is selected', () => {
    add(ROOT, 'a', ['town']);
    expect(filteredIds(session.tree, [])).toBe(null);
  });

  it('keeps a matching row and every ancestor of one', () => {
    const list = add(ROOT, 'Shopping');
    const milk = add(list, 'Milk', ['town']);
    add(list, 'Bread');
    const other = add(ROOT, 'House');

    const shown = filteredIds(session.tree, ['town'])!;
    expect(shown.has(milk)).toBe(true);
    expect(shown.has(list)).toBe(true);
    expect(shown.has(other)).toBe(false);
  });

  it('ANDs the selection: a row needs every tag', () => {
    const both = add(ROOT, 'both', ['errand', 'town']);
    const one = add(ROOT, 'one', ['town']);

    const shown = filteredIds(session.tree, ['errand', 'town'])!;
    expect(shown.has(both)).toBe(true);
    expect(shown.has(one)).toBe(false);
    expect(matchCount(session.tree, ['errand', 'town'])).toBe(1);
  });

  it('counts matches rather than shown rows, so the ancestors do not inflate it', () => {
    const list = add(ROOT, 'Shopping');
    add(list, 'Milk', ['town']);
    expect(matchCount(session.tree, ['town'])).toBe(1);
    expect(filteredIds(session.tree, ['town'])!.size).toBe(2);
  });

  it('follows a tag written after the row was made', () => {
    const list = add(ROOT, 'Shopping');
    const kid = createFirstChild(session.tree, ctx.tick(), list, { title: 'Milk' });
    session.apply(kid);
    expect(filteredIds(session.tree, ['town'])!.size).toBe(0);
    ctx.tick();
    session.apply(setTags(session.tree, ctx, kid[0]!.id, ['town']));
    expect(filteredIds(session.tree, ['town'])!.size).toBe(2);
  });
});
