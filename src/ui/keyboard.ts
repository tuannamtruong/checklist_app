// The desktop keyboard model — requirements.md §3.1.
//
// Every key here resolves to an action from `actions.ts`, which is where the
// edit itself lives; two of them — the caret keys — resolve to no action at
// all, because moving the caret is not an edit and a phone gets it for free by
// tapping a row.
//
// X-33: this file is also where the keys are *written down for a person*.
// `KEY_HELP` is the one list, rendered on the settings screen, and
// `keyboard.test.ts` holds it to the bindings below — a key taught nowhere and
// a key bound nowhere both fail there.

import { childrenOf } from '../core/tree';
import { canBackspaceDelete } from '../core/edit';
import { actionNamed, rowActions, type RowActionContext } from './actions';
import { rowAbove, rowBelow } from './rows';

export interface KeyContext extends RowActionContext {
  /** The title as currently typed, which is not yet the node's title. */
  draft: string;
  /** Puts the row's own input back to the stored title — Escape. */
  discardDraft(): void;
}

/** The action names the keyboard binds. `actions.test.ts` holds the menu to it. */
export const KEY_BOUND_ACTIONS = [
  'new-below',
  'new-inside',
  'indent',
  'outdent',
  'move-up',
  'move-down',
  'delete',
] as const;

/**
 * X-33. Every key this file binds, in the words the settings screen shows —
 * requirements.md §3.1. `action` names the `actions.ts` entry the key resolves
 * to, where it resolves to one: `keyboard.test.ts` reads it to check that the
 * two lists say the same thing.
 */
export interface KeyHelp {
  keys: string;
  label: string;
  action?: (typeof KEY_BOUND_ACTIONS)[number];
}

export const KEY_HELP: readonly KeyHelp[] = [
  { keys: 'Enter', label: 'New row below', action: 'new-below' },
  { keys: 'Enter on an open parent', label: 'New row inside it', action: 'new-inside' },
  { keys: 'Tab', label: 'Indent, under the row above', action: 'indent' },
  { keys: 'Shift-Tab', label: 'Outdent, out to the grandparent', action: 'outdent' },
  { keys: 'Alt-↑', label: 'Move up among the siblings', action: 'move-up' },
  { keys: 'Alt-↓', label: 'Move down among the siblings', action: 'move-down' },
  {
    keys: 'Backspace on an empty row',
    label: 'Delete it — refused if it has children',
    action: 'delete',
  },
  { keys: 'Escape', label: 'Discard this title edit' },
  // F-5, and the one key that is not a row action at all: it acts on the
  // application, which is why `App.svelte` binds it rather than this file.
  { keys: '/', label: 'Open search' },
];

function run(ctx: RowActionContext, name: string): boolean {
  const action = actionNamed(rowActions(ctx), name);
  if (!action?.enabled) return false;
  action.run();
  return true;
}

/** True when the key was the app's; false leaves it to the browser. */
export function handleRowKey(event: KeyboardEvent, ctx: KeyContext): boolean {
  const { session, view, focus, rows, id } = ctx;

  if (event.key === 'Escape') {
    ctx.discardDraft();
    return true;
  }

  if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey) {
    // A row the user has opened up is a row they are filling, so Enter goes
    // inside it rather than past it.
    const expandedParent = childrenOf(session.tree, id).length > 0 && !view.isCollapsed(id);
    run(ctx, expandedParent ? 'new-inside' : 'new-below');
    return true;
  }

  if (event.key === 'Tab') {
    run(ctx, event.shiftKey ? 'outdent' : 'indent');
    // Swallowed either way: a refused indent must not hand focus to the browser's
    // next control, which on a phone-sized layout is somewhere else entirely.
    return true;
  }

  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    run(ctx, event.key === 'ArrowUp' ? 'move-up' : 'move-down');
    return true;
  }

  if (!event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    const target = event.key === 'ArrowUp' ? rowAbove(rows, id) : rowBelow(rows, id);
    if (target === null) return false;
    focus.request(target);
    return true;
  }

  if (event.key === 'Backspace') {
    // Only an empty row, and never one with children — §3.1. Anything else is
    // an ordinary backspace inside the text.
    if (!canBackspaceDelete(session.tree, id, ctx.draft)) return false;
    return run(ctx, 'delete');
  }

  return false;
}
