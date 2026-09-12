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
  createLastChildren,
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
  setDay,
  setPriority,
  setEvery,
  setTags,
  setTitle,
  tickTimely,
  toggleDone,
  turnInto,
  unarchive,
} from './edit';
import { FakeContext, Session, titlesOf } from './test-support';
import { childrenOf, parentOf } from './tree';
import { AGENDA, ROOT, TIMELY, type NodeId } from './types';

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

/** K-9's titles, as the rows `createLastChildren` takes since A-8. */
function rowsFor(titles: readonly string[]): { title: string }[] {
  return titles.map((title) => ({ title }));
}

describe('several rows at once — K-9', () => {
  it('appends one row per title, in the order they were given', () => {
    const [a, b, c] = threeRows();
    ctx.tick();
    const ops = createLastChildren(session.tree, ctx, ROOT, rowsFor(['Milk', 'Bread', 'Eggs']));
    session.apply(ops);
    expect(titlesOf(session.tree, childrenOf(session.tree, ROOT))).toEqual([
      'a',
      'b',
      'c',
      'Milk',
      'Bread',
      'Eggs',
    ]);
    expect([a, b, c].every((id) => session.tree.nodes[id]!.title !== '')).toBe(true);
  });

  it('mints a key per row against the row before it, not against the tree', () => {
    ctx.tick();
    const ops = createLastChildren(session.tree, ctx, ROOT, rowsFor(['one', 'two', 'three']));
    const keys = ops.filter((op) => op.op === 'create').map((op) => op.order);
    expect(new Set(keys).size).toBe(3);
    expect([...keys].sort()).toEqual(keys);
  });

  it('is every row a task — K-1', () => {
    ctx.tick();
    const ops = createLastChildren(session.tree, ctx, ROOT, rowsFor(['Milk', 'Bread']));
    session.apply(ops);
    const rows = childrenOf(session.tree, ROOT).map((id) => session.tree.nodes[id]!);
    expect(rows.map((row) => row.kind)).toEqual(['task', 'task']);
  });

  // A-8. Each line of a paste brings its own `#tag` prefix, so the tags are the
  // row's rather than the block's — `parseTagged` in `tags.ts` reads them off.
  it('gives each row its own tags, and no two lines need agree', () => {
    ctx.tick();
    const ops = createLastChildren(session.tree, ctx, ROOT, [
      { title: 'Milk', tags: ['Town'] },
      { title: 'Bread' },
      { title: 'Eggs', tags: ['errand'] },
    ]);
    session.apply(ops);
    const rows = childrenOf(session.tree, ROOT).map((id) => session.tree.nodes[id]!);
    expect(rows.map((row) => row.tags)).toEqual([['town'], [], ['errand']]);
  });

  it('writes nothing when there is nothing to write — S-10', () => {
    expect(createLastChildren(session.tree, ctx, ROOT, [])).toEqual([]);
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
    // A task, which since K-12 arrives with one of its own.
    expect(session.tree.nodes[a]!.body).toBe('');
    session.apply(turnInto(session.tree, ctx, a, 'folder'));
    ctx.tick();
    session.apply(turnInto(session.tree, ctx, a, 'note'));
    expect(session.tree.nodes[a]!.body).toBe('');
  });

  it('carries a body between the two kinds that have one — K-12', () => {
    const [a] = threeRows();
    session.apply(setBody(session.tree, ctx, a, 'the address'));
    ctx.tick();
    session.apply(turnInto(session.tree, ctx, a, 'note'));
    // Nothing is written to `body` by the conversion, in either direction: it
    // is what makes K-5 reversible, and what makes K-12 one field rather than
    // two that have to agree.
    expect(session.tree.nodes[a]!.body).toBe('the address');
    ctx.tick();
    session.apply(turnInto(session.tree, ctx, a, 'task'));
    expect(session.tree.nodes[a]!.body).toBe('the address');
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

  it('takes a row back out of the archive whichever way it left — T-12', () => {
    const [a, b] = threeRows();
    ctx.tick();
    session.apply(toggleDone(session.tree, ctx, a));
    ctx.tick();
    session.apply(remove(session.tree, ctx, b));

    expect(unarchive(session.tree, ctx, a).map((op) => op.op)).toEqual(['set']);
    expect(unarchive(session.tree, ctx, b).map((op) => op.op)).toEqual(['restore']);
    expect(unarchive(session.tree, ctx, 'n_missing')).toEqual([]);
  });

  it('clears both the tombstone and the tick when the row carries both', () => {
    // Otherwise a row deleted while ticked would come back and go straight into
    // the archive again, which reads as a restore that did nothing.
    const [a] = threeRows();
    ctx.tick();
    session.apply(toggleDone(session.tree, ctx, a));
    ctx.tick();
    session.apply(remove(session.tree, ctx, a));

    ctx.tick();
    const ops = unarchive(session.tree, ctx, a);
    expect(ops.map((op) => op.op)).toEqual(['restore', 'set']);
    session.apply(ops);
    expect(childrenOf(session.tree, ROOT)).toContain(a);
    expect(session.tree.nodes[a]!.done).toBe(false);
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

describe('the agenda — G-1, G-5, G-6', () => {
  it('files a new item on the page’s day, in the create’s own set', () => {
    const ops = createLastChild(session.tree, ctx, AGENDA, { title: 'Ring back', day: '2026-09-09' });
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ op: 'create', parent: AGENDA, kind: 'task' });
    expect(ops[1]).toMatchObject({ op: 'set', title: 'Ring back', day: '2026-09-09' });
  });

  it('writes no day at all for a row in the tree', () => {
    const ops = createLastChild(session.tree, ctx, ROOT, { title: 'Shopping' });
    expect(ops[1]).not.toHaveProperty('day');
  });

  it('refuses to outdent a top-level agenda item into the tree', () => {
    const ops = createLastChild(session.tree, ctx, AGENDA, { title: 'Ring back', day: '2026-09-08' });
    session.apply(ops);
    const id = ops[0]!.id;
    expect(canOutdent(session.tree, id)).toBe(false);
    expect(outdent(session.tree, ctx.tick(), id)).toEqual([]);
    expect(parentOf(session.tree, id)).toBe(AGENDA);
  });

  it('outdents a child of an agenda item as far as the item and no further', () => {
    const top = createLastChild(session.tree, ctx, AGENDA, { title: 'Parcel', day: '2026-09-08' });
    session.apply(top);
    const child = createLastChild(session.tree, ctx.tick(), top[0]!.id, { title: 'Card' });
    session.apply(child);
    session.apply(outdent(session.tree, ctx.tick(), child[0]!.id));
    expect(parentOf(session.tree, child[0]!.id)).toBe(AGENDA);
    expect(canOutdent(session.tree, child[0]!.id)).toBe(false);
  });

  it('moves an item between the lists without moving it anywhere — G-6', () => {
    const ops = createLastChild(session.tree, ctx, AGENDA, { title: 'Ring back', day: '2026-09-08' });
    session.apply(ops);
    const id = ops[0]!.id;
    session.apply(setDay(session.tree, ctx.tick(), id, '2026-09-09'));
    expect(session.tree.nodes[id]!.day).toBe('2026-09-09');
    expect(parentOf(session.tree, id)).toBe(AGENDA);
  });
});

describe('Timely — R-1 to R-6', () => {
  /** 2026-09-08, 10:00 local — the day these tests are written against. */
  const NOON = new Date(2026, 8, 8, 10, 0, 0).getTime();

  function chore(title: string, every: string): NodeId {
    const ops = createLastChild(session.tree, ctx.tick(), TIMELY, { title, every });
    session.apply(ops);
    return ops[0]!.id;
  }

  it('creates a task carrying its period from the moment it exists — R-2', () => {
    const ops = createLastChild(session.tree, ctx, TIMELY, { title: 'Plants', every: '3d' });
    expect(ops[0]).toMatchObject({ op: 'create', parent: TIMELY, kind: 'task' });
    expect(ops[1]).toMatchObject({ op: 'set', title: 'Plants', every: '3d' });
    session.apply(ops);
    expect(session.tree.nodes[ops[0]!.id]!.every).toBe('3d');
  });

  it('writes the period as one last-writer-wins set, and refuses one it cannot read', () => {
    const id = chore('Plants', '1d');
    expect(setEvery(session.tree, ctx.tick(), id, '5d')).toMatchObject([
      { op: 'set', id, every: '5d' },
    ]);
    // S-10: a period that is already the row's costs no write, and neither does
    // one this build cannot parse.
    expect(setEvery(session.tree, ctx.tick(), id, '1d')).toEqual([]);
    expect(setEvery(session.tree, ctx.tick(), id, '2 weeks')).toEqual([]);
  });

  it('ticks by writing the next due day and never `done` — R-3', () => {
    const id = chore('Plants', '5d');
    const ops = tickTimely(session.tree, ctx.at(NOON), id);
    expect(ops).toMatchObject([{ op: 'set', id, day: '2026-09-13' }]);
    expect(ops[0]).not.toHaveProperty('done');
    session.apply(ops);
    expect(session.tree.nodes[id]!.done).toBe(false);
    // T-11 would have taken it out of the list; nothing did.
    expect(childrenOf(session.tree, TIMELY)).toContain(id);
  });

  it('counts the period from the tick rather than from the day it was due — R-5', () => {
    const id = chore('Filter', '5d');
    session.apply(tickTimely(session.tree, ctx.at(NOON), id));
    expect(session.tree.nodes[id]!.day).toBe('2026-09-13');
    // Three days late: the next one is five days after *this* tick, not after
    // the 13th.
    session.apply(tickTimely(session.tree, ctx.at(NOON + 8 * 24 * 60 * 60 * 1000), id));
    expect(session.tree.nodes[id]!.day).toBe('2026-09-21');
  });

  it('brings a waiting item back with the same control — R-6', () => {
    const id = chore('Plants', '1d');
    session.apply(tickTimely(session.tree, ctx.at(NOON), id));
    expect(session.tree.nodes[id]!.day).toBe('2026-09-09');
    session.apply(tickTimely(session.tree, ctx.at(NOON), id));
    expect(session.tree.nodes[id]!.day).toBe('2026-09-08');
  });

  it('holds nothing inside a chore, so indent and a drop are refused — R-1', () => {
    const first = chore('Plants', '1d');
    const second = chore('Filter', '5d');
    expect(canMoveTo(session.tree, second, first)).toBe(false);
    expect(canIndent(session.tree, second)).toBe(false);
    expect(indent(session.tree, ctx.tick(), second)).toEqual([]);
    expect(canDrop(session.tree, second, first, 'inside')).toBe(false);
    // Above and below are still ordinary moves: the list is dragged into order.
    expect(canDrop(session.tree, second, first, 'before')).toBe(true);
  });

  it('lets nothing cross between the three lists — G-1, R-1', () => {
    const chorish = chore('Plants', '1d');
    const filed = createLastChild(session.tree, ctx.tick(), AGENDA, {
      title: 'Parcel',
      day: '2026-09-08',
    });
    session.apply(filed);
    const parcel = filed[0]!.id;
    const rooted = createLastChild(session.tree, ctx.tick(), ROOT, { title: 'Shopping' });
    session.apply(rooted);
    const shopping = rooted[0]!.id;
    expect(canMoveTo(session.tree, shopping, TIMELY)).toBe(false);
    expect(canMoveTo(session.tree, chorish, ROOT)).toBe(false);
    expect(canMoveTo(session.tree, parcel, TIMELY)).toBe(false);
    expect(moveTo(session.tree, ctx.tick(), shopping, TIMELY, null)).toEqual([]);
    // And each stays a move inside its own list.
    expect(canMoveTo(session.tree, chorish, TIMELY)).toBe(true);
    expect(canMoveTo(session.tree, parcel, AGENDA)).toBe(true);
  });
});
