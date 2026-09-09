import { beforeEach, describe, expect, it } from 'vitest';
import { memoryFolder } from '../adapters/memory-folder';
import { createFirstChild, createLastChild, createSiblingBelow } from '../core/edit';
import { childrenOf } from '../core/tree';
import { AGENDA, ROOT, TIMELY } from '../core/types';
import { Session } from '../app/Session.svelte';
import { ViewState } from '../app/view-state.svelte';
import { actionNamed, rowActions, type RowActionContext } from './actions';
import { RowFocus } from './focus.svelte';
import { KEY_BOUND_ACTIONS } from './keyboard';
import { visibleRows } from './rows';

/** localStorage does not exist in a Node test, and view state needs one. */
function fakeStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => void entries.delete(key),
    setItem: (key, value) => void entries.set(key, value),
  };
}

let session: Session;
let view: ViewState;
let focus: RowFocus;

function context(id: string, parent: string = ROOT): RowActionContext {
  const rows = visibleRows(session.tree, parent, (rowId) => view.isCollapsed(rowId));
  // G-6 and R-4. The day the list is being read on, which the view hands down —
  // these tests file rows relative to the same clock, so they agree by
  // construction rather than by a frozen date.
  return { session, view, focus, rows, id, now: Date.now() };
}

/** G-5. One agenda item, filed for the day the caller names. */
function fileFor(day: string): string {
  return session.run((tree, ctx) => createLastChild(tree, ctx, AGENDA, { title: 'Parcel', day }))[0]!
    .id;
}

function dayFrom(offset: number): string {
  const at = new Date();
  at.setDate(at.getDate() + offset);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

/** Appends a row and answers its id — the rows themselves do not matter here. */
function add(parent: string): string {
  const children = childrenOf(session.tree, parent);
  return session.run((tree, ctx) =>
    children.length === 0
      ? createFirstChild(tree, ctx, parent)
      : createSiblingBelow(tree, ctx, children[children.length - 1]!),
  )[0]!.id;
}

beforeEach(async () => {
  session = await Session.open(memoryFolder(), 'aaaa0001');
  view = new ViewState(fakeStorage());
  focus = new RowFocus();
});

describe('the row menu and the keyboard', () => {
  it('offer exactly the same actions — requirements.md §3.1', () => {
    const id = add(ROOT);
    const names = rowActions(context(id)).map((action) => action.name);
    for (const bound of KEY_BOUND_ACTIONS) {
      expect(names, `${bound} is bound to a key but missing from the menu`).toContain(bound);
    }
  });

  it('name their keys, so the menu is where the keyboard is taught', async () => {
    const id = add(ROOT);
    const actions = rowActions(context(id));
    for (const bound of KEY_BOUND_ACTIONS) {
      expect(actionNamed(actions, bound)?.keys, `${bound} has no key shown`).toBeTruthy();
    }
  });

  it('offers a conversion to every kind but the row’s own — K-5', async () => {
    const id = add(ROOT);
    const names = rowActions(context(id)).map((action) => action.name);
    expect(names).toContain('turn-into-note');
    expect(names).toContain('turn-into-folder');
    expect(names).not.toContain('turn-into-task');
  });

  it('disables what the tree refuses, rather than hiding it', async () => {
    const first = add(ROOT);
    const second = add(ROOT);
    const actions = rowActions(context(first));
    expect(actionNamed(actions, 'indent')?.enabled).toBe(false);
    expect(actionNamed(actions, 'move-up')?.enabled).toBe(false);
    expect(actionNamed(rowActions(context(second)), 'indent')?.enabled).toBe(true);
  });

  it('runs the same edit the keyboard would', async () => {
    const first = add(ROOT);
    const second = add(ROOT);
    actionNamed(rowActions(context(second)), 'indent')!.run();
    expect(childrenOf(session.tree, first)).toEqual([second]);
  });

  it('puts the caret on the row it just created', async () => {
    const id = add(ROOT);
    actionNamed(rowActions(context(id)), 'new-below')!.run();
    expect(focus.id).not.toBe(id);
    expect(focus.id).not.toBeNull();
  });
});

describe('visibleRows', () => {
  it('skips what is collapsed, because the caret can only go where the eye can', async () => {
    const parent = add(ROOT);
    const child = session.run((tree, ctx) => createFirstChild(tree, ctx, parent))[0]!.id;
    const isCollapsed = (id: string): boolean => view.isCollapsed(id);
    expect(visibleRows(session.tree, ROOT, isCollapsed)).toEqual([
      { id: parent, depth: 0 },
      { id: child, depth: 1 },
    ]);
    view.toggleCollapsed(parent);
    expect(visibleRows(session.tree, ROOT, isCollapsed)).toEqual([{ id: parent, depth: 0 }]);
  });
});

describe('the day move — G-6', () => {
  it('offers the other list, and only the other list', () => {
    const inToday = fileFor(dayFrom(0));
    const names = rowActions(context(inToday, AGENDA)).map((action) => action.name);
    expect(names).toContain('move-to-tomorrow');
    expect(names).not.toContain('move-to-today');
  });

  it('turns around once the item is filed for a later day', () => {
    const inTomorrow = fileFor(dayFrom(1));
    const names = rowActions(context(inTomorrow, AGENDA)).map((action) => action.name);
    expect(names).toContain('move-to-today');
    expect(names).not.toContain('move-to-tomorrow');
  });

  it('is not offered at all in the tree, which has no day and no other list', () => {
    const id = add(ROOT);
    const names = rowActions(context(id)).map((action) => action.name);
    expect(names).not.toContain('move-to-today');
    expect(names).not.toContain('move-to-tomorrow');
  });

  it('runs as one `set day`, and the item stays where it is', () => {
    const id = fileFor(dayFrom(1));
    actionNamed(rowActions(context(id, AGENDA)), 'move-to-today')!.run();
    expect(session.tree.nodes[id]!.day).toBe(dayFrom(0));
    expect(session.tree.nodes[id]!.parent).toBe(AGENDA);
    expect(rowActions(context(id, AGENDA)).map((a) => a.name)).toContain('move-to-tomorrow');
  });
});

describe('a timely row — R-1, R-7', () => {
  function chore(every: string): string {
    return session.run((tree, ctx) =>
      createLastChild(tree, ctx, TIMELY, { title: 'Plants', every }),
    )[0]!.id;
  }

  it('offers the repeat editor, and says what it repeats at — R-7', () => {
    const id = chore('5d');
    const entry = actionNamed(rowActions(context(id, TIMELY)), 'repeat')!;
    expect(entry.label).toBe('Repeats every 5 days');
    // Disabled without an editor to open, exactly as the tag entry is.
    expect(entry.enabled).toBe(false);

    let opened = false;
    const withEditor = { ...context(id, TIMELY), editRepeat: () => (opened = true) };
    actionNamed(rowActions(withEditor), 'repeat')!.run();
    expect(opened).toBe(true);
  });

  it('offers no kind change and no indent — R-1', () => {
    const first = chore('1d');
    const second = chore('7d');
    const actions = rowActions(context(second, TIMELY));
    expect(actions.filter((action) => action.name.startsWith('turn-into-'))).toEqual([]);
    expect(actionNamed(actions, 'indent')!.enabled).toBe(false);
    // The order of the list is still dragged and nudged.
    expect(actionNamed(actions, 'move-up')!.enabled).toBe(true);
    expect(first).not.toBe(second);
  });

  it('offers no day move: a chore is in no list that a day names — G-6', () => {
    const id = chore('1d');
    const actions = rowActions(context(id, TIMELY));
    expect(actionNamed(actions, 'move-to-tomorrow')).toBeUndefined();
    expect(actionNamed(actions, 'move-to-today')).toBeUndefined();
  });

  it('leaves the rows of every other list without a repeat entry', () => {
    const id = add(ROOT);
    expect(actionNamed(rowActions(context(id)), 'repeat')).toBeUndefined();
  });
});
