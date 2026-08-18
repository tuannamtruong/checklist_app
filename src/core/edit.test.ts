import { beforeEach, describe, expect, it } from 'vitest';
import {
  canBackspaceDelete,
  canIndent,
  canMoveTo,
  canOutdent,
  createFirstChild,
  createSiblingBelow,
  indent,
  moveDown,
  moveTo,
  moveUp,
  outdent,
  remove,
  setBody,
  setTitle,
  toggleDone,
  turnInto,
} from './edit';
import { FakeContext, Session } from './test-support';
import { childrenOf, parentOf } from './tree';
import { ROOT, type NodeId } from './types';

let ctx: FakeContext;
let session: Session;

/** Builds `a`, `b`, `c` at the root, in that order. */
function threeRows(): [NodeId, NodeId, NodeId] {
  const a = createRow(ROOT, 'a');
  const b = createRow(ROOT, 'b');
  const c = createRow(ROOT, 'c');
  return [a, b, c];
}

function createRow(parent: string, title: string): NodeId {
  ctx.tick();
  const children = childrenOf(session.tree, parent);
  const last = children[children.length - 1];
  const ops =
    last === undefined
      ? createFirstChild(session.tree, ctx, parent, { title })
      : createSiblingBelow(session.tree, ctx, last, { title });
  session.apply(ops);
  return ops[0]!.id;
}

beforeEach(() => {
  ctx = new FakeContext();
  session = new Session();
});

describe('creating rows', () => {
  it('puts a new sibling directly below the row it came from', () => {
    const [a, b, c] = threeRows();
    ctx.tick();
    const ops = createSiblingBelow(session.tree, ctx, a, { title: 'a2' });
    session.apply(ops);
    expect(childrenOf(session.tree, ROOT)).toEqual([a, ops[0]!.id, b, c]);
  });

  it('puts Enter-on-a-parent at the top of its children', () => {
    const [a] = threeRows();
    ctx.tick();
    const first = createFirstChild(session.tree, ctx, a, { title: 'first' });
    session.apply(first);
    ctx.tick();
    const second = createFirstChild(session.tree, ctx, a, { title: 'second' });
    session.apply(second);
    expect(childrenOf(session.tree, a)).toEqual([second[0]!.id, first[0]!.id]);
  });

  it('defaults a new row to a task — K-1', () => {
    const [a] = threeRows();
    expect(session.tree.nodes[a]!.kind).toBe('task');
  });
});

describe('field edits', () => {
  it('drops a no-op edit before it reaches the log — S-10', () => {
    const [a] = threeRows();
    expect(setTitle(session.tree, ctx, a, 'a')).toEqual([]);
    expect(turnInto(session.tree, ctx, a, 'task')).toEqual([]);
    expect(setTitle(session.tree, ctx, 'n_gone', 'x')).toEqual([]);

    ctx.tick();
    session.apply(turnInto(session.tree, ctx, a, 'note'));
    ctx.tick();
    session.apply(setBody(session.tree, ctx, a, 'kept'));
    expect(setBody(session.tree, ctx, a, 'kept')).toEqual([]);
  });

  it('ticks only tasks — K-2', () => {
    const [a] = threeRows();
    session.apply(toggleDone(session.tree, ctx, a));
    expect(session.tree.nodes[a]!.done).toBe(true);
    session.apply(turnInto(session.tree, ctx, a, 'note'));
    expect(toggleDone(session.tree, ctx, a)).toEqual([]);
  });

  it('gives a row turned into a note a body to open — K-3, K-5', () => {
    const [a] = threeRows();
    expect(session.tree.nodes[a]!.body).toBeNull();
    session.apply(turnInto(session.tree, ctx, a, 'note'));
    expect(session.tree.nodes[a]!.body).toBe('');
  });

  it('keeps a note that owns children — K-4', () => {
    const [a] = threeRows();
    ctx.tick();
    const child = createFirstChild(session.tree, ctx, a, { title: 'item' });
    session.apply(child);
    session.apply(turnInto(session.tree, ctx, a, 'note'));
    expect(childrenOf(session.tree, a)).toEqual([child[0]!.id]);
  });
});

describe('indent and outdent — T-3', () => {
  it('makes a row the child of the sibling above it', () => {
    const [a, b, c] = threeRows();
    ctx.tick();
    session.apply(indent(session.tree, ctx, b));
    expect(childrenOf(session.tree, ROOT)).toEqual([a, c]);
    expect(childrenOf(session.tree, a)).toEqual([b]);
    expect(parentOf(session.tree, b)).toBe(a);
  });

  it('refuses to indent the first row', () => {
    const [a] = threeRows();
    expect(canIndent(session.tree, a)).toBe(false);
    expect(indent(session.tree, ctx, a)).toEqual([]);
  });

  it('sends a row back out as its parent’s next sibling', () => {
    const [a, b, c] = threeRows();
    ctx.tick();
    session.apply(indent(session.tree, ctx, b));
    ctx.tick();
    session.apply(outdent(session.tree, ctx, b));
    expect(childrenOf(session.tree, ROOT)).toEqual([a, b, c]);
  });

  it('refuses to outdent a top-level row', () => {
    const [a] = threeRows();
    expect(canOutdent(session.tree, a)).toBe(false);
    expect(outdent(session.tree, ctx, a)).toEqual([]);
  });

  it('carries a row’s children with it', () => {
    const [a, b] = threeRows();
    ctx.tick();
    const child = createFirstChild(session.tree, ctx, b, { title: 'kid' });
    session.apply(child);
    ctx.tick();
    session.apply(indent(session.tree, ctx, b));
    expect(childrenOf(session.tree, a)).toEqual([b]);
    expect(childrenOf(session.tree, b)).toEqual([child[0]!.id]);
  });
});

describe('moving among siblings — T-4', () => {
  it('moves a row up and back down again', () => {
    const [a, b, c] = threeRows();
    ctx.tick();
    session.apply(moveUp(session.tree, ctx, c));
    expect(childrenOf(session.tree, ROOT)).toEqual([a, c, b]);
    ctx.tick();
    session.apply(moveDown(session.tree, ctx, c));
    expect(childrenOf(session.tree, ROOT)).toEqual([a, b, c]);
  });

  it('writes only the row that moved', () => {
    const [, , c] = threeRows();
    ctx.tick();
    const ops = moveUp(session.tree, ctx, c);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.id).toBe(c);
  });

  it('refuses at the ends', () => {
    const [a, , c] = threeRows();
    expect(moveUp(session.tree, ctx, a)).toEqual([]);
    expect(moveDown(session.tree, ctx, c)).toEqual([]);
  });

  it('walks the whole list one step at a time', () => {
    const [a, b, c] = threeRows();
    for (let i = 0; i < 2; i++) {
      ctx.tick();
      session.apply(moveUp(session.tree, ctx, c));
    }
    expect(childrenOf(session.tree, ROOT)).toEqual([c, a, b]);
  });
});

describe('arbitrary moves — T-5', () => {
  it('refuses to put a folder inside its own child', () => {
    const [a] = threeRows();
    ctx.tick();
    const child = createFirstChild(session.tree, ctx, a, { title: 'kid' });
    session.apply(child);
    const kid = child[0]!.id;
    expect(canMoveTo(session.tree, a, kid)).toBe(false);
    expect(moveTo(session.tree, ctx, a, kid, null)).toEqual([]);
    expect(canMoveTo(session.tree, a, a)).toBe(false);
  });

  it('allows the move that is not a loop', () => {
    const [a, b] = threeRows();
    expect(canMoveTo(session.tree, b, a)).toBe(true);
    ctx.tick();
    session.apply(moveTo(session.tree, ctx, b, a, null));
    expect(parentOf(session.tree, b)).toBe(a);
  });
});

describe('deleting — T-7 and §3.1', () => {
  it('refuses Backspace on a row that has children', () => {
    const [a] = threeRows();
    ctx.tick();
    session.apply(createFirstChild(session.tree, ctx, a, { title: 'kid' }));
    ctx.tick();
    session.apply(setTitle(session.tree, ctx, a, ''));
    expect(canBackspaceDelete(session.tree, a)).toBe(false);
  });

  it('allows Backspace on an empty leaf', () => {
    const [a] = threeRows();
    ctx.tick();
    session.apply(setTitle(session.tree, ctx, a, ''));
    expect(canBackspaceDelete(session.tree, a)).toBe(true);
    ctx.tick();
    session.apply(remove(session.tree, ctx, a));
    expect(childrenOf(session.tree, ROOT)).not.toContain(a);
  });

  it('deletes once — a second delete is a no-op', () => {
    const [a] = threeRows();
    ctx.tick();
    session.apply(remove(session.tree, ctx, a));
    expect(remove(session.tree, ctx, a)).toEqual([]);
  });

  it('refuses every field write to a tombstoned row', () => {
    // Backspace deletes the row and then moves the caret, and the blur that
    // follows would commit the emptied title after the delete — which the Done
    // view of T-12 would then render as "Untitled".
    const [a] = threeRows();
    ctx.tick();
    session.apply(remove(session.tree, ctx, a));
    expect(setTitle(session.tree, ctx, a, '')).toEqual([]);
    expect(toggleDone(session.tree, ctx, a)).toEqual([]);
    expect(setBody(session.tree, ctx, a, 'text')).toEqual([]);
    expect(turnInto(session.tree, ctx, a, 'note')).toEqual([]);
    expect(session.tree.nodes[a]!.title).toBe('a');
  });
});
