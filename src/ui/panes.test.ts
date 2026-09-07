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
  it('draws no pane for the root, a folder or a task', () => {
    for (const route of [null, shopping, milk]) {
      expect(panesFor(session.tree, route, null)).toEqual({
        listId: route,
        noteId: null,
        fromCaret: false,
      });
    }
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

  // A caret in a folder's or a task's title never reaches here: `RowFocus.enter`
  // leaves the note where it was, which is what "the caret raises a note and
  // nothing else lowers it" means — `focus.svelte.test.ts`.
  it('draws the route’s pane, and no pane at all, when no note holds the caret', () => {
    expect(panesFor(session.tree, shopping, null).noteId).toBeNull();
    expect(panesFor(session.tree, trip, null)).toEqual({
      listId: shopping,
      noteId: trip,
      fromCaret: false,
    });
  });

  it('closes it when the note the caret was in stops being a note — K-5', () => {
    session.apply(turnInto(session.tree, ctx.tick(), trip, 'folder'));
    expect(panesFor(session.tree, shopping, trip).noteId).toBeNull();
  });

  it('draws no pane for a note a peer has deleted under the caret — T-7, X-11', () => {
    session.apply(remove(session.tree, ctx.tick(), trip));
    expect(panesFor(session.tree, shopping, trip).noteId).toBeNull();
    expect(panesFor(session.tree, shopping, packing).noteId).toBeNull();
  });
});
