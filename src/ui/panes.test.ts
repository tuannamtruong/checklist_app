import { beforeEach, describe, expect, it } from 'vitest';
import { createLastChild, remove, turnInto } from '../core/edit';
import { FakeContext, Session } from '../core/test-support';
import { ROOT, type Kind, type NodeId } from '../core/types';
import { panesFor } from './panes';

let session: Session;
let ctx: FakeContext;

function add(parent: string, kind: Kind): NodeId {
  return session.apply(
    createLastChild(session.tree, ctx.tick(), parent, { kind }),
  ).ops.at(-1)!.id;
}

// One tree for every case: a folder holding a task and a note, the note holding
// a sub-note, and a second folder somewhere else to navigate to.
let shopping: NodeId;
let milk: NodeId;
let trip: NodeId;
let packing: NodeId;

beforeEach(() => {
  session = new Session();
  ctx = new FakeContext();
  shopping = add(ROOT, 'folder');
  milk = add(shopping, 'task');
  trip = add(shopping, 'note');
  packing = add(trip, 'note');
});

describe('X-21, the route', () => {
  it('draws no pane for the root or a folder', () => {
    for (const route of [null, shopping]) {
      expect(panesFor(session.tree, route, null)).toEqual({
        listId: route,
        noteId: null,
        fromCaret: false,
      });
    }
  });

  it('splits a task’s route exactly as a note’s — K-12', () => {
    expect(panesFor(session.tree, milk, null)).toEqual({
      listId: shopping,
      noteId: milk,
      fromCaret: false,
    });
  });

  it('walks past a task as well as a note — K-12', () => {
    // A note filed under a check item: the left column is still the folder the
    // reader is in, because neither ancestor is a list.
    const detail = add(milk, 'note');
    expect(panesFor(session.tree, detail, null).listId).toBe(shopping);
  });

  it("draws a note beside the nearest list above it, walked past every note", () => {
    expect(panesFor(session.tree, trip, null)).toEqual({
      listId: shopping,
      noteId: trip,
      fromCaret: false,
    });
    expect(panesFor(session.tree, packing, null)).toEqual({
      listId: shopping,
      noteId: packing,
      fromCaret: false,
    });
  });

  it('draws a top-level note beside the root page', () => {
    const loose = add(ROOT, 'note');
    expect(panesFor(session.tree, loose, null).listId).toBeNull();
  });
});

describe('X-30, the caret', () => {
  it('raises the note it is in and leaves the list where the route put it', () => {
    expect(panesFor(session.tree, shopping, trip)).toEqual({
      listId: shopping,
      noteId: trip,
      fromCaret: true,
    });
  });

  it('leaves the left column alone however deep the note is', () => {
    // The pane is `packing`, whose own list is `trip`. The reader is on
    // `shopping` and stays there — this is the whole of X-30.
    expect(panesFor(session.tree, shopping, packing).listId).toBe(shopping);
    expect(panesFor(session.tree, null, packing).listId).toBeNull();
  });

  it('replaces the route’s note rather than opening a second pane', () => {
    expect(panesFor(session.tree, trip, packing)).toEqual({
      listId: shopping,
      noteId: packing,
      fromCaret: true,
    });
  });

  it("is the route's own pane when the caret is in the route's note", () => {
    expect(panesFor(session.tree, trip, trip)).toEqual({
      listId: shopping,
      noteId: trip,
      fromCaret: false,
    });
  });

  // A caret in a folder's title never reaches here: `RowFocus.enter` leaves the
  // note where it was, which is what "the caret raises a body and nothing else
  // lowers it" means — `focus.svelte.test.ts`.
  it('draws the route’s pane, and no pane at all, when no note holds the caret', () => {
    expect(panesFor(session.tree, shopping, null).noteId).toBeNull();
    expect(panesFor(session.tree, trip, null)).toEqual({
      listId: shopping,
      noteId: trip,
      fromCaret: false,
    });
  });

  it('closes it when the row the caret was in stops having a body — K-5', () => {
    session.apply(turnInto(session.tree, ctx.tick(), trip, 'folder'));
    expect(panesFor(session.tree, shopping, trip).noteId).toBeNull();
  });

  it('keeps it when a note becomes a task, which still has one — K-12', () => {
    session.apply(turnInto(session.tree, ctx.tick(), trip, 'task'));
    expect(panesFor(session.tree, shopping, trip)).toEqual({
      listId: shopping,
      noteId: trip,
      fromCaret: true,
    });
  });

  it('draws no pane for a note a peer has deleted under the caret — T-7, X-11', () => {
    session.apply(remove(session.tree, ctx.tick(), trip));
    expect(panesFor(session.tree, shopping, trip).noteId).toBeNull();
    expect(panesFor(session.tree, shopping, packing).noteId).toBeNull();
  });
});
