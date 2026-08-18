import { beforeEach, describe, expect, it } from 'vitest';
import { memoryFolder } from '../adapters/memory-folder';
import { createFirstChild, createSiblingBelow } from '../core/edit';
import { childrenOf } from '../core/tree';
import { ROOT } from '../core/types';
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

function context(id: string): RowActionContext {
  const rows = visibleRows(session.tree, ROOT, (rowId) => view.isCollapsed(rowId));
  return { session, view, focus, rows, id };
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
    expect(names).toContain('turn-into-list');
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
