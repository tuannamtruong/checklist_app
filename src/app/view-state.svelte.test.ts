import { describe, expect, it } from 'vitest';
import { SIDEBAR_WIDTH, ViewState } from './view-state.svelte';

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
