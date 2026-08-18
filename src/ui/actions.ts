// Every action a row offers, defined once.
//
// requirements.md §3.1 asks that every keyboard action also exist in the row
// menu, because a phone has no Tab key. Defining the two from one list is what
// makes that structural rather than a promise: `keyboard.ts` and `RowMenu`
// both read this file, and `actions.test.ts` fails if a key ever binds
// something the menu does not show.

import * as edit from '../core/edit';
import { childrenOf, parentOf } from '../core/tree';
import { KINDS, type Kind, type NodeId } from '../core/types';
import type { Session } from '../app/Session.svelte';
import type { ViewState } from '../app/view-state.svelte';
import type { RowFocus } from './focus.svelte';
import { rowAbove, type VisibleRow } from './rows';

export interface RowActionContext {
  session: Session;
  view: ViewState;
  focus: RowFocus;
  rows: readonly VisibleRow[];
  id: NodeId;
}

export interface RowAction {
  /** Stable name, used by the keyboard map and by the tests. */
  name: string;
  label: string;
  /** What §3.1 calls this action, shown in the menu so the menu teaches it. */
  keys: string | null;
  enabled: boolean;
  danger?: boolean;
  run(): void;
}

const KIND_LABELS: Record<Kind, string> = {
  folder: 'Folder',
  list: 'List',
  note: 'Note',
  task: 'Task',
};

export function kindLabel(kind: Kind): string {
  return KIND_LABELS[kind];
}

export function rowActions(ctx: RowActionContext): RowAction[] {
  const { session, view, focus, rows, id } = ctx;
  const tree = session.tree;
  const node = tree.nodes[id];
  if (!node) return [];

  const focusNew = (ops: readonly { id: NodeId }[]): void => {
    const created = ops[0];
    if (created) focus.request(created.id);
  };

  return [
    {
      name: 'new-below',
      label: 'New row below',
      keys: 'Enter',
      enabled: true,
      run: () => focusNew(session.run((t, c) => edit.createSiblingBelow(t, c, id))),
    },
    {
      name: 'new-inside',
      label: 'New row inside',
      keys: 'Enter on an open parent',
      enabled: true,
      run: () => {
        view.expand(id);
        focusNew(session.run((t, c) => edit.createFirstChild(t, c, id)));
      },
    },
    {
      name: 'indent',
      label: 'Indent',
      keys: 'Tab',
      enabled: edit.canIndent(tree, id),
      run: () => {
        session.run((t, c) => edit.indent(t, c, id));
        view.expand(parentOf(session.tree, id));
        focus.request(id);
      },
    },
    {
      name: 'outdent',
      label: 'Outdent',
      keys: 'Shift-Tab',
      enabled: edit.canOutdent(tree, id),
      run: () => {
        session.run((t, c) => edit.outdent(t, c, id));
        focus.request(id);
      },
    },
    {
      name: 'move-up',
      label: 'Move up',
      keys: 'Alt-↑',
      enabled: edit.canMoveUp(tree, id),
      run: () => {
        session.run((t, c) => edit.moveUp(t, c, id));
        focus.request(id);
      },
    },
    {
      name: 'move-down',
      label: 'Move down',
      keys: 'Alt-↓',
      enabled: edit.canMoveDown(tree, id),
      run: () => {
        session.run((t, c) => edit.moveDown(t, c, id));
        focus.request(id);
      },
    },
    ...KINDS.filter((kind) => kind !== node.kind).map((kind) => ({
      name: `turn-into-${kind}`,
      label: `Turn into ${KIND_LABELS[kind].toLowerCase()}`,
      keys: null,
      enabled: true,
      run: () => {
        session.run((t, c) => edit.turnInto(t, c, id, kind));
      },
    })),
    {
      name: 'delete',
      label: childrenOf(tree, id).length > 0 ? 'Delete, with everything inside' : 'Delete',
      // The keyboard's version refuses a row with children; the menu's does not,
      // because a subtree delete from a menu is deliberate — T-7.
      keys: 'Backspace on an empty row',
      enabled: true,
      danger: true,
      run: () => {
        const above = rowAbove(rows, id);
        session.run((t, c) => edit.remove(t, c, id));
        if (above) focus.request(above);
      },
    },
  ];
}

export function actionNamed(actions: readonly RowAction[], name: string): RowAction | undefined {
  return actions.find((action) => action.name === name);
}

/** The keys §3.1 gives to navigation rather than to an edit. */
export const CARET_KEYS: readonly { keys: string; label: string }[] = [
  { keys: '↑ / ↓', label: 'Move the caret between rows' },
  { keys: 'Escape', label: 'Discard this title edit' },
];
