import { describe, expect, it } from 'vitest';
import { NOTE_WIDTH, SIDEBAR_WIDTH, ViewState } from './view-state.svelte';

/** Enough of `Storage` for a class that only ever gets and sets. */
function fakeStorage(seed: Record<string, string> = {}): Storage {
  const held = new Map(Object.entries(seed));
  return {
    get length() {
      return held.size;
    },
    clear: () => held.clear(),
    getItem: (key: string) => held.get(key) ?? null,
    key: (index: number) => [...held.keys()][index] ?? null,
    removeItem: (key: string) => held.delete(key),
    setItem: (key: string, value: string) => void held.set(key, value),
  } as Storage;
}

describe('sidebar width — X-20', () => {
  it('starts at the width the column had before it could be dragged', () => {
    expect(new ViewState(fakeStorage()).sidebarWidth).toBe(SIDEBAR_WIDTH.default);
  });

  it('clamps to the bounds rather than refusing the drag', () => {
    const view = new ViewState(fakeStorage());
    view.setSidebarWidth(20);
    expect(view.sidebarWidth).toBe(SIDEBAR_WIDTH.min);
    view.setSidebarWidth(4000);
    expect(view.sidebarWidth).toBe(SIDEBAR_WIDTH.max);
  });

  it('persists a width and reads it back on the next visit', () => {
    const storage = fakeStorage();
    new ViewState(storage).setSidebarWidth(300);
    expect(new ViewState(storage).sidebarWidth).toBe(300);
  });

  it('clamps a stored width, so bounds that tighten cannot strand a device', () => {
    const storage = fakeStorage({ 'checklist.sidebarwidth': '9000' });
    expect(new ViewState(storage).sidebarWidth).toBe(SIDEBAR_WIDTH.max);
  });

  it('ignores a stored value that is not a width', () => {
    const storage = fakeStorage({ 'checklist.sidebarwidth': 'wide' });
    expect(new ViewState(storage).sidebarWidth).toBe(SIDEBAR_WIDTH.default);
  });
});

describe('note pane width — X-24', () => {
  it('starts at the share the pane was fixed at before the divider existed', () => {
    expect(new ViewState(fakeStorage()).notePaneWidth).toBe(NOTE_WIDTH.default);
  });

  it('has its own bounds and its own key, so one grip cannot move the other', () => {
    const storage = fakeStorage();
    const view = new ViewState(storage);
    view.setNotePaneWidth(4000);
    expect(view.notePaneWidth).toBe(NOTE_WIDTH.ceiling);
    expect(view.sidebarWidth).toBe(SIDEBAR_WIDTH.default);
    expect(storage.getItem('checklist.notewidth')).toBe(String(NOTE_WIDTH.ceiling));
    expect(storage.getItem('checklist.sidebarwidth')).toBe(null);
  });

  it('persists a width and reads it back on the next visit', () => {
    const storage = fakeStorage();
    new ViewState(storage).setNotePaneWidth(500);
    expect(new ViewState(storage).notePaneWidth).toBe(500);
  });

  it('clamps a stored width and ignores one that is not a width', () => {
    expect(new ViewState(fakeStorage({ 'checklist.notewidth': '9000' })).notePaneWidth).toBe(NOTE_WIDTH.ceiling);
    expect(new ViewState(fakeStorage({ 'checklist.notewidth': 'wide' })).notePaneWidth).toBe(NOTE_WIDTH.default);
  });

  // What stops the divider is the room in the window, so the bound is arithmetic
  // over the two things beside the pane rather than a number chosen once.
  it('stops the divider at the room in the window, not at a fixed number', () => {
    const view = new ViewState(fakeStorage());
    view.setViewport(1440);
    expect(view.noteWidthMax).toBe(1440 - SIDEBAR_WIDTH.default - NOTE_WIDTH.listFloor);
    view.setNotePaneWidth(4000);
    expect(view.notePaneWidth).toBe(view.noteWidthMax);
  });

  // The list keeps SIDEBAR_WIDTH.min and no more: enough to click back to,
  // which is what the column is for while a note is open beside it.
  it('leaves the list a strip rather than a column', () => {
    const view = new ViewState(fakeStorage());
    view.setViewport(1440);
    view.setNotePaneWidth(4000);
    expect(1440 - SIDEBAR_WIDTH.default - view.notePaneWidth).toBe(SIDEBAR_WIDTH.min);
  });

  it('takes the sidebar out of the same row, so widening one narrows the other', () => {
    const view = new ViewState(fakeStorage());
    view.setViewport(1440);
    const before = view.noteWidthMax;
    view.setSidebarWidth(SIDEBAR_WIDTH.max);
    expect(view.noteWidthMax).toBe(before - (SIDEBAR_WIDTH.max - SIDEBAR_WIDTH.default));
  });

  // The stored number is the monitor's; the laptop is only drawn narrower.
  it('narrows a width to a smaller window and gives it back to the bigger one', () => {
    const storage = fakeStorage();
    const view = new ViewState(storage);
    view.setViewport(2560);
    view.setNotePaneWidth(1500);
    view.setViewport(1280);
    expect(view.notePaneWidth).toBe(view.noteWidthMax);
    view.setViewport(2560);
    expect(view.notePaneWidth).toBe(1500);
  });
});
