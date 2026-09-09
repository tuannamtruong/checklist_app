// A-4 — requirements.md §4.2. Finding rows by tag is a read of the tree, so
// everything here is one: no state, no index, nothing to invalidate.

import { beforeEach, describe, expect, it } from 'vitest';
import { taggedRows, tagsInTree } from './filter';
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

  // The list is the tree's, and neither a finished row nor a deleted one is in
  // the tree — T-11 and T-7 took them out before this ever ran.
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

describe('the rows a tag names', () => {
  it('names none at all when no tag is chosen: no tags is not a question', () => {
    add(ROOT, 'a', ['town']);
    expect(taggedRows(session.tree, [])).toEqual([]);
  });

  it('names the matching row and carries the path it sits on, not the ancestors as rows', () => {
    const list = add(ROOT, 'Shopping');
    const milk = add(list, 'Milk', ['town']);
    add(list, 'Bread');
    add(ROOT, 'House');

    expect(taggedRows(session.tree, ['town'])).toEqual([{ id: milk, path: [list] }]);
  });

  it('ANDs the selection: a row needs every tag', () => {
    const both = add(ROOT, 'both', ['errand', 'town']);
    add(ROOT, 'one', ['town']);

    expect(taggedRows(session.tree, ['errand', 'town']).map((row) => row.id)).toEqual([both]);
  });

  it('lists in tree order, so two rows read the way the tree reads', () => {
    const list = add(ROOT, 'Shopping');
    const milk = add(list, 'Milk', ['town']);
    const house = add(ROOT, 'House', ['town']);
    expect(taggedRows(session.tree, ['town']).map((row) => row.id)).toEqual([milk, house]);
  });

  it('follows a tag written after the row was made', () => {
    const list = add(ROOT, 'Shopping');
    const kid = createFirstChild(session.tree, ctx.tick(), list, { title: 'Milk' });
    session.apply(kid);
    expect(taggedRows(session.tree, ['town'])).toEqual([]);
    ctx.tick();
    session.apply(setTags(session.tree, ctx, kid[0]!.id, ['town']));
    expect(taggedRows(session.tree, ['town']).map((row) => row.id)).toEqual([kid[0]!.id]);
  });
});
