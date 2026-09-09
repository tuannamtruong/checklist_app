// Every action a row offers, defined once.
//
// `keyboard.ts` and `RowMenu` both read it, so a key and a menu entry run the
// same code by construction rather than by promise, and `actions.test.ts`
// fails if a key ever binds something this file does not define.
//
// X-34: the two lists are no longer the *same* list. Every keyboard action is
// still defined here, but `menu` says which of them the `⋮` menu draws, and the
// four that only reorder the tree — indent, outdent, and the two nudges — say
// no. A phone reorders by dragging (T-14, T-16), which is the gesture those
// keys stand in for on a desktop, so the menu was offering a second, worse way
// to do a thing the finger already does — requirements.md §3.1.

import * as edit from '../core/edit';
import { dayKey, nextDayKey } from '../core/agenda';
import { childrenOf, parentOf, rootOf } from '../core/tree';
import { periodOf, periodLabel } from '../core/timely';
import { AGENDA, KINDS, TIMELY, type Kind, type NodeId } from '../core/types';
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
  /**
   * G-6 and R-4. The day this list is being read on, handed in rather than read
   * here: which day move an agenda item offers depends on it, and so does what
   * a timely row's tick means. `core/` may not read a clock and this layer may,
   * but a page that turns over at midnight has to turn its rows over with it.
   */
  now: number;
  /**
   * A-1. Opens the row's own tag editor, which only the row can do — it is a
   * field on screen rather than an edit. A caller with no editor (the tests,
   * and any future list of rows that is not the tree) leaves it out, and the
   * menu shows the entry disabled rather than lying about where tags live.
   */
  editTags?: () => void;
  /**
   * R-7. Opens the row's own repeat editor, and absent for the same reason
   * `editTags` can be: it is a field on screen rather than an edit, so a caller
   * with no editor shows the entry disabled rather than lying about where the
   * period lives.
   */
  editRepeat?: () => void;
}

export interface RowAction {
  /** Stable name, used by the keyboard map and by the tests. */
  name: string;
  label: string;
  /**
   * X-34. Whether the `⋮` menu draws it. False for the four that only reorder
   * the tree: a finger reorders by dragging, and the menu is what a finger
   * reaches — an entry there that duplicates a drag is a worse drag.
   */
  menu: boolean;
  enabled: boolean;
  danger?: boolean;
  run(): void;
}

const KIND_LABELS: Record<Kind, string> = {
  folder: 'Folder',
  note: 'Note',
  task: 'Task',
};

export function rowActions(ctx: RowActionContext): RowAction[] {
  const { session, view, focus, rows, id, now } = ctx;
  const tree = session.tree;
  const node = tree.nodes[id];
  if (!node) return [];

  const focusNew = (ops: readonly { id: NodeId }[]): void => {
    const created = ops[0];
    if (created) focus.request(created.id);
  };

  /**
   * G-6. An agenda item's one extra control: the other list. Which entry it is
   * follows from the day the item carries, so a row offers one move rather than
   * two, and a row in the tree offers neither — it has no day and no list to be
   * moved to. The clock is read here rather than in `core/`, where nothing may
   * read one.
   */
  const root = rootOf(tree, id);
  const inAgenda = root === AGENDA;
  const inTimely = root === TIMELY;
  const today = dayKey(now);
  const filedForToday = node.day === null || node.day <= today;
  const dayMove: RowAction[] = !inAgenda
    ? []
    : [
        {
          name: filedForToday ? 'move-to-tomorrow' : 'move-to-today',
          label: filedForToday ? 'Move to Tomorrow' : 'Move to Today',
          menu: true,
          enabled: true,
          run: () => {
            const at = Date.now();
            const day = filedForToday ? nextDayKey(at) : dayKey(at);
            session.run((t, c) => edit.setDay(t, c, id, day));
          },
        },
      ];

  /**
   * R-7. A timely row's one extra control, and the row menu's copy of the chip:
   * a phone reaches the menu, and §3.1 asks that everything a row can do be in
   * it. The label says the period, so the menu also says what the row repeats
   * at without opening anything.
   */
  const repeat: RowAction[] = !inTimely
    ? []
    : [
        {
          name: 'repeat',
          label: `Repeats ${periodLabel(periodOf(node))}`,
          menu: true,
          enabled: ctx.editRepeat !== undefined,
          run: () => ctx.editRepeat?.(),
        },
      ];

  return [
    {
      name: 'new-below',
      label: 'New row below',
      menu: true,
      enabled: true,
      run: () => focusNew(session.run((t, c) => edit.createSiblingBelow(t, c, id))),
    },
    {
      name: 'new-inside',
      label: 'New row inside',
      menu: true,
      enabled: true,
      run: () => {
        view.expand(id);
        focusNew(session.run((t, c) => edit.createFirstChild(t, c, id)));
      },
    },
    {
      // The four below are the keyboard's alone — X-34. They stay defined here
      // because `keyboard.ts` resolves a key through this list, and they are
      // the reason `menu` exists at all.
      name: 'indent',
      label: 'Indent',
      menu: false,
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
      menu: false,
      enabled: edit.canOutdent(tree, id),
      run: () => {
        session.run((t, c) => edit.outdent(t, c, id));
        focus.request(id);
      },
    },
    {
      name: 'move-up',
      label: 'Move up',
      menu: false,
      enabled: edit.canMoveUp(tree, id),
      run: () => {
        session.run((t, c) => edit.moveUp(t, c, id));
        focus.request(id);
      },
    },
    {
      name: 'move-down',
      label: 'Move down',
      menu: false,
      enabled: edit.canMoveDown(tree, id),
      run: () => {
        session.run((t, c) => edit.moveDown(t, c, id));
        focus.request(id);
      },
    },
    ...dayMove,
    ...repeat,
    {
      name: 'tags',
      label: node.tags.length === 0 ? 'Add tags' : `Tags (${node.tags.length})`,
      menu: true,
      enabled: ctx.editTags !== undefined,
      run: () => ctx.editTags?.(),
    },
    // R-1. Timely holds check items and nothing else, so there is nothing to
    // turn a row in it into: a folder among the chores is a list that never
    // comes back, and a note there has no tick to give.
    ...(inTimely ? [] : KINDS.filter((kind) => kind !== node.kind)).map((kind) => ({
      name: `turn-into-${kind}`,
      label: `Turn into ${KIND_LABELS[kind].toLowerCase()}`,
      menu: true,
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
      menu: true,
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

/** X-34. What the `⋮` menu draws: the edits, and never the four reorderings. */
export function menuActions(ctx: RowActionContext): RowAction[] {
  return rowActions(ctx).filter((action) => action.menu);
}
