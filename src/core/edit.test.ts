import { beforeEach, describe, expect, it } from 'vitest';
import {
  canBackspaceDelete,
  canDrop,
  canIndent,
  canMoveTo,
  canOutdent,
  canRestore,
  addTag,
  createFirstChild,
  createLastChild,
  createSiblingBelow,
  dropOnto,
  indent,
  moveDown,
  moveTo,
  moveUp,
  nextPriority,
  outdent,
  remove,
  removeTag,
  restore,
  setBody,
  setPriority,
  setTags,
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

describe('tags and priority — A-1, A-2', () => {
  it('writes the whole set, cleaned and sorted', () => {
    const [a] = threeRows();
    ctx.tick();
    const ops = setTags(session.tree, ctx, a, ['#Town', ' errand ', 'town']);
    session.apply(ops);
    expect(session.tree.nodes[a]!.tags).toEqual(['errand', 'town']);
    expect(ops).toHaveLength(1);
  });

  it('adds and removes by rewriting the set — past_decision.md §10', () => {
    const [a] = threeRows();
    session.apply(setTags(session.tree, ctx.tick(), a, ['town']));
    session.apply(addTag(session.tree, ctx.tick(), a, 'Errand'));
    expect(session.tree.nodes[a]!.tags).toEqual(['errand', 'town']);
    session.apply(removeTag(session.tree, ctx.tick(), a, 'town'));
    expect(session.tree.nodes[a]!.tags).toEqual(['errand']);
  });

  // S-10: a set that is already what the row holds is not a write.
  it('writes nothing when the set is unchanged, whatever order it arrives in', () => {
    const [a] = threeRows();
    session.apply(setTags(session.tree, ctx.tick(), a, ['errand', 'town']));
    expect(setTags(session.tree, ctx.tick(), a, ['town', 'ERRAND'])).toEqual([]);
    expect(removeTag(session.tree, ctx.tick(), a, 'nothing')).toEqual([]);
  });

  it('starts every row at no tags and no flag', () => {
    const [a] = threeRows();
    expect(session.tree.nodes[a]!.tags).toEqual([]);
    expect(session.tree.nodes[a]!.priority).toBe('none');
  });

  it('sets and clears a priority, and clearing is a write like any other', () => {
    const [a] = threeRows();
    session.apply(setPriority(session.tree, ctx.tick(), a, 'high'));
    expect(session.tree.nodes[a]!.priority).toBe('high');
    const cleared = setPriority(session.tree, ctx.tick(), a, 'none');
    expect(cleared).toHaveLength(1);
    session.apply(cleared);
    expect(session.tree.nodes[a]!.priority).toBe('none');
    expect(setPriority(session.tree, ctx.tick(), a, 'none')).toEqual([]);
  });

  it('cycles the flag highest first — §4.1', () => {
    expect(nextPriority('none')).toBe('high');
    expect(nextPriority('high')).toBe('medium');
    expect(nextPriority('medium')).toBe('low');
    expect(nextPriority('low')).toBe('none');
  });

  // A-6. Without this the row would leave the filtered view as it was created.
  it('gives a new row the tags it was created under', () => {
    const ops = createLastChild(session.tree, ctx.tick(), ROOT, { title: 'Milk', tags: ['Town'] });
    session.apply(ops);
    expect(session.tree.nodes[ops[0]!.id]!.tags).toEqual(['town']);
  });
});

describe('dragging — T-14', () => {
  it('drops a row above the one it landed on', () => {
    const [a, b, c] = threeRows();
    ctx.tick();
    session.apply(dropOnto(session.tree, ctx, c, a, 'before'));
    expect(childrenOf(session.tree, ROOT)).toEqual([c, a, b]);
  });

  it('drops a row below the one it landed on', () => {
    const [a, b, c] = threeRows();
    ctx.tick();
    session.apply(dropOnto(session.tree, ctx, a, b, 'after'));
    expect(childrenOf(session.tree, ROOT)).toEqual([b, a, c]);
  });

  // The dragged row leaves the sibling list before the key is minted, or
  // "below the row above me" would mean "below myself" and nothing would move.
  it('drops a row below its own neighbour without moving it nowhere', () => {
    const [a, b, c] = threeRows();
    ctx.tick();
    session.apply(dropOnto(session.tree, ctx, b, c, 'after'));
    expect(childrenOf(session.tree, ROOT)).toEqual([a, c, b]);
  });

  it('drops a row inside the one it landed on, at the end of what is there', () => {
    const [a, b] = threeRows();
    ctx.tick();
    const first = createFirstChild(session.tree, ctx, a, { title: 'kid' });
    session.apply(first);
    ctx.tick();
    session.apply(dropOnto(session.tree, ctx, b, a, 'inside'));
    expect(childrenOf(session.tree, a)).toEqual([first[0]!.id, b]);
  });

  // T-5, from the one gesture that can express it — requirements.md §15 row 2.
  it('refuses a drop into the dragged row’s own descendant', () => {
    const [a] = threeRows();
    ctx.tick();
    const child = createFirstChild(session.tree, ctx, a, { title: 'kid' });
    session.apply(child);
    const kid = child[0]!.id;
    expect(canDrop(session.tree, a, kid, 'inside')).toBe(false);
    expect(dropOnto(session.tree, ctx, a, kid, 'inside')).toEqual([]);
    // Above the child is still inside `a`, and that is a move `a` can make.
    expect(canDrop(session.tree, a, kid, 'before')).toBe(false);
  });

  it('refuses a drop onto the row being dragged', () => {
    const [a] = threeRows();
    expect(canDrop(session.tree, a, a, 'inside')).toBe(false);
    expect(dropOnto(session.tree, ctx, a, a, 'after')).toEqual([]);
  });

  it('writes one move op, like every other move', () => {
    const [a, b] = threeRows();
    ctx.tick();
    const ops = dropOnto(session.tree, ctx, a, b, 'after');
    expect(ops.map((op) => op.op)).toEqual(['move']);
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

  it('restores a tombstoned row, and what it held comes with it — T-13', () => {
    // One op, because T-7 never tombstoned the children individually: it
    // inherits at read time, so clearing the top of the run is the whole
    // operation — sync-flow.md §4.9.
    const [a] = threeRows();
    ctx.tick();
    const born = createFirstChild(session.tree, ctx, a);
    session.apply(born);
    const child = born[0]!.id;
    ctx.tick();
    session.apply(remove(session.tree, ctx, a));
    expect(session.tree.deleted.has(child)).toBe(true);

    ctx.tick();
    const ops = restore(session.tree, ctx, a);
    expect(ops.map((op) => op.op)).toEqual(['restore']);
    session.apply(ops);
    expect(childrenOf(session.tree, ROOT)).toContain(a);
    expect(childrenOf(session.tree, a)).toContain(child);
  });

  it('returns the row to the order key it kept', () => {
    const [a, b, c] = threeRows();
    ctx.tick();
    session.apply(remove(session.tree, ctx, b));
    ctx.tick();
    session.apply(restore(session.tree, ctx, b));
    expect(childrenOf(session.tree, ROOT)).toEqual([a, b, c]);
  });

  it('refuses a restore that would change nothing', () => {
    const [a] = threeRows();
    // Never deleted, so there is no tombstone to clear — S-10.
    expect(restore(session.tree, ctx, a)).toEqual([]);
    expect(restore(session.tree, ctx, 'n_missing')).toEqual([]);
  });

  it('will not raise a row out of an ancestor’s tombstone — canRestore', () => {
    const [a] = threeRows();
    ctx.tick();
    const born = createFirstChild(session.tree, ctx, a);
    session.apply(born);
    const child = born[0]!.id;
    ctx.tick();
    session.apply(remove(session.tree, ctx, a));
    // The child carries no tombstone of its own, so restoring it would write an
    // op that clears nothing and leaves the row exactly as gone as it was.
    expect(canRestore(session.tree, child)).toBe(false);
    expect(restore(session.tree, ctx, child)).toEqual([]);
    expect(canRestore(session.tree, a)).toBe(true);
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
