// requirements.md §6. The interesting claims are F-3 — that search reaches what
// the tree has dropped — and the AND-across-fields rule, which is what makes a
// two-word query useful in a checklist rather than surprising.

import { describe, expect, it } from 'vitest';
import { createLastChild, remove, setBody, setTitle, toggleDone } from './edit';
import { searchTree, termsOf } from './search';
import { FakeContext, Session } from './test-support';
import { ROOT, type NodeId, type ParentId } from './types';

function add(session: Session, ctx: FakeContext, parent: ParentId, title: string): NodeId {
  const ops = session.apply(
    createLastChild(session.tree, ctx.tick(), parent, { title, kind: 'task' }),
  );
  return ops.ops[ops.ops.length - 2]!.id;
}

function build(): { session: Session; ctx: FakeContext; ids: Record<string, NodeId> } {
  const session = new Session();
  const ctx = new FakeContext();
  const shopping = add(session, ctx, ROOT, 'Shopping');
  const milk = add(session, ctx, shopping, 'Oat milk');
  const bread = add(session, ctx, shopping, 'Bread');
  const recipe = add(session, ctx, ROOT, 'Recipe');
  session.apply(setBody(session.tree, ctx.tick(), recipe, 'Warm the milk from the corner shop.'));
  return { session, ctx, ids: { shopping, milk, bread, recipe } };
}

function hitIds(session: Session, query: string): NodeId[] {
  return searchTree(session.tree, query).map((hit) => hit.id);
}

describe('termsOf', () => {
  it('splits on whitespace and folds case', () => {
    expect(termsOf('  Oat   MILK ')).toEqual(['oat', 'milk']);
  });

  it('answers nothing for a query that is only whitespace', () => {
    expect(termsOf('   ')).toEqual([]);
  });
});

describe('searchTree — F-1', () => {
  it('finds a title by any fragment, not only a word start', () => {
    const { session, ids } = build();
    // A checklist is full of fragments and abbreviations, so "12kg" has to be
    // reachable by "kg" — matching on word starts would miss it.
    expect(hitIds(session, 'ilk')).toEqual([ids.milk, ids.recipe]);
    expect(hitIds(session, 'oat')).toEqual([ids.milk]);
  });

  it('finds a note by its body, and carries a snippet of it', () => {
    const { session, ids } = build();
    const hits = searchTree(session.tree, 'corner');
    expect(hits.map((hit) => hit.id)).toEqual([ids.recipe]);
    expect(hits[0]!.field).toBe('body');
    expect(hits[0]!.snippet).toContain('corner shop');
  });

  it('requires every term, and lets each match a different field', () => {
    const { session, ids } = build();
    // "milk" is in the recipe's body, "recipe" is its title — one row, two fields.
    expect(hitIds(session, 'milk recipe')).toEqual([ids.recipe]);
    expect(hitIds(session, 'milk unicorn')).toEqual([]);
  });

  it('answers nothing at all for an empty query', () => {
    const { session } = build();
    expect(searchTree(session.tree, '   ')).toEqual([]);
  });

  it('ranks a title match before a body match', () => {
    const { session, ctx, ids } = build();
    session.apply(setTitle(session.tree, ctx.tick(), ids.bread!, 'Milk bread'));
    const hits = searchTree(session.tree, 'milk');
    expect(hits[0]!.field).toBe('title');
    expect(hits[hits.length - 1]!.id).toBe(ids.recipe);
  });
});

describe('searchTree — F-2 and F-3', () => {
  it('carries the path each hit sits on', () => {
    const { session, ids } = build();
    expect(searchTree(session.tree, 'oat')[0]!.path).toEqual([ids.shopping]);
  });

  it('still finds a finished row, and says it is finished', () => {
    const { session, ctx, ids } = build();
    session.apply(toggleDone(session.tree, ctx.tick(), ids.milk!));
    // T-11 has taken it out of the tree entirely, which is exactly why this is
    // the only place left that finds it by name.
    expect(session.tree.children.get(ids.shopping!)).not.toContain(ids.milk);
    const hits = searchTree(session.tree, 'oat');
    expect(hits.map((hit) => hit.id)).toEqual([ids.milk]);
    expect(hits[0]!.done).toBe(true);
    expect(hits[0]!.deleted).toBe(false);
  });

  it('still finds a deleted row, and says it is deleted', () => {
    const { session, ctx, ids } = build();
    session.apply(remove(session.tree, ctx.tick(), ids.shopping!));
    const hits = searchTree(session.tree, 'oat');
    expect(hits.map((hit) => hit.id)).toEqual([ids.milk]);
    // Inherited from the tombstoned parent, per T-7 — the row itself was never
    // deleted, and the badge is about what the user can see rather than about
    // which node carries the flag.
    expect(hits[0]!.deleted).toBe(true);
  });
});
