import { beforeEach, describe, expect, it } from 'vitest';
import { RowFocus } from './focus.svelte';

let focus: RowFocus;

beforeEach(() => {
  focus = new RowFocus();
});

describe('X-30, which note the caret is in', () => {
  it('is raised by a note taking the caret', () => {
    focus.enter('n_note', 'note');
    expect(focus.noteId).toBe('n_note');
    expect(focus.id).toBe('n_note');
  });

  it('is raised by a task taking the caret too — K-12', () => {
    focus.enter('n_task', 'task');
    expect(focus.noteId).toBe('n_task');
    expect(focus.id).toBe('n_task');
  });

  it('is left alone by a folder taking it — the point of the rule', () => {
    focus.enter('n_note', 'note');
    focus.enter('n_folder', 'folder');
    expect(focus.noteId).toBe('n_note');
    expect(focus.id).toBe('n_folder');
  });

  it('is replaced by the next body, not added to', () => {
    focus.enter('n_one', 'note');
    focus.enter('n_folder', 'folder');
    focus.enter('n_two', 'note');
    expect(focus.noteId).toBe('n_two');
  });

  it('is nothing until a body has held the caret', () => {
    focus.enter('n_folder', 'folder');
    expect(focus.noteId).toBeNull();
  });

  it('is cleared by the pane’s ✕ and by a navigation, and by nothing else', () => {
    focus.enter('n_note', 'note');
    focus.clearNote();
    expect(focus.noteId).toBeNull();
    // The caret has not moved: the row still holds it, and typing in that title
    // is what would raise the pane again.
    expect(focus.id).toBe('n_note');
  });

  it('is not set by a request, which moves the caret and lets the row answer', () => {
    // `request` is the keyboard's: it asks a row for the caret, the row's title
    // takes focus, and `enter` runs there with the kind this class cannot know.
    focus.request('n_note');
    expect(focus.noteId).toBeNull();
    expect(focus.id).toBe('n_note');
    expect(focus.seq).toBe(1);
  });
});
