# Requirements

Requirement docs and its current state.

**Milestones M1 to M7 are built** — the production tree is `src/`, and every ✅ row below names the file that implements
it.

Two commands verify the ✅ rows:

```bash
npm test          # the logic layer and the merge, in Node
npm run ui-smoke  # the built app in Chromium: the keyboard model, a peer device arriving, a reload, a cold start offline
```

Legend:

| Mark | Meaning |
| --- | --- |
| ✅ | done |
| ◐ | partial |
| ✗ | not built |
| ✗ **Withdrawn** | built once and taken out again. The row stays, so the ID is never reused and the reason outlives the code |
| ✗ **Proposed** | designed and written down, not built. The row names the file that will implement it, so the design is reviewable before any code exists |

Sections marked _Not written yet._ are placeholders: the heading records that the topic is owed, and the content is
still to be decided.

---

## 1. Summary against the stated requirements

| # | Stated requirement | State | Note |
| --- | --- | --- | --- |
| 1 | Folder structure: a tree | ✅ | `src/core/tree.ts`, `src/ui/TreeView.svelte` |
| 2 | Sync between PCs and phones via a cloud file service | ◐ | Built and tested against a folder — `src/app/folder-sync.ts`, `src/core/merge.ts`. What is untested is a real provider's client under it, which needs the Windows and Android builds — [§7.3 Fixed constraints](#73-fixed-constraints) |
| 3 | Lists and sub-lists | ✅ | Nesting is the tree; indent/outdent, drag-free reorder — `src/core/edit.ts` |
| 4 | Either a checklist or a text note | ✅ | `src/ui/NodePage.svelte`, `src/ui/NoteBody.svelte` |

## 2. Data model

A node is a record in the store and a fold of ops on disk. The folder holds ops; the store holds the materialised tree
and never replays per read — [sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision).

### 2.1 The node

| Field | Type | Settles |
| --- | --- | --- |
| `id` | string | Minted by the creating device, never reused |
| `parent` | node id, `root`, `agenda` or `timely` | Always read through the cycle-repair resolver, never directly — T-6. `agenda` and `timely` are the second and third roots, and the only thing that separates G-1's two lists and R-1's third from the tree |
| `parentSetAt` | timestamp | When the move was written. The repair reads it; nothing reads the local clock |
| `parentSetBy` | device id | The device that wrote the move, and the repair's tiebreak when two `parentSetAt` collide — [sync-flow.md §6.2 The repair](sync-flow.md#62-the-repair) |
| `kind` | one of `folder`, `note`, `task` | K-1. Mutable after the fact — K-5. A `list` in an older file decodes as `folder` |
| `title` | string | The row label, every kind |
| `done` | boolean | Tasks only — K-2. Also the T-11 filter: a row carrying it leaves the normal view |
| `doneAt` | timestamp or null | The `at` of the write that set `done`, as `deletedAt` is the tombstone's. T-12 orders the archive by it |
| `body` | string or null | Notes only — K-3 |
| `tags` | string set | A-1. Normalised, sorted and deduplicated by `src/core/tags.ts`; merges as one field |
| `priority` | one of `none`, `low`, `medium`, `high` | A-2. `none` is a value, not an absent field |
| `order` | base-62 string | Fractional index among siblings — T-2 |
| `orderBy` | device id | The device that minted `order`, and the sort tiebreak |
| `deleted` | boolean | T-7. Absence and deletion must stay distinguishable |
| `day` | `YYYY-MM-DD` or null | G-2. The day an agenda item is filed for and the day a timely item is next due, and null on every row in the tree. It is what makes G-3's rollover and R-4's countdown reads rather than writes |
| `every` | `<n>d`, `<n>m` or null | R-2. How often a timely item repeats, and null everywhere else. `src/core/timely.ts` is the only module that spells the shape |
| `deletedAt` | timestamp or null | |

Children sort on `(order, orderBy, id)`. Kind constrains rendering, not structure: any kind may own children, which is
what T-1 and K-4 require together.

### 2.2 The op

One JSON object per line in `checklist.<device-id>.ops.jsonl`, after a header line carrying the full version vector. An
op carries its own counter (`c`), the wall clock at which it was written (`at`), and a receipt for a peer only when that
receipt changes. The encoding and an example are in
[sync-flow.md §4.2 B — Append-only op log per device](sync-flow.md#42-b--append-only-op-log-per-device).

| Op | Carries |
| --- | --- |
| `create` | `id`, `parent`, `kind`, `order` |
| `set` | `id` plus the fields that changed — `title`, `done`, `body`, `kind`, `tags`, `priority`, `day`, `every` |
| `move` | `id`, `parent`, `order`; `at` becomes the node's `parentSetAt` |
| `delete` | `id`; tombstones the subtree at read time, per T-7 |
| `restore` | `id`; clears that node's own tombstone — T-13 |

Concurrent writes to one field resolve by `(at, device id)` — newest wins, disjoint fields never interact, and the user
is told rather than asked. `parentSetAt` is that rule's timestamp for `parent`, not a special mechanism.

`delete` and `restore` are the two writers of one field, `deleted`, and they settle against each other by that same rule
rather than by a precedence between the ops. That is what T-13 cost the payload, and it is the whole of it —
[sync-flow.md §4.9 The restore op](sync-flow.md#49-the-restore-op).

A device may drop its **own** op once a later op of its own overwrites the same field, because the fold's total order
makes the earlier one unreachable under every interleaving. That is compaction, it needs no agreement with anyone, and
the rule is [sync-flow.md §4.8 The compaction cut](sync-flow.md#48-the-compaction-cut).

### 2.3 What is never in the Sync Folder

Device-local state, held in `localStorage` and never written to a shared file: the device id, collapse/expand state
(T-8), which sidebar rows are open (T-17), the sync cadence (S-19), which folder this device reaches the tree through
([architecture.md §4 The folder adapter](architecture.md#4-the-folder-adapter)), dismissed conflict notices (C-6), the
chosen theme (X-14) and the two colours picked over it (X-35), how large the sidebar's type is (X-25), how wide the
sidebar and the note pane have been dragged (X-20, X-24), and any filter the Done view grows (T-12). Anything the user
would not want to converge across devices belongs here rather than in the tree.

The **search index** is not state at all, in the same sense the Done view is not: F-4 scans the materialised tree on
each keystroke, so there is nothing to store, nothing to invalidate and nothing to sync.

A device's **name** (D-1) is the one thing that both syncs and is not in the tree. It travels in the header line of the
device's own file, so the device that owns the id is the only writer of the name — one writer per file, unchanged, and
therefore no merge rule for names at all. `lastSeen` (D-2) rides the same line.

The folder handle itself is the one piece that cannot live in `localStorage` — a File System Access handle is an object
rather than a string — so it sits in IndexedDB, which changes where it is stored and nothing about the rule.

The Done view itself is not state. It is a read-time filter over `done` and the T-7 tombstone, ordered by the two
timestamps the fold already carries — derived, so it needs no sync and no writes.

## 3. Tree structure and editing

| ID | Requirement | State | Where / test |
| --- | --- | --- | --- |
| T-1 | Unlimited nesting of lists inside lists inside folders | ✅ | `src/core/tree.ts`; `tree.test.ts` |
| T-2 | Children render in a stable order every device agrees on | ✅ | `src/core/order.ts`, sorted on `(order, orderBy, id)` — [sync-flow.md §5 Sibling ordering](sync-flow.md#5-sibling-ordering); `order.test.ts` |
| T-3 | Indent (become child of sibling above) / outdent (become parent's next sibling) | ✅ | `src/core/edit.ts` `indent`/`outdent`; `edit.test.ts`, `scripts/ui-smoke.mjs` |
| T-4 | Move up/down among siblings | ✅ | `src/core/edit.ts` `moveUp`/`moveDown`; `edit.test.ts` |
| T-5 | A move that would create a loop is refused | ✅ | `src/core/edit.ts` `canMoveTo`; `edit.test.ts`. M5's drag (T-14) is the UI that can finally express one, and a drop it refuses is shown as refused rather than silently dropped. Local check only — it catches one device dragging a folder into its own child, never the merge case, which is T-6: [sync-flow.md §6.1 T-5 is not the loop defence](sync-flow.md#61-t-5-is-not-the-loop-defence) |
| T-6 | A Cyclic tree state (concurrent A→B, B→A) is repaired at _read_ time by re-rooting, never by writing | ✅ | Drop the cycle edge with the oldest `(parentSetAt, device id)` — [sync-flow.md §6.2 The repair](sync-flow.md#62-the-repair) — `src/core/tree.ts` `resolveTree`; `tree.test.ts`, and `merge.test.ts` builds the cycle the way it actually happens — two devices, two concurrent moves, folded from two files. The repair names the node it re-rooted, which is C-2 |
| T-7 | Deleting a node tombstones its whole subtree, not just the node | ✅ | The ancestor walk must climb the T-6-resolved parent, or a tombstoned subtree containing a cycle hangs — [sync-flow.md §6.2 The repair](sync-flow.md#62-the-repair) — `src/core/tree.ts`; `tree.test.ts` covers the tombstoned subtree that contains a cycle |
| T-8 | Collapse/expand state is per-device and never synced | ✅ | `src/app/view-state.svelte.ts` — `localStorage`, never a file |
| T-9 | Breadcrumbs show the path back up from any node | ✅ | `src/ui/Breadcrumbs.svelte`, over `ancestorsOf` |
| T-10 | Sidebar shows the **top-level** `folder` and `note` rows, and under each of them its immediate `folder` and `note` children — two levels, and nothing deeper | ✅ | `sidebarChildren` in `src/core/tree.ts` over `SIDEBAR_KINDS` in `src/core/types.ts`, read by `src/ui/SidebarLinks.svelte`, which draws the two levels and does not recurse. A task would drown the two kinds that are navigation, at either level. `tree.test.ts`, `scripts/ui-smoke.mjs` |
| T-11 | A ticked row is not in the normal view at all — not in its list, not in the sidebar, not in the caret order, and neither is anything it holds | ✅ | The filter is `resolveTree`'s, beside T-7's: `src/core/tree.ts` drops an own-`done` node from `children`, and one filtered set answers all three. The subtree goes with it because nothing walks *into* a row that is not there — but the flag itself is **not** inherited, so a finished row's own page still shows what is inside it, which is what makes T-12's rows worth opening. `tree.test.ts`, `scripts/ui-smoke.mjs` |
| T-12 | One Done view lists every row the tree no longer shows — ticked or deleted, one list, newest first, each with the path it sat on | ✅ | `archivedRows` in `src/core/done.ts`; `src/ui/DonePage.svelte` at `#/done`. **No distinction between the two:** a tick and a delete are the same answer to "where did that go?", and two lists made the reader settle which kind of gone a row had been before they could start looking. The order is `deletedAt` or `doneAt`, newest first, because the row being looked for is nearly always the last one to go — tree order is the wrong order for a list nobody browses. One entry per run, never the descendants, and one control on it: `unarchive` in `src/core/edit.ts` clears the tombstone, the tick, or both. `done.test.ts`, `edit.test.ts`, `scripts/ui-smoke.mjs` |
| T-13 | A deleted row can be restored from the Done view | ✅ | The `restore` op of [§2.2 The op](#22-the-op), added in M3: `src/core/edit.ts` `restore`, offered by `src/ui/DonePage.svelte`. It clears the row's **own** tombstone and nothing else, so a row still under a deleted ancestor stays gone — which is why the Done view lists only the top of a deleted run, and restoring that one brings the whole subtree back with it. It is one of the two ops `unarchive` writes, and the archive's single Restore control is where T-12 offers it. `done.test.ts`, `edit.test.ts`, `scripts/ui-smoke.mjs` |
| T-14 | A row is dragged to another place in the tree: above a row, below it, or into it | ✅ | `dropOnto` in `src/core/edit.ts`, one `move` op like every other; `src/ui/drag.svelte.ts` drives it over **pointer** events rather than HTML5 drag-and-drop, so a thumb and a mouse take one code path. `edit.test.ts`, `scripts/ui-smoke.mjs` |
| T-15 | The grip sits in one column at the left edge of every row, whatever the row's depth | ✅ | `src/ui/Row.svelte` puts the depth indent on the row's contents rather than on the row itself, so every grip is at the same x and the indent still draws the nesting. `scripts/ui-smoke.mjs` |
| T-16 | On a touch screen there is no grip at all: a finger held on the row picks it up | ✅ | `src/ui/drag.svelte.ts` arms the hold on `pointerdown` and fires it after 400 ms of stillness, `src/ui/Row.svelte` captures the pointer there, and the coarse-pointer rule in `src/app.css` takes the grip off the row. `drag.svelte.test.ts`, `scripts/ui-smoke.mjs` |
| T-17 | A top-level sidebar row with children of those kinds carries a disclosure, and the second level starts **closed**; which rows are open is this device's own and never syncs | ✅ | `sidebarOpen` in `src/app/view-state.svelte.ts` — `localStorage`, never a file, and it holds the *open* ids so a fresh device and an empty set are the same state. Separate from T-8's collapse set on purpose: the nav and the page are two drawings, and opening a folder to navigate to it says nothing about how the page under it is read. `view-state.svelte.test.ts`, `scripts/ui-smoke.mjs` |
| T-18 | Every sidebar entry carries the same `⋮` menu the tree's rows do, on its right | ✅ | `src/ui/RowMenu.svelte` in `src/ui/SidebarLinks.svelte`, over the same `src/ui/actions.ts` list — so what it offers here is whatever it offers anywhere and nothing new can drift into it. The two editors a nav entry has nowhere to draw (tags, R-7's period) show disabled, which is the rule `RowActionContext` already had for a caller without them. `scripts/ui-smoke.mjs` |

[sync-flow.md §3 Why a snapshot does not scale to a tree](sync-flow.md#3-why-a-snapshot-does-not-scale-to-a-tree) is why
T-2, T-5, T-6 and T-7 constrain the sync payload, not just the UI.

**Dragging is pointer events, not HTML5 drag-and-drop, and that is a requirement rather than a preference.** The
`dragstart` family does not fire on touch at all, so an HTML5 implementation would be a desktop-only feature wearing the
same icon on a phone — and every other edit in this application reaches a phone. One `pointerdown` on the row's grip,
`setPointerCapture`, and the row under the pointer is found by hit-testing; the same three lines serve both.

**A drop lands in one of three places, and which one is a question about the pointer's height in the target row**: the
top quarter is above it, the bottom quarter is below it, and the middle is inside it. Inside is what makes drag able to
express T-5's refusal — it is the one gesture that can ask for a row to become its own descendant — so a refused target
is drawn as refused and the drop writes nothing.

**A phone has no grip, and a finger held on the row is the gesture instead — T-16.** A grip drawn large enough for a
thumb is a column of dots down every row, and it spends the width a title needs on a control that is a second way to do
the one thing a hold already means on a phone. So a coarse pointer gets no grip and the row itself is what is picked up,
after 400 ms of stillness and no more than 8 px of travel — long enough that a tap and a scroll are not drags, short
enough to beat the browser's own long press. A mouse never takes this path: the pointer type is on the event, and a
desktop has the grip right there under the pointer.

**What the browser would otherwise do with that hold has to be taken back, and none of it can be said in CSS.**
`touch-action` is read when the finger goes down, and at that moment the gesture was still a tap, so the drag prevents
the events instead as they arrive: the `touchmove` that would scroll the page under the row — cancellable right up until
scrolling actually starts, and by definition nothing has moved yet — the `contextmenu` and the text selection the
browser's own long press raises at about half a second, and the click the finger delivers on the way up, which would
otherwise put the caret in whatever title the row was dropped on and raise the keyboard.

**The grip is not indented and the rest of the row is — T-15.** The indent used to sit on the row itself, so the grip
moved right with everything else and a column of grips down a nested list was a staircase. What an indent is for is
showing where a row sits in the tree, and the title, the icon and the disclosure triangle already say that; the grip
says something about the row that is true at every depth. It is now outside the indent, one column at the left edge, and
the padding that draws the nesting starts after it — which is also what leaves a straight edge to aim a pointer at.

A drag is one `move` op, exactly like `Tab` and `Alt-↓` before it. It mints an order key among the target's siblings the
way every other insertion does (T-2), so two devices dragging into one gap resolve by
[§5.3 The tiebreak](sync-flow.md#53-the-tiebreak) rather than by anything the drag knows about.

**The sidebar is two levels deep and the second one starts closed — T-10 with T-17.** It mirrored the tree once: every
container at every depth, indented, and M6 cut it back to the top level alone. Both ends of that were wrong. A tree
unlimited in depth (T-1) makes the column unlimited too, so the nav entries under it — Search, Done, Merged — go off the
bottom of the screen long before the tree itself does; but one level stops one step short of where the second place
worth starting usually is, and reaching it meant opening the top-level page to click a row that was already in view. A
*fixed* second level keeps the column bounded and closes that step: a top-level row is worth one disclosure, and
everything under that is the tree view's, which is the one that can collapse (T-8) and drag (T-14), with breadcrumbs
(T-9) as the way back up out of it.

**Closed by default, and that is the whole difference between this and the column M6 removed.** A sidebar that opened
every row would draw the mirror again on the first paint; one that could not open at all would be M6's sidebar for
anyone who never found the triangle. So the disclosure is drawn only on a row that actually has `folder` or `note`
children, and what is stored is the set of *open* ids — nothing is written until somebody opens one, and a device that
never does is the device M6 shipped.

**A note is one of those places and a task is not.** A note is somewhere a person returns to — it holds a body (K-3) and
may own a checklist (K-4) — so it belongs beside the folders. Tasks are the bulk of a checklist and would bury both
kinds that are navigation, which is the same argument that kept them out when this row read "containers only".

**A sidebar entry is a row, so it carries a row's menu — T-18.** It was the one row on screen with nothing but a link on
it: renaming a top-level folder, or adding something to it, meant navigating to a page to reach a row that was already
in front of the reader. The menu is the same component over the same list, which is what keeps this from being a second,
smaller set of things a sidebar row can do — `src/ui/RowMenu.svelte` reads `menuActions` here exactly as
`src/ui/Row.svelte` does. Two entries come up disabled and correctly so: tags and R-7's period open a field *on the
row*, and a nav entry has nowhere to put one.

T-11 filters `children` rather than the rendering, so every edit sees the same rows the user does: `Alt-↓` cannot move a
row past a hidden one, and `Backspace` on an empty row is not refused by children nobody can see. The cost is that a new
sibling's order key is minted against the visible siblings only, so a finished row un-ticked later lands wherever its
own key puts it among them — deterministic, and the same rule T-2 already applies.

### 3.1 Keyboard (desktop)

All of it is in `src/ui/keyboard.ts`, which resolves every key to an action from `src/ui/actions.ts` — the list the row
menu renders.

| Key | Behaviour | Where |
| --- | --- | --- |
| `Enter` | New sibling below — or a **first child** if the row is an expanded parent | ✅ `new-below` / `new-inside` |
| `Tab` / `Shift-Tab` | Indent / outdent | ✅ `indent` / `outdent` |
| `Alt-↑` / `Alt-↓` | Move among siblings | ✅ `move-up` / `move-down` |
| `↑` / `↓` | Move the caret between rows | ✅ over the flattened visible rows, `src/ui/rows.ts` |
| `Backspace` on an empty row | Delete it — **refused if it has children** | ✅ `canBackspaceDelete`, against the typed title |
| `Escape` | Discard the in-progress title edit | ✅ the row's draft, never a written op |

**The keys are written down in one place, and it is the settings screen — X-33.** `KEY_HELP` in `src/ui/keyboard.ts` is
that list: every binding above in the words a person reads, beside the bindings themselves, so the reference cannot
drift from what the keys do. `src/ui/keyboard.test.ts` fails if a key is bound and taught nowhere, or taught and bound
nowhere. It used to be printed on every row's `⋮` menu instead, which put a reference a person reads once under a
control they open ten times a day — [§10 Application shell, PWA, offline](#10-application-shell-pwa-offline).

**The row `⋮` menu carries the edits, and four of these keys are not among them — X-34.** Indent, outdent and the two
nudges only reorder the tree, and a finger already reorders it by dragging (T-14, T-16) — a menu entry beside that
gesture is a second, worse way to do the same thing, and it is four of the eight entries on the menu. Every other key
still has one, because a phone has no keyboard and that is what the menu is for: `menu` on each `RowAction` in
`src/ui/actions.ts` is where the line is drawn, `menuActions` is what `RowMenu` renders, and `actions.test.ts` fails if
the four ever come back or if anything else leaves.

One key is outside all of it. `/` opens search (F-5), and search is not a row action — it acts on the application rather
than on the row under the caret, so the row menu is the wrong place for it and the sidebar entry is where a phone
reaches it. `KEY_BOUND_ACTIONS` stays the list of *row* actions, which is what makes the tests above mean something.

## 4. Item kinds and attributes

| ID | Requirement | State | Where |
| --- | --- | --- | --- |
| K-1 | A row is one of three kinds: `folder`, `note` or `task` | ✅ | `src/core/types.ts`. Only a task is checkable; a top-level `folder` or `note` is what T-10 shows in the sidebar. Kind drives rendering, never structure — any kind may own children. There were four until M6: `list` is read as `folder` by `src/core/op-log.ts`, so a file written before it went keeps folding to the same tree — `op-log.test.ts` |
| K-2 | Tasks render a checkbox; folders and notes render a kind icon | ✅ | `src/ui/Row.svelte`, `src/ui/KindIcon.svelte` |
| K-3 | A note has a long free-text body with its own editor | ✅ | `src/ui/NoteBody.svelte`, carried by `src/ui/NotePane.svelte` — beside the list above `lg` and over it below, per X-21 and X-22. It was a full page instead of the list until then, and the field itself did not change |
| K-4 | A note can still own checklist children (heading + items pattern) | ✅ | The ops are the same ops any parent takes — `edit.test.ts`. **Where they are drawn is the tree's**, not the note's own view: since X-31 the pane is the body alone, and the note's children are the rows nested under it in the list beside it, which draws the whole subtree |
| K-5 | Any row can be converted to any kind after the fact ("Turn into") | ✅ | `turnInto` in `src/core/edit.ts`, in the row menu. Two devices converting one row differently resolve by `(at, device id)`, with a notice — [§9 Conflict presentation](#9-conflict-presentation) |
| K-6 | ~~A note can be promoted to a checklist from its own page~~ | ✗ **Withdrawn** | Built in M1 and taken out again: it was a second control for the one op K-5 already offers, and the only one that changed a kind from outside the row menu. Nothing replaces it — `turnInto` is unchanged and the row menu still reaches every kind |
| K-7 | Note body saves are debounced (1 s) so typing is not one op per keystroke | ✅ | `src/ui/NoteBody.svelte`. The 1 s debounce governs the store; an **op** is emitted on blur, on navigating away, or after 60 s of continuous editing — S-20 |
| K-8 | Every list page opens with a line where typing a title and pressing Enter makes a **task** at the end of the list, and leaves the line ready for the next one | ✅ | `src/ui/QuickAdd.svelte`, over `createLastChild` with no kind — which is `task`, the default every other creation path already used. `src/ui/NodePage.svelte` gives it the page header, narrow and above the breadcrumbs; `src/ui/NotePane.svelte` gives it the pane's top row, where the breadcrumbs were until X-31 — it adds to the note, and the row it makes is drawn under the note's own row in the list beside it. The other two kinds have their buttons beside the line rather than under the list — K-10 |
| K-9 | A paste into that line carrying line breaks makes one row per line, all at the end of the list | ✅ | `src/core/paste.ts` is the only place the split is spelled, `createLastChildren` in `src/core/edit.ts` mints the keys, and `src/ui/QuickAdd.svelte` is the one caller. `paste.test.ts`, `edit.test.ts`, `scripts/ui-smoke.mjs` |
| K-10 | The line and the two kind buttons are one group, at the top of the list rather than an input above it and buttons under it | ✅ | `src/ui/QuickAdd.svelte` draws all three and owns the one draft between them; `src/ui/NodePage.svelte` puts the group in the page header and `src/ui/NotePane.svelte` in the pane's top row — X-31. `src/ui/TreeView.svelte` draws rows and nothing else. Pinned there rather than scrolling with the list — X-26 |
| K-11 | Whatever is typed in the line is the title of the row a kind button makes: a title and `+ Note` is one **note** carrying it, rather than a task and an untitled note | ✅ | `addKind` in `src/ui/QuickAdd.svelte` — the `createLastChild` the line already calls, with the kind named. An empty line still makes an untitled row and hands it the caret, which is what the button under the list always did. `scripts/ui-smoke.mjs` |

**There were four kinds and there are three — `list` is gone.** A `list` and a `folder` differed by an icon and by
nothing else: both were containers, both could hold any kind (K-4 and T-1 make that true of every kind), and neither was
checkable. The choice between them was therefore a choice with no consequence, made at the moment of creation and
carried forever, so one person's tree ended up holding both for the same job — a row that read as a list on the device
that made it and as a folder on the one that opened it a month later. Three kinds are three answers to three different
questions: something that holds things, something that holds text, something that gets ticked.

**The rename happens at the decoder, not by rewriting anything —** [§2.2 The op](#22-the-op). `src/core/op-log.ts` reads
a `kind` of `list` as `folder`, exactly as it normalises a tag from an older build, so a file written before this change
folds to the same tree without a migration pass, a version bump or a rewrite of a peer's file — which
[§7.3 Fixed constraints](#73-fixed-constraints) forbids anyway. Refusing the line instead would have dropped the
`create` and taken the row with it, and a row that vanishes on upgrade is the failure the format exists to prevent. A
peer still running the older build reads the `folder` this one writes, because `folder` was always one of its four.

Notes are deliberately not checkable. `done` is still a field on every node, because K-5 keeps it across a "Turn into"
so that turning back restores the tick — which is also why T-11's filter reads `done` rather than `kind === 'task'`.

**K-6 was withdrawn, and what it cost was a second answer to a settled question.** "Promote to checklist" sat on a
note's own page and wrote `turnInto`, which is exactly what the row menu's "Turn into" writes one level up — so one op
had two controls, in two places, worded two ways, and only one of them could reach the other kinds. The page kept the
button that was easiest to press by accident while reading a note, and a kind change is a deliberate edit rather than a
reading gesture. K-5 is untouched and `turnInto` has one caller now: the row menu, which is where every other row-level
edit already lives and which a phone can reach.

**The quick-add line makes a task and nothing else, and that is the whole of K-8.** A checklist is mostly tasks, so the
one path that costs no decision has to produce the kind the person was already going to pick — `createLastChild` with no
kind, which has meant `task` since M1. The other two kinds keep their buttons, one click away, because picking a kind is
a decision worth a button rather than a mode.

**The line sits in the page header rather than at the end of the list.** Where it goes and where the row lands are two
questions, and only the second one is the merge's: the row is still appended, so `createLastChild` and every test over
it are unchanged. What moved is the reach. At the end of a list the line is wherever the last row happens to leave it,
so a list long enough to scroll puts the one control the app is mostly used for below the fold, and every row added
pushes it further down. A header is at a fixed place on every list page, which is what makes typing the next task a
reflex rather than a scroll. It is narrow because it is one short input and a full-width one reads as a search bar, and
it sits at the left edge of the page's own column rather than in the middle of the header — X-23, so it does not move
sideways when the note pane opens beside it. The header belongs to the node page alone — Search, Done and Settings have
no list to add to, so they have no line. The note pane is the one place the line is not a page header: there it is the
pane's top row, above the note's title — X-31.

**The two kind buttons came up to sit beside it — K-10.** They were under the list, which was the same argument the line
had already lost: the end of a long list is below the fold, so "+ Note" was reachable on a short list and a scroll away
on the list long enough to want one. Adding is one group in one place now, whichever of the three kinds is being added,
and the group is the input with the two buttons after it — the input first, because a task is what the line makes with
no button pressed at all. `TreeView` is left drawing rows, which is the whole of what a list of rows is for, and the one
draft is the component's rather than shared between two of them.

**A kind button reads the line — K-11.** One group is one control, so the text in it is the title of whatever the group
is asked to make: typing `Packing list` and pressing `+ Note` is a note called `Packing list`, where it used to be a
task called `Packing list` and an untitled note underneath it. Nothing else about the button changes — an empty line
still makes an untitled row of that kind and hands it the caret, because a row that has no title yet is a row about to
be named. What the two share is where the caret ends up: the line keeps it either way, exactly as K-8's `Enter` does,
because the person is filling a list rather than editing one row.

The event order is the whole of the implementation. An input that commits on blur, pressed beside a button, loses the
caret on the way to the click: the blur would write the typed title as a task and the button would then add a second,
untitled row — the one outcome the group exists to prevent. Preventing `pointerdown`'s default is what keeps the focus
in the line on every pointer, including a thumb, and the blur's own `relatedTarget` guard is the second answer for a
browser that focuses anyway.

**A pasted paragraph is a list somebody has already written — K-9.** Typing `Enter` after each of fifteen lines is work
the line breaks already did, so a paste carrying one is fifteen rows at the end of the list rather than one row holding
fifteen lines. Every one is an ordinary `create`, minted at the end of the list in the pasted order, so the paste merges
exactly as fifteen separate additions would and nothing new reaches the payload.

Three rules make it predictable, and each of them is about not surprising the person who pressed the key:

- **A paste with no line break in it is an ordinary paste** and writes nothing. The line is still a line, and what is in
  it is committed by `Enter` or by leaving, exactly as K-8 says.
- **What was already typed is part of the paste.** The text is split at the caret and the pasted block goes between the
  halves, because that is where the browser would have put it: a paste after `Buy ` has to mean `Buy milk`.
- **A blank line is not a row.** A paragraph copied out of a document is usually double-spaced, and a run of untitled
  rows is not what the person copying it meant. Each line is trimmed for the same reason — the indent is the document's,
  not the task's.

`src/core/paste.ts` is where that split lives, beside `src/core/tags.ts` and for the same reason: it is a question about
text rather than about the tree, so it is answered once, in the logic layer, and tested without a browser.

Its `Enter` is not a row action and is not in the row menu, for the same reason `/` is not —
[§3.1 Keyboard (desktop)](#31-keyboard-desktop). It acts on the list rather than on the row under the caret, and there
is no caret in a row when it fires. What it does have in common with the row keys is where the text goes: nothing typed
is lost, so leaving the line commits what is in it exactly as leaving a title does, and `Escape` is the one way to throw
it away.

### 4.1 Tags and priority

A kind says what a row *is*. A tag and a priority say what it is *for*, and they are the two attributes worth the merge
rule they cost: everything else on the backlogged list — [§16 Explicitly out of scope](#16-explicitly-out-of-scope) — is
a date, and a date wants a calendar rather than a field.

| ID | Requirement | State | Where |
| --- | --- | --- | --- |
| A-1 | Any row carries a set of tags, whatever its kind | ✅ | `tags` in `src/core/types.ts`; `src/core/tags.ts` is the one place a tag is cleaned. A row is tagged from its `⋮` menu and from its own page |
| A-2 | Any row carries a priority — none, low, medium or high — drawn as a flag in green, yellow or red | ✅ | `Priority` in `src/core/types.ts`; `src/ui/PriorityFlag.svelte` is the control, and the three colours are theme tokens like every other colour — [§10.1 Themes](#101-themes) |
| A-3 | Both are ordinary fields: one `set` op, last-writer-wins, and a conflict row when two devices raced | ✅ | `setTags` and `setPriority` in `src/core/edit.ts`; `src/core/conflicts.ts` classifies them beside `title` and `done`, and `src/core/compact.ts` drops a superseded one like any other field |
| A-4 | Rows can be found by tag, and several tags are AND-ed | ✅ | `taggedRows` in `src/core/filter.ts`, rendered by `src/ui/TagsPage.svelte`. Every selected tag must be on the row. It narrowed the **tree** until M11, through a bar above it; it lists the matching rows on `#/tags` instead — [§4.2 Finding rows by tag](#42-finding-rows-by-tag) |
| A-5 | Which tags are chosen is device-local and never reaches a file | ✅ | The route — `#/tags/<tag>,<tag>` — which is a fragment and reaches no server either, F-5's argument applied to a tag. It sat in `src/app/view-state.svelte.ts` beside the collapse state until M11; nothing about it is stored now, which is a stronger version of the same promise — [§2.3 What is never in the Sync Folder](#23-what-is-never-in-the-sync-folder) |
| A-6 | A row created while a filter is on carries that filter's tags | ✗ **Withdrawn** | It existed because a filtered tree could create a row it then hid. Nothing filters the tree since M11, so there is no filter to inherit and nothing to vanish from — [§4.2 Finding rows by tag](#42-finding-rows-by-tag). Tagging at creation is A-8's instead, and is typed rather than inherited |
| A-7 | Every tag in the tree is listed on a page of its own, and choosing one lists the rows carrying it | ✅ | `src/ui/TagsPage.svelte` at `#/tags` and `#/tags/<tag>,<tag>`, a nav entry between Search and Done. It derives everything and stores nothing — `tagsInTree` and `taggedRows` are two scans of the materialised tree, exactly as F-4's search is. It is the **only** place in the application a tag narrows anything — [§4.2 Finding rows by tag](#42-finding-rows-by-tag) |
| A-8 | A `#tag` prefix on the add line tags the row it makes: `#errand #town Buy milk` is a row called "Buy milk" carrying both | ✅ | `parseTagged` in `src/core/tags.ts`, called by `src/ui/QuickAdd.svelte` — leading tokens only, so a `#` further along the line stays part of the title. Every line of a K-9 paste is read on its own, which is why `createLastChildren` takes each row's tags rather than the block's. `tags.test.ts`, `edit.test.ts`, `scripts/ui-smoke.mjs` |

**Tags are typed in front of the title — A-8.** `#errand #town Buy milk` on the add line is one row called "Buy milk"
carrying two tags, which is how a row gets tagged as it is made now that A-6's filter is gone: typed by the reader
rather than inherited from a mode. The rule is deliberately small. **Leading tokens only** — the prefix ends at the
first word that is not a `#word`, so "Buy milk #2" is a title and stays one, because a title is prose and people write
hashes in prose. A bare `#` is not a tag and ends the scan, so a line starting with one is a title starting with one. A
line that is *only* tags writes nothing and keeps what was typed: there is no row in `#errand`, and clearing the line
would throw away a prefix whose title is the next word the reader was about to type.

It is the same grammar on every line of a K-9 paste, read per line rather than per block — each line of a pasted list
brings its own prefix, and no two lines need agree. `parseTagged` is in `src/core/tags.ts` with every other rule about
what a tag is, so the add line decides where a row goes and never what a tag looks like, and what it returns goes
through `cleanTags` like anything else: case-folded, sorted, deduplicated, twelve to a row.

**A tag is normalised on the way in, and the normal form is what is stored.** Case-folded, its inner whitespace
collapsed, a leading `#` dropped, trimmed to 32 characters, and the set held sorted and deduplicated —
`src/core/tags.ts`. Two devices that type `Work` and `work` have typed one tag, which is what a filter over one person's
own checklist has to mean. The cap is twelve tags to a row: a row that needs a thirteenth is a row that wants a list.

**Tags merge as one field, not as a set of members.** Two devices adding different tags to one row concurrently resolve
like any other field — the later write wins whole, and the conflict row offers the set that lost, which is one click to
take back. Making the *members* merge independently would mean a stamp and a tombstone per member, which is a second
merge mechanism living inside one field —
[past_decision.md §10 Tags as one field](past_decision.md#10-tags-as-one-field).

**Priority is four names rather than a number.** The log is read by a person (D-4), and `high` is legible in it where
`3` is a guess. `none` is a real value rather than an absent field, so clearing a flag is a write that can win a race
against setting one, exactly like un-ticking a box.

Priority has no row-menu entry, and that is not the [§3.1 Keyboard (desktop)](#31-keyboard-desktop) rule being broken:
the flag *is* a control on the row, reachable by thumb and by mouse, and four menu entries would teach nothing the four
states of one flag do not.

### 4.2 Finding rows by tag

**`#/tags` is the only place in the application where a tag narrows anything.** The page lists every tag in the tree,
most used first, and choosing one lists the rows carrying it — each with the path it sits on, so the list says where the
row is and opening one goes to its page. A row survives it when it carries **every** selected tag — AND rather than OR,
because two tags on one row is the question people actually ask ("what is tagged `errand` *and* `town`"), and OR is what
search already does with two words.

**The tree is no longer filtered at all.** A-4 used to narrow it through a bar above it: the bar showed every tag, the
selected ones hid every row that did not carry them, the ancestors of a match were added back so a hit in a collapsed
folder was reachable, T-8's collapse state was overridden while the filter was on, and A-6 had to put the filter's tags
on any row created under it or the row vanished as it was typed. That is five rules, each of them repairing a hole the
one before it opened, for a mode the tree could be left in — and a filtered tree with the bar scrolled off is an empty
list with no explanation. The rules are gone with the mode. `#/tags` answers instead of redirecting, and it needs none
of them: a list of matches carries the path rather than the ancestors, and nothing is hidden anywhere because nothing is
being narrowed in place.

**A tag on a row is a label.** The chips `src/ui/TagChips.svelte` draws say what the row carries and do nothing when
tapped — they were the shortest way into the filter, and there is no filter. They are deliberately not links to
`#/tags/<tag>` either: a row is dragged (T-14, T-16) and its title is typed, and a navigation in the middle of that is a
place a thumb lands by accident.

**Which tags are chosen is the route — A-5.** `#/tags/errand,town`, one path segment with each tag encoded on its own,
for the reason F-5 gives for the search query: the fragment reaches no server, so a list of rows is linkable, survives a
reload and pastes into another device. It used to persist in `localStorage`, because a filter that cleared itself on
every reload was a filter nobody could rely on. A page does not have that problem — it is where the reader already is —
so nothing about it is stored, which is a stronger version of the promise A-5 was making.

**Search and the Done view are untouched, and always were.** Search (F-4) scans every row by name and the Done view
(T-12) lists what has left the tree; a tag narrowing either would be a second answer to a question asked somewhere else.

### 4.3 Bold and headings in a note body

A note's body (K-3) is the one place in the application with more than a line of text in it, and it was the only place
where "this line is a heading" and "this word matters" could not be said — everything else here is a row, and a row has
a kind, a flag and tags to say what it is.
[past_decision.md §12 Formatting in a note body](past_decision.md#12-formatting-in-a-note-body) is what this was chosen
over.

| ID | Requirement | State | Where |
| --- | --- | --- | --- |
| B-1 | A note body carries **bold** and two levels of heading, and no other formatting | ✅ | `src/core/markup.ts` — the one place a mark is spelled, beside `tags.ts` and `paste.ts`; `markup.test.ts` |
| B-2 | The marks are Markdown's — `**bold**`, `# ` and `## ` — and they are stored in `body` itself | ✅ | Nothing changed in `Node`, the op, the merge, the conflict rows or compaction: `body` is a string before and after |
| B-3 | The body is edited as text and read as rendered: the marks are visible while the caret is in it, the formatting when it is not | ✅ | `src/ui/NoteBody.svelte`. One textarea, never unmounted — transparent over the rendered blocks when the caret is elsewhere, so the click that reaches it is the click that focuses it |
| B-4 | `Ctrl-B` wraps the selection, and two on-screen controls do the same: bold, and a heading that cycles heading, subheading, none | ✅ | `toggleBold`, `setHeading` and `nextHeading` in `src/core/markup.ts`, driven by `src/ui/NoteBody.svelte`. A phone has no Ctrl key, which is [§3.1 Keyboard (desktop)](#31-keyboard-desktop)'s rule applied to a body rather than to a row |
| B-7 | Selecting a run of text raises those same two controls beside the selection | ✅ | `src/ui/NoteBody.svelte` over `document`'s `selectionchange`; `src/ui/text-rect.ts` measures where the run sits. A heading applies to every line the selection touches — `setHeading` takes a range, and a caret is a range of no width |
| B-5 | Search matches the body without its marks, and shows the snippet without them | ✅ | `src/core/search.ts` over `plainText()` from `markup.ts` — F-1 is a substring match, and it must not break because `**` sits in the middle of a word; `search.test.ts` |
| B-6 | The renderer emits structure, never HTML | ✅ | `parseBody` returns blocks and spans; the component renders them, so Svelte's own escaping is what reaches the DOM and a pasted `<script>` is text |

**The marks live in the body, and that is the whole design.** `body` stays a string, so every rule already written about
it still holds without a word changed: one field, last-writer-wins, a conflict row when two devices raced (C-4), a whole
body per op on blur or after 60 s (S-20), and a superseded one dropped by compaction (S-14). A build that predates B-1
shows `**07:40**` — four characters of noise around a legible time, which is the entire argument for Markdown over an
HTML body or a JSON document: the fallback is readable, on the phone that has not been updated and in the file itself.

**Three marks, and the absence of the rest is the design too.** No italics, links, code, quotes or bullet lists. The
application already has lists — that is the tree, T-1, and a bullet in a note body is a checklist that cannot be ticked,
moved or found. A link between rows is what search and the sidebar are for. Every mark added is one more thing to
escape, to render, to teach and to strip before matching, so the list grows only when a note actually wants one.

**A heading needs the space: `# ` opens a heading, `#town` does not.** A leading hash with no space is how a person
writes a tag (`src/core/tags.ts` drops it), and a body line beginning `#errand` has to stay the word it is.

**A textarea, not a `contenteditable`.** The body's whole design is a draft in a plain field — K-7's 1 s store debounce,
S-20's emission on blur, and X-10's rule that a peer's merged edit repaints without eating the caret. A rich field hands
the DOM to the browser and the caret rules with it, and the merge would be arriving inside a document this application
does not control. Editing plain text and rendering it when the caret leaves keeps one path through
`Session.stageBody`/`commitBody`, and it is also what makes B-3 honest: what is stored is exactly what was typed.

**The headings render under the page's own.** A note page is an `h1` (its title) and an `h2` (K-4's "Checklist"), so `#
` and `## ` in a body render as `h3` and `h4` and the document outline stays true. The rendered block is `aria-hidden`,
because it is a second presentation of a value the field beneath it already carries: assistive technology reads the
textarea, which holds the text itself, and one value announced twice is one value too many.

**A control writes marks and nothing else, which is what makes them undoable.** `Ctrl-B` and the two buttons produce
exactly the characters a person could have typed, so the field's own undo reverses them — there is no editing state to
keep in step. A button must not take the focus while it does that, or the blur would commit the body and move the caret
out of the text the button is about to edit.

**Two controls, not four: the heading cycles.** None, heading, subheading, and round again, with the button showing
which one the line carries. That is the shape A-2's priority flag already has —
[§4.1 Tags and priority](#41-tags-and-priority) — and the argument is the same one: a button per level teaches nothing
that one button naming the level does not, and the levels are worth a control rather than a menu.

**B-7 puts that pair where the words are.** Selected text is a question about those words, so the answer belongs beside
them rather than at the top of the page — and it is the *same* two controls, because a second vocabulary for one edit is
a second thing to learn. The row above the field stays, and is not redundant: it is the only reach when nothing is
selected, which is the ordinary way to make the line the caret is on a heading, and it is what teaches that the marks
exist at all.

**Finding the selection is the whole cost of B-7.** A textarea has no range geometry — `Range` and `getClientRects` see
one replaced element, not the lines inside it — so `src/ui/text-rect.ts` lays the text out a second time in a mirror
wearing the field's own metrics and measures the run there. It is exact for a wrapped line, because the mirror wraps at
the width the field does. The alternative was to pin the controls to the top of the field, which is not "beside the
selection" in any body long enough to scroll. `selectionchange` on the document is what raises them, because a field
fires no event of its own when a drag ends outside it, and it is the one signal a mouse, a keyboard and a long press on
a phone all produce.

### 4.4 Today and Tomorrow

Two lists that are not part of the tree. What is in them was put there by hand and belongs to nobody: an item in Today
is not a row of some folder that also happens to be due, and no row in `All` can be dragged into either list. They are a
second root beside `root`, holding rows of the ordinary kind — `src/core/agenda.ts` is what reads them back out.

| ID | Requirement | State | Where / test |
| --- | --- | --- | --- |
| G-1 | `Today` and `Tomorrow` hold items of their own, outside the tree: nothing in them is a child of any row in `All`, and no row can be moved from one side to the other | ✅ | `AGENDA` in `src/core/types.ts` is a second parent that is not a node, exactly as `root` is; `resolveTree` in `src/core/tree.ts` treats both as roots, and `canMoveTo` refuses a move whose root would change. `tree.test.ts`, `edit.test.ts` |
| G-2 | An agenda item carries the day it is filed for. Nothing in the tree carries one | ✅ | `day` on the node, written by one `set` op and merged last-writer-wins like a tag or a flag — [§2.1 The node](#21-the-node). `src/core/op-log.ts` reads and writes it, `src/core/compact.ts` drops a superseded one, `src/core/conflicts.ts` offers the value that lost. `op-log.test.ts`, `compact.test.ts`, `conflicts.test.ts` |
| G-3 | An item in Tomorrow is in Today the next day, and it costs no write | ✅ | Today is every agenda item whose day has come and Tomorrow every one whose day has not — `agendaRows` in `src/core/agenda.ts`, over a `now` the caller passes in. The day turns on every device at once because nothing has to happen for it to turn. `agenda.test.ts` |
| G-4 | An item whose day has passed and which is not ticked stays in Today | ✅ | The cut is `day <= today` rather than `day === today`, so a day nobody got to does not empty itself — `src/core/agenda.ts`. A ticked item leaves by T-11 and lands in the Done view like any other row. `agenda.test.ts` |
| G-5 | Items are added by the same line every list has, and land on the day of the page they were typed on | ✅ | `src/ui/AgendaPage.svelte` hands K-8's `src/ui/QuickAdd.svelte` the page's day, and `createLastChild` carries it into the `create`'s companion `set`. `edit.test.ts`, `scripts/ui-smoke.mjs` |
| G-6 | An item is moved between the two lists from the row menu | ✅ | `setDay` in `src/core/edit.ts`, offered by `src/ui/actions.ts` as `move-to-tomorrow` and `move-to-today` — one `set day`, and the item is in the other list because that is what the other list means. `actions.test.ts`, `scripts/ui-smoke.mjs` |
| G-7 | Both lists sit under `All` and **above the rule** that separates it from the tree's own rows, and both have a route of their own | ✅ | `#/today` and `#/tomorrow` — [§5 Navigation and routing](#5-navigation-and-routing) — rendered by `src/ui/AgendaPage.svelte` and linked from `src/ui/Shell.svelte`, in the corner's block rather than in the nav below it: the corner's weight and the corner's colour, no glyph, and pinned where it is rather than scrolling with the lists (X-29). The open one is marked by its background alone. `router.svelte.test.ts`, `scripts/ui-smoke.mjs` |

**The rollover is a read, not a write, and that is the whole design.** "Tomorrow's items move into Today after a day"
could have been two folders and a job that writes `move` ops at midnight. Every device would have had to run it, a
device that was shut for three days would run it late, two devices awake at midnight would both write it, and the
sibling order those moves minted would raise C-3 rows for a move nobody made. Instead the item records the day it is
filed for and the two lists are questions asked of that day: Today is `day <= today`, Tomorrow is `day > today`. Nothing
is written, nothing can race, and every device turns the day at its own midnight without agreeing with anyone.

**They sit with `All`, above the rule rather than under it.** The rule in the sidebar separates the three places that
are not in the tree from the tree itself, and these two are not in it — so the block reads corner, then the two days,
then the line, then the lists. It also means they are pinned where the corner is: X-29 scrolls the lists and leaves this
block alone, which is right for two entries that are always the same two. They carry the corner's weight and its colour,
and no icon: the two shortest labels in the column do not need a glyph to be told apart, and one beside them would have
been the only picture in a list of words.

**The items are ordinary rows, which is why so little of this is new.** They are created, titled, ticked, tagged,
flagged, dragged, deleted and restored by the same ops and the same code as everything else; they are in the Done view
when they are ticked (T-12), in search results (F-4), and in the conflict rows when two devices raced (C-1). The two
things that are theirs alone are the parent they hang under and the `day` they carry.

**They order like every other list — T-2, and no second rule.** An overdue item is not floated to the top of Today: the
list a person put in an order stays in that order, and a day-first sort would fight the drag that put it there (T-14).
What tells an overdue item apart is that it is *there at all*, on a day it was not filed for.

**A tree row cannot become an agenda item and an agenda item cannot become a tree row.** Both would be one `move` op and
neither is offered: the two lists are separate because that is what was asked for, and `canMoveTo` enforces it rather
than trusting that no view puts the two on screen together. Scheduling a row that already exists in the tree is a
different feature, and [past_decision.md §18 Today and Tomorrow](past_decision.md#18-today-and-tomorrow) says what it
would cost.

### 4.5 Timely

A third list outside the tree, for the things that come back rather than get finished: water the plants, change the
filter, pay the rent. The rows are the rows every other list holds — a third parent that is not a node, holding tasks —
and what separates them is what a tick means. Ticking a task in `All` finishes it, and T-11 takes it out of the list.
Ticking a timely item finishes it *for now*: the item stays exactly where it is, greyed out, and comes back on its own.

| ID | Requirement | State | Where / test |
| --- | --- | --- | --- |
| R-1 | `Timely` holds check items and nothing else: every row in it is a task, it is one level deep, and no row can be moved into it from `All`, Today or Tomorrow | ✅ | `TIMELY` in `src/core/types.ts` is a third parent that is not a node, beside `root` and `agenda`; `canMoveTo` in `src/core/edit.ts` refuses a move whose root would change and a move *into* a timely row, which is what makes indent and a drop-inside refusals rather than conventions. `src/ui/TimelyPage.svelte` adds tasks and offers no kind change. `tree.test.ts`, `edit.test.ts` |
| R-2 | A timely item carries how often it repeats — every N days or every N months | ✅ | `every` on the node, as `<n>d` or `<n>m`, written by one `set` op and merged last-writer-wins like a tag or a flag — [§2.1 The node](#21-the-node). `src/core/timely.ts` is the only module that spells the shape, and it normalises at the decoder as well as at the input. `timely.test.ts`, `op-log.test.ts` |
| R-3 | Ticking a timely item does not finish it: it files the item for its next due day and leaves it in the list, greyed out until that day comes. It is never in the Done view | ✅ | `tickTimely` in `src/core/edit.ts` writes one `set day` and never `done`, so T-11 never takes the row out of the list and T-12's archive never collects it. `src/ui/Row.svelte` draws the box ticked and the row muted while the item is waiting. `edit.test.ts`, `done.test.ts`, `scripts/ui-smoke.mjs` |
| R-4 | An item repeating daily is due again the next day, and it costs no write at midnight | ✅ | Due is `day <= today` and waiting is `day > today` — `isDue` in `src/core/timely.ts`, over a `now` the caller passes in. It is G-3's read with a third question asked of it, so the day turns on every device at its own midnight with nothing written. `timely.test.ts`, `scripts/ui-smoke.mjs` |
| R-5 | An item repeating every N days counts them from the **tick**, not from the day it was due: one ticked three days late is next due N days after that tick | ✅ | `nextDue` in `src/core/timely.ts` is a function of `now` and the period alone — the day the item was carrying is not an input. Months are added by calendar and the day of the month is clamped, so the 31st of a month repeats on the 30th of a month that has no 31st. `timely.test.ts` |
| R-6 | A waiting item is brought back by un-ticking it | ✅ | The same control and the same op: `tickTimely` on a waiting item writes today's day, which is due by R-4's comparison. `edit.test.ts`, `scripts/ui-smoke.mjs` |
| R-7 | The period is set on the row itself, and the row says when the item is next due | ✅ | `src/ui/RepeatChip.svelte` shows the period and opens `src/ui/RepeatEditor.svelte` under the row — a count and a unit, the shape `src/ui/TagEditor.svelte` already has. The row menu opens the same editor, because a phone reaches the menu and a chip alike — [§3.1 Keyboard (desktop)](#31-keyboard-desktop). `actions.test.ts`, `scripts/ui-smoke.mjs` |
| R-8 | Timely sits with `All`, Today and Tomorrow above the rule, and has a route of its own | ✅ | `#/timely` — [§5 Navigation and routing](#5-navigation-and-routing) — rendered by `src/ui/TimelyPage.svelte` and linked from `src/ui/Shell.svelte`, in the corner's block for G-7's reason: it is not in the tree either. `router.svelte.test.ts`, `scripts/ui-smoke.mjs` |

**The countdown is a read, and it is G-3's read.** "Every five days" could have been a timer, a due-date job, or a
`lastTicked` field with arithmetic over it at render time. It is none of those: the item records the day it is **next
due**, which is the `day` field G-2 already added, and the two states are one comparison — due is `day <= today`,
waiting is `day > today`. Nothing happens at midnight, nothing can race, and a device that was shut for a week finds the
item due when it opens rather than five ticks behind. past_decision.md §19 says what the alternatives cost.

**The tick is the only write, and it writes a day rather than a tick.** `tickTimely` reads the clock once, adds the
period to it, and writes one `set day`. That is why R-5 is true by construction: the day the item *was* carrying is not
an input to the sum, so an item ticked three days late is next due N days after the tick and not N days after the day it
was ignored. It is also why R-3 is true — `done` is never written, so T-11 never takes the row out of the list and
T-12's archive never collects a chore that has no end.

**Un-ticking is the same op the other way.** A waiting item's box is ticked because the item is waiting, so clicking it
must mean "no, it is due" — one `set day` carrying today. There is no third state and no second control: the box says
whether the item is waiting, and pressing it changes that.

**Only check items, one level deep — R-1.** A folder in a list of chores is a list of chores that never comes back, and
a chore nested under a chore is a question about which of the two the tick belongs to. `canMoveTo` refuses both — a move
whose root would change, and a move that would put a row *inside* a timely one — so `Tab`, `Alt-↓` and a drop are all
refused by the model rather than by each view remembering to. The quick-add line on the page makes tasks and shows no
kind buttons, and the row menu offers no "Turn into".

**Two units, not five.** Days and months, because those are the two a repeating chore is actually described in — "every
three days", "every month" — and a week is `7d` typed once. A unit per row of a table of seven would be a vocabulary to
learn where two is a number and a toggle. Months are added by the calendar rather than by 30 days, so "every month" on
the 15th stays the 15th, and a day of the month the target month does not have is clamped to its last.

**A timely item is otherwise an ordinary row.** Same ops, same merge, same conflict rows, same compaction, same search
results, same tags and the same priority flag. `every` is an ordinary last-writer-wins field: `op-log.ts` reads and
writes it, `compact.ts` drops a superseded one, `conflicts.ts` offers the one that lost, and `edit.ts`'s `setEvery` is
the one writer.

## 5. Navigation and routing

Hash routing, per X-7, so the fragment never reaches a server and the app deploys to a static host, to the loopback
helper and to the Android WebView unchanged. `src/app/router.svelte.ts` holds the whole of it.

| Route | Renders | Where |
| --- | --- | --- |
| `#/` | The root: every top-level row | `src/ui/NodePage.svelte` with no node |
| `#/n/<node-id>` | One node's page — its path, its title, its body if it is a note, and its children. A **note** is drawn beside the nearest list above it rather than instead of it — X-21, X-22 | `src/ui/NodePage.svelte`, and `src/ui/NotePane.svelte` for a note |
| `#/today` | Today: every agenda item whose day has come, including the ones it did not come *on* — G-3, G-4 | `src/ui/AgendaPage.svelte` |
| `#/tomorrow` | Tomorrow: every agenda item whose day has not come yet — G-3 | `src/ui/AgendaPage.svelte`, the same page on the other day |
| `#/timely` | Timely: every repeating check item, the due ones live and the waiting ones greyed — R-3, R-4 | `src/ui/TimelyPage.svelte` |
| `#/tags` and `#/tags/<tag>,<tag>` | Every tag in the tree, most used first, and the rows carrying the tags chosen from it — A-4, A-7 | `src/ui/TagsPage.svelte` |
| `#/done` | The Done view of T-12: every ticked and deleted row in one list, newest first | `src/ui/DonePage.svelte` |
| `#/conflicts` | What the merge decided without asking — [§9 Conflict presentation](#9-conflict-presentation) | `src/ui/ConflictsPage.svelte` |
| `#/search` and `#/search/<query>` | The search results of [§6 Search](#6-search) | `src/ui/SearchPage.svelte` |
| `#/settings` | Everything about this device rather than about the tree — its name, its log, its theme. X-12 in [§10 Application shell, PWA, offline](#10-application-shell-pwa-offline) | `src/ui/SettingsPage.svelte` |
| `#/devices` | The device list of [§8 Device management](#8-device-management) | `src/ui/DevicesPage.svelte` |
| `#/logs` | This device's own op log, newest first — D-4 in [§8 Device management](#8-device-management) | `src/ui/LogPage.svelte` |
| anything else | The recovery page, per X-11 | `src/ui/RecoveryPage.svelte` |

The query lives in the fragment rather than in a query string, for the reason X-7 already gives: `#/search/milk` is one
path segment the router splits like any other, it survives a reload and a cold launch, and it never reaches a server.

A node id that no longer resolves is not an error state: `#/n/<id>` of a deleted or unknown node renders the recovery
page, which tells deletion from absence because T-7 keeps the two distinguishable. A **finished** node resolves normally
— T-11 hides a row from its parent's page, not from its own — so a row opened from `#/done` gets the page it always had.

**A note's route composes two things rather than one.** `#/n/<id>` of a `note` draws the note *and* the list it hangs
under — the page of its T-6-resolved parent — because a note is read against the list it belongs to and replacing that
list to read one line cost two navigations to undo. The route did not change and neither did the Back button: the second
pane is derived from the route, so a cold launch on `#/n/<id>` draws the same two panes a click did (X-8), and
`#/n/<id>` of a `folder` or a `task` is the single page it always was. Which pane goes where is a breakpoint —
[§10.3 A note beside the list](#103-a-note-beside-the-list).

**The pane has a second way in that is not a route at all.** X-30 raises it from the caret: a note whose title is being
typed shows beside the list, with the route, the history and the left column untouched. The caret is device-local like
the collapse state, so none of it reaches the fragment and a reload draws the route's pane alone.

Two navigations exist besides the routes: the sidebar (T-10, top-level folders and notes, and T-11 takes finished ones
out of it) and breadcrumbs (T-9). Breadcrumbs climb the T-6-resolved parent, never the stored one, and the sidebar reads
the same resolved set. `#/done` and `#/search` are permanent entries in the sidebar's nav and `#/settings` is a
permanent entry in its footer, because a view that appeared only when it had something in it would be a view the user
could not learn.

`#/conflicts` is the exception to that rule, and deliberately: its entry appears only when there is something in it,
because a permanent one would be empty almost always — [§9 Conflict presentation](#9-conflict-presentation). It is
reachable by typing the fragment even then, and answers "nothing to report" rather than the recovery page.

`#/logs` and `#/devices` are not in the sidebar either, and for the opposite reason: both are always there to be found,
but both are reached from `#/settings`, because what they say is about *this* device and settings is where this device
is already the subject. A permanent nav entry for a diagnostic would cost every user of the tree a line of nav for a
page opened when something looks wrong. The nav went from four entries to three when X-12 gathered them, and to two when
Settings took the footer, and back to three when A-7 put **Tags** between them: **Search**, **Tags** and **Done**, plus
**Merged** when there is something in it, with **Settings** in the corner below them.

## 6. Search

The tree is the primary way to find a row and stops being one at about the third level of nesting, which T-1 makes
unlimited. Search is the flat view of the same data, and it is the only view that reaches what T-11 and T-7 have taken
out of the tree.

| ID | Requirement | State | Where |
| --- | --- | --- | --- |
| F-1 | Search matches a row's title and a note's body | ✅ | `src/core/search.ts`; `search.test.ts` |
| F-2 | Every hit carries the path it sits on, and opening one goes to its page | ✅ | The same `path` T-9 and T-12 render — `ancestorsOf` over the T-6-resolved parent |
| F-3 | Finished and deleted rows are found, and are labelled as such | ✅ | The tree hides them (T-11, T-7); search is where they are reachable by name rather than by scrolling the Done view |
| F-4 | Search is read-time and device-local: no index is built, stored or synced | ✅ | A scan of the materialised tree per query. Nothing to invalidate, so a peer's merged edit is searchable the moment it lands |
| F-5 | `/` opens search from anywhere; the query is in the route | ✅ | `src/ui/SearchPage.svelte`, `src/app/router.svelte.ts`; the fragment makes a result list linkable and reloadable |
| F-6 | The page says nothing until something is typed: the box, and then the results | ✅ | `src/ui/SearchPage.svelte`. The idle paragraph explaining the matching rules is gone — it was read once and skipped past on every visit after it, and the rules it described are the ones below, which the results demonstrate |

**Every term must match, and a term may match a different field from its neighbour.** "milk shop" finds a row titled
"Milk" inside a note whose body mentions the shop, because the row is what the user is looking for and the fields are
where the words happen to live. Matching is case-insensitive substring, not word-prefix: a checklist holds fragments and
abbreviations, and "kg" has to find "12kg".

**Ranking is a title before a body, then tree order.** No scoring beyond that, deliberately — a relevance score is a
thing to tune forever, and the path on every row is what actually tells two "Milk"s apart.

The cost of F-4 is a full scan per keystroke. It is affordable for the same reason
[sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision) defers compaction: one person's checklist is thousands of
nodes, not millions. What reopens it is a measurement, not a feeling — [§13 Performance budget](#13-performance-budget).

## 7. Sync

The transport is proven, the payload is chosen — an append-only op log per device,
[sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision) — and **M2 is built**: every device's file in the folder
is read, folded and written back. The design reasoning lives in [sync-flow.md](sync-flow.md); this section records only
requirement state.

### 7.1 Built

| ID | Requirement | State | Where |
| --- | --- | --- | --- |
| S-1 | Every mutation goes through one write path | ✅ | `src/app/device-log.ts` — the only writer of this device's file. |
| S-2 | A mutation shape that merges at field granularity rather than whole-document | ✅ | The op of [§2.2 The op](#22-the-op): a `set` carries only the fields that changed, so disjoint fields never interact — `src/core/materialise.ts` |
| S-3 | A device writes only paths carrying its own device id, so no two devices write one path | ✅ | `deviceFileName` in `src/core/op-log.ts` is the only name the write path can spell, and `src/app/folder-sync.ts` reads peers without ever writing one. |
| S-4 | Merge is commutative, associative and idempotent | ✅ | `src/core/merge.ts`; `merge.test.ts` asserts all three laws over op sets from a seeded generator — the shrinking S-12 still owes is what keeps that row open. |
| S-5 | Concurrent edits are detected by version vector, never prevented | ✅ | `opVectors` in `src/core/merge.ts` replays each file's `seen` receipts into a vector per op; `src/core/conflicts.ts` classifies the pair. |
| S-6 | Any device can settle any race, with no leader, quorum or membership | ✅ | Settling one is an ordinary op — `src/ui/ConflictsPage.svelte` writes a `set` like any other edit, and it dominates both sides because it has read both. |
| S-7 | A half-synced file is skipped and picked up whole on the next cycle | ✅ | `src/app/folder-sync.ts`, over `decodeLog`'s `null`; a decode that came back shorter than what is already held is treated the same way, since the file is append-only. `folder-sync.test.ts`. |
| S-9 | A new device joins by writing a file — no registration, no coordination | ✅ | `src/app/folder-sync.ts` reads whatever `list()` returns; a device absent from a vector counts as zero — `src/core/sclock.ts`. |
| S-10 | No-op edits are dropped before they reach the log | ✅ | `src/core/edit.ts` returns no ops at all, so `Session.run` writes nothing — `edit.test.ts` |
| S-13 | Tree-aware merge: concurrent moves, subtree tombstones, sibling order | ✅ | The three are read-time, not merge-time: `resolveTree` re-roots a cycle (T-6) and inherits a tombstone (T-7), `compareSiblings` orders on `(order, orderBy, id)` (T-2). `merge.test.ts` runs every case in [test.md §3.2 Scenario](test.md#32-scenario) |
| S-15 | An on-disk encoding that is appendable and diff-readable | ✅ | JSON Lines, one op per line, after a header line carrying the full vector — `src/core/op-log.ts`, [sync-flow.md §4.2 B — Append-only op log per device](sync-flow.md#42-b--append-only-op-log-per-device) |
| S-17 | Multi-device convergence simulator | ✅ | `src/core/merge.test.ts` — four devices, a seeded PRNG, edits and deliveries interleaved, then every device asserted to hold one tree. |
| S-18 | Adapter conformance suite covering every adapter | ◐ | `src/adapters/conformance.ts` is one suite asserting the contract rather than the implementation, run by `conformance.test.ts` over `memory`, `local`, `android` (bridge stubbed) and `http` (against a loopback server the test starts). `fsaa` needs a real folder picker and a user gesture, so it stays a device check — [test.md §3.3 Adapter conformance](test.md#33-adapter-conformance) |
| S-19 | The sync cycle runs on activity: the write path *is* the cycle, decaying to window focus and a manual refresh when idle | ✅ | `src/app/sync-cadence.ts` — a local edit resets the cadence, which then decays 5 s → 15 s → 60 s and stops. Focus and the shell's refresh button are the idle triggers. The cadence is device-local and never synced |
| S-20 | A note body is emitted as an op on blur, on navigating away, or after 60 s of continuous editing | ✅ | `src/ui/NoteBody.svelte` and `Session.commitBody`; navigating away is `src/ui/App.svelte`. Not on K-7's 1 s store debounce. Whole-body ops are the dominant growth term, so the emission trigger is what bounds the log |
| S-21 | The device's own op log persists through a folder adapter backed by `localStorage` | ✅ | `src/adapters/local-folder.ts`. It was M1's only storage; M2 keeps it as the no-sync fallback for a browser that can reach no folder, and it is what `?uitest` and the smoke run drive — [architecture.md §4 The folder adapter](architecture.md#4-the-folder-adapter) |
| S-14 | Compaction, so history does not grow without bound | ✅ | `src/core/compact.ts`, fired by `src/app/Session.svelte.ts` on the cycle and applied by `DeviceLog.compact`. A device rewrites **its own** file in place, dropping only ops of its own that a later op of its own already overwrites — [sync-flow.md §4.8 The compaction cut](sync-flow.md#48-the-compaction-cut). No snapshot format, no second encoding, no agreement with any peer. `compact.test.ts` asserts the fold is unchanged over the same generated op sets S-4 uses |

### 7.2 Not built

| ID | Requirement | State | Note |
| --- | --- | --- | --- |
| S-8 | A write is never observable in a partial state (temp file plus atomic rename) | ◐ | Each adapter owns it and none of them is ours: `localStorage` is atomic per key, the File System Access API commits a writable on `close()`, and the loopback helper and the Android bridge each write-then-rename on their own side. The conformance suite cannot assert it — a page cannot observe its own provider mid-write — so it is [test.md §3.6 Platform](test.md#36-platform)'s |
| S-11 | Upload queue, resumable after interruption | ✗ | Still unnecessary: the whole file is rewritten on every flush, so a failed write is retried by the next one rather than replayed. `DeviceLog` keeps the ops queued and the failure visible |
| S-12 | Property-based tests for S-4 | ◐ | The three laws are asserted, over a seeded generator, in `src/core/merge.test.ts` — `SEED` in the environment reproduces a failure exactly. What is missing is shrinking: a failure still arrives as the whole generated set — [test.md §3.1 Merge properties](test.md#31-merge-properties) |
| S-16 | Retiring a device, so a dead replica stops contributing a counter | ◐ | Cosmetic, not correctness: a dead device is dominated and drops out of the maximal set as an ancestor, and its counter is the twenty bytes [sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision) refuses to prune. M3 built the visible half — D-2's advisory `lastSeen` shows a dormant device as dormant. Nothing removes one, and nothing is planned to |

### 7.3 Fixed constraints

- No application server, ever. Sync goes through a cloud **file** provider.
- A device writes **only** paths under its own id, so the provider's conflict-copy behaviour never triggers.
- No authoritative clock, for the same reason. Timestamps recorded in a write still order writes identically on every
  device, but a skewed clock can order them against what the user meant — accepted, and costed in
  [sync-flow.md §6.5 Accepted limit](sync-flow.md#65-accepted-limit).
- Provider choice stays behind the three adapter methods so it can be swapped. The default is **MEGA**, matching the
  milestone M2. Real provider behaviour is not observable until a Windows and an Android build exist, and is deferred
  until then — [sync-flow.md §7 What is still open](sync-flow.md#7-what-is-still-open).

## 8. Device management

A device joins by writing a file and needs no registration (S-9). Nothing removes one, and nothing has to:
[sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision) never prunes a version vector, so a retired device costs
about twenty bytes forever and its stale file is dominated out of the maximal set as an ancestor. What is left is
presentation.

| ID | Requirement | State | Where |
| --- | --- | --- | --- |
| D-1 | A settings screen lists known devices by id, with a name the user can set | ✅ | `src/core/devices.ts` reads the list out of the header lines; `src/ui/DevicesPage.svelte` at `#/devices` lists them, and `src/ui/SettingsPage.svelte` at `#/settings` is the one place the name is typed — X-12. The name is data and syncs; the id is minted locally |
| D-2 | Each device carries an advisory `lastSeen`, so a dormant one is visible as dormant | ✅ | The `at` on the header line, stamped by the writing device on every write. Advisory only — the merge never reads it |
| D-3 | Nothing in the merge path depends on the device list being complete or current | ✅ | Structural: `src/core/devices.ts` is the only reader of `name` and `at`, and neither `merge.ts` nor `materialise.ts` imports it. A header with neither field is a device that has not been named, not an error |
| D-4 | The op log this device has written is readable inside the app, newest first, each op naming the row it touched | ✅ | `src/core/log-view.ts` turns ops into rows; `src/ui/LogPage.svelte` at `#/logs`, reached from the "This device" section of `#/settings`. Read-only — nothing on the page writes an op |
| D-5 | A device nobody has named names itself, from what the browser will say about it | ✅ | `src/core/device-name.ts` shapes `platform-browser-id4`; `src/app/device.ts` is the one place the user-agent string is read, and `Session.open` applies the result only when the header carries no name |

**D-4 shows the file as it stands, not the history.** The rows are this device's own ops in the order it wrote them,
which after S-14 has run is the ops that survived the cut rather than everything ever written —
[sync-flow.md §4.8 The compaction cut](sync-flow.md#48-the-compaction-cut). The page says so, because a log with a hole
in it that does not admit to the hole is worse than no log.

**It is this device's file and no peer's.** A peer's log is read on every cycle and could be listed the same way, but
what the ops of a peer explain is that peer's counters and receipts, not this one's — and this device's is the file the
question "what did I just write" is about. The header line is on the page for the same reason: the counter and the
receipts are what turn an op into a position in the vector.

**A device names itself, and only itself.** The name rides the header line of the file the device already owns, so
naming stays inside the one-writer-per-file rule (S-3) that the whole design rests on and needs no merge rule of its
own: there is exactly one writer of any given name, so two devices can never disagree about one. The cost is that
renaming the phone means opening the app on the phone. That is the honest trade — the alternative is writing into a file
this device does not own, which is the one thing the design never does.

**One editor, on the settings screen.** `#/devices` lists every device and edits none of them, including this one: a
name is a thing this device says about itself, so it is typed where the other statements about this device are, and the
list is the view of what every device has said. The self row there names the setting rather than repeating it, because
two inputs bound to one value is two places for it to look edited and one place for it to actually be.

**A device arrives with a name rather than waiting for one.** D-5 is what a device calls itself before anybody types
anything: up to five characters of platform, four of browser and four hex digits — `Win-Chro-a3f1`, `Andro-App-91b4`.
The last four are the first four of the device id rather than a fresh random, so the name is stable across restarts and
a person reading a conflict row can match it to the file in the folder. The other two are read off the user-agent
string, which is a guess and is allowed to be a wrong one: an unrecognised platform or browser is `Web`, and
`Web-Web-a3f1` is still a better answer to "which device wrote that" than eight hex characters.

It is an ordinary D-1 name and not a second kind of name. It goes in the same header field, written by the same single
writer, so the merge learns nothing new — and the settings screen edits it exactly as it edits a typed one. **A name
already in the header is never overwritten**, including one the user typed and one an older build left empty and this
build has since filled in; the suggestion applies only at startup and only to a header carrying no name at all. Clearing
the field leaves the device unnamed until the next launch, which names it again.

The name and the list together close row 9 of
[§15 Deviations and defects found during verification](#15-deviations-and-defects-found-during-verification): a conflict
row can now say "the laptop" where it used to have eight hex characters, and where nobody has typed anything it says
`Win-Chro-a3f1`. It still falls back to the id for a peer whose build predates D-5 and that was never named.

One machine can be more than one device. The device id lives in `localStorage`, so it is per-origin, and
[architecture.md §7.1 The two Windows bundles](architecture.md#71-the-two-windows-bundles) makes one Windows machine two
devices when it is used through both the hosted PWA and the loopback bundle. Whether the second origin adopts the
existing id or joins as a peer is open — [sync-flow.md §7 What is still open](sync-flow.md#7-what-is-still-open).

## 9. Conflict presentation

Merging at field granularity means the common case is no conflict at all, so a permanent panel would be empty almost
always. One nav entry appears when there is something in it and is absent otherwise.

Three different things land there, and conflating them would be wrong — two of the three are already resolved by the
time the user sees them.

| ID | Requirement | State | Row type | Where |
| --- | --- | --- | --- | --- |
| C-1 | A genuine race asks the user to choose | ✅ | Decision | `src/core/conflicts.ts`, rendered by `src/ui/ConflictsPage.svelte`. The op log moved where this lives — see below |
| C-2 | A T-6 repair names the node it re-rooted and offers to jump to it | ✅ | Notice | `resolveTree`'s `repairs` become rows in `src/core/conflicts.ts`; the row links to the node — [sync-flow.md §6.3 The user has to see it](sync-flow.md#63-the-user-has-to-see-it) |
| C-3 | A tiebreak that landed two concurrently inserted rows in device-id order says so | ✅ | Notice | Two visible siblings holding one `order` with different `orderBy` — `src/core/conflicts.ts` — [sync-flow.md §5.3 The tiebreak](sync-flow.md#53-the-tiebreak) |
| C-4 | A field resolved by last-writer-wins — a title, a tick, a "Turn into", a note body, a deletion, a tag set, a priority — says so | ✅ | Notice | The same row as C-1, carrying what was kept, what was not, and which device wrote each — by name once D-1 has one |
| C-5 | Nothing here blocks: no modal, no interruption of an edit in progress | ✅ | | One nav entry, present only when there is something in it. A re-rooted node reads as data loss, and a blocking prompt would make it read as worse |
| C-6 | Rows are derived from merged state each cycle, never stored; only dismissals persist, per device | ✅ | | `conflictsOf` is a pure function of the merged ops and the resolved tree; dismissals are ids in `localStorage` — `src/app/dismissals.ts`. Storing the rows would mean writing a file to acknowledge a notice, which is a fresh concurrent edit |

**C-1 and C-4 are one row, and the payload is why.** The maximal set of
[sync-flow.md §2.2 The maximal set reduces the whole folder at once](sync-flow.md#22-the-maximal-set-reduces-the-whole-folder-at-once)
offers whole *files* to choose between, which is what a snapshot payload makes of a race. Under the op log there is no
such moment: two concurrent writes to one field are both kept on disk, and the fold picks the newer by `(at, device
id)`. So the decision C-1 asks for is not "which of these two states" but "the older value was dropped — did you want
it?", and answering it is an ordinary `set` op. That makes one row that states the resolution (C-4) and offers to
reverse it (C-1), and it is why nothing in the app ever asks before merging.

C-2 and C-3 need no resolution path — the user drags the node back, and that corrective move is an ordinary edit.

**T-13 made `deleted` a contested field, and the row says so.** Before M3 a tombstone was final, so a delete could not
lose and never raised a row. `restore` is now the other writer of that field, so one device deleting a row while another
restores it settles by `(at, device id)` like every other field, and the losing write is offered back exactly the same
way — taking it is a `delete` or a `restore`, whichever was dropped. Other fields of a row that is currently tombstoned
still raise nothing: what its title once was is not a question worth asking about a row that is gone.

**A compacted op cannot be offered back.** [sync-flow.md §4.8 The compaction cut](sync-flow.md#48-the-compaction-cut)
drops a device's own superseded writes, and a dropped write is one no row can hand the user. This costs nothing that was
reachable anyway: a row survives only until the field is written again, and the write that superseded the op is that
write. What is genuinely lost is the record of a race the user never looked at before compaction ran.

A row survives until the field is written again by a device that has read both sides, which any of the buttons does and
which an ordinary later edit does too. That is what keeps the list from accumulating: nothing has to be dismissed for it
to empty, and a dismissal is only for a row the user is content to leave as it landed.

## 10. Application shell, PWA, offline

| ID | Requirement | State | Where |
| --- | --- | --- | --- |
| X-1 | One codebase and one layout for desktop and phone | ✅ | `src/ui/Shell.svelte` — one markup, breakpoints only |
| X-2 | Sidebar permanent from `md` up, dismissible drawer below | ✅ | `src/ui/Shell.svelte`; `scripts/ui-smoke.mjs` drives both widths |
| X-3 | Installable to a phone home screen and a desktop taskbar | ◐ | Manifest and service worker ship (`vite.config.ts`). The install itself is a device check — [test.md §3.6 Platform](test.md#36-platform) |
| X-4 | Maskable Android icon, padded so the mask cannot clip it | ◐ | `public/icons/icon-maskable.svg`, rendered by `scripts/make-icons.mjs` to the 80% safe zone. Uncropped on a real launcher is a device check — [test.md §3.6 Platform](test.md#36-platform) |
| X-5 | Full cold-start offline — everything precached, no API calls | ✅ | Workbox precache; `scripts/ui-smoke.mjs` reloads with the network off |
| X-6 | New builds take effect on next launch without an update prompt | ✅ | `registerType: 'prompt'` with no prompt: the waiting worker activates when the last tab closes |
| X-7 | Hash routing, so it deploys to any static host with no rewrite rules | ✅ | `src/app/router.svelte.ts`, and a relative `base` |
| X-8 | Deep links survive a cold launch from a home-screen icon | ✅ | The fragment never reaches the network; a reload on `#/n/<id>` is checked in `scripts/ui-smoke.mjs`. The home-screen launch itself is [test.md §3.6 Platform](test.md#36-platform) |
| X-10 | UI repaints automatically on any data change, including a merged remote one | ✅ | The store publishes; rows hold a draft so a repaint cannot eat the caret — `src/ui/Row.svelte` |
| X-11 | Deleted/missing node renders a recovery page rather than a crash | ✅ | `src/ui/RecoveryPage.svelte`; it tells absence from deletion, per T-7 |
| X-12 | One settings screen holds everything that is about this device rather than about the tree: its name, its log, its appearance | ✅ | `src/ui/SettingsPage.svelte` at `#/settings`, reached from the foot of the sidebar rather than from its nav. It writes exactly one op kind — the D-1 rename — and everything else on it is device-local |
| X-13 | Six themes: light, dark, green, orange, yellow and teal | ✅ | `src/core/themes.ts` is the catalog and `src/app.css` holds one palette per id; `themes.test.ts` fails if the two drift. Switching swaps the semantic tokens of [§10.1 Themes](#101-themes), so no component names a colour |
| X-14 | The theme is device-local and takes effect before the first paint | ✅ | `src/app/theme.svelte.ts` — the id in `localStorage` and `data-theme` on the document root, set by a boot line in `index.html` so a dark theme never flashes light. Never in a file, never synced — [§2.3 What is never in the Sync Folder](#23-what-is-never-in-the-sync-folder) |
| X-15 | The settings screen names the folder this device syncs through, and opens it in the system's file manager where the shell can | ✅ | `src/ui/SettingsPage.svelte`, over `src/app/shell.ts`. Opening a folder is not a fourth adapter method and never becomes one — [architecture.md §4.1 Shell actions, beside the adapter](architecture.md#41-shell-actions-beside-the-adapter) |
| X-16 | The settings screen points this device at a different folder, and names who decides when it cannot | ✅ | `changeFolder` in `src/app/shell.ts`, which re-enters [architecture.md §4 The folder adapter](architecture.md#4-the-folder-adapter)'s picker and reloads. The rows already written do not follow the device to the new folder, and the screen says so before the picker opens |
| X-17 | The settings screen launches the cloud provider's own app, and which provider that is stays on this device | ✗ **Withdrawn** | Built in M5 and taken out again: a catalog of six cloud clients, a picker on the settings screen, a launch capability in both shells and a `<queries>` block in the manifest, for one button that started an app the phone's own launcher starts — [§10.2 The sync folder, on the settings screen](#102-the-sync-folder-on-the-settings-screen) and [past_decision.md §16 Retiring the cloud-app launcher](past_decision.md#16-retiring-the-cloud-app-launcher) |
| X-18 | A device on the browser-only fallback takes the folder its own launcher is holding, rather than keeping an answer it gave before there was one | ✅ | `chooseFolder` in `src/app/folder-choice.ts`: the two shells that hand a folder in unasked are asked before a stored `local` is honoured, and nothing is written when one is taken — [architecture.md §4 The folder adapter](architecture.md#4-the-folder-adapter). `folder-choice.test.ts`; a real Firefox is [test.md §3.6 Platform](test.md#36-platform) check 3b. Without it, "local storage" is a one-way door on the one browser the helper exists for |
| X-19 | The sidebar's type is a fifth larger than the page beside it | ✅ | `.sidebar-text` and `.sidebar-note` in `src/app.css`, read by `src/ui/Shell.svelte` and `src/ui/SidebarLinks.svelte`. One rule rather than a size named per component, and unlayered so it wins over the `text-sm` it replaces — the icons scale with it so the column keeps its proportions |
| X-20 | The sidebar's width is dragged by its right edge, and the width is this device's own | ✅ | `src/ui/WidthGrip.svelte` over `sidebarWidth` in `src/app/view-state.svelte.ts`, bounded there rather than at the grip. Pointer events, for T-14's reason — a tablet is wide enough for the `md` layout and has no mouse. Above `md` only: below it the sidebar is a drawer over the page, where a width takes room from nothing. `view-state.svelte.test.ts`, `scripts/ui-smoke.mjs` |
| X-21 | Above `lg`, a note opens **beside** the list it was opened from rather than instead of it, and the list beside it is the nearest ancestor that is **not** a note — a note nested under a note opens in the pane and leaves the left column where it was | ✅ | `src/ui/App.svelte` composes the two panes; the right one is `src/ui/NotePane.svelte` and the left is `src/ui/NodePage.svelte` on `listAbove` in `src/core/tree.ts`, which is T-6's resolved parent walked up past every note. One route still — [§10.3 A note beside the list](#103-a-note-beside-the-list) |
| X-22 | Below `lg`, that same route lays the note **over** the list as a sheet, as tall as its own content and never taller than 60% of the viewport; a second tap anywhere on it opens it fully | ✅ | `src/ui/NotePane.svelte`. The height is a `max-height` over content height rather than a measurement, so "short enough shows all of it" is one CSS rule and no arithmetic. The peek is covered by one transparent layer, which is what keeps the tap out of the body's always-mounted textarea — B-3 |
| X-23 | A page's column sits at the left edge of the page area rather than centred, whether or not a note is open | ✅ | `src/ui/NodePage.svelte`. A centred column would slide sideways the moment the note pane appeared, so every open and close would move the list the user is reading |
| X-24 | The divider between the list and the note pane is dragged, and the width is this device's own | ✅ | `src/ui/WidthGrip.svelte` over `notePaneWidth` in `src/app/view-state.svelte.ts` — X-20's grip with the sign flipped, since the pane's edge is its left one. Above `lg` only: below it the pane is X-22's sheet and its width is the viewport's. `view-state.svelte.test.ts`, `scripts/ui-smoke.mjs` |
| X-25 | The sidebar's type size is a four-step choice on the settings screen: normal, a fifth smaller, a fifth larger, two fifths larger | ✅ | `src/core/sidebar-size.ts` is the catalog and `src/app.css` holds one `--sidebar-type` multiplier per id, applied by `src/app/sidebar-size.svelte.ts` as `data-sidebar-size` on the document root. It scales X-19's two type rules and the icons beside them and nothing else — not the column's width, which is X-20's and stays where the grip left it. Device-local and set before the first paint, for X-14's reasons. `sidebar-size.test.ts`, `scripts/ui-smoke.mjs` |
| X-26 | The add group is pinned to the top of the list's column, so it stays on screen however far the list is scrolled | ✅ | `src/ui/NodePage.svelte` — `sticky top-0` over the page's own surface, which is the same argument K-8 made for leaving the end of the list and made once more against the top of a page that scrolls away. It costs no measurement and no scroll listener |
| X-27 | On a phone the add group **is** the top bar: the bar that carried the application's name carries the line and its two buttons instead, and the name is gone | ✅ | `src/ui/Shell.svelte` takes the group as a snippet from `src/ui/App.svelte`, which fills it only on the routes that draw a list; `src/ui/NodePage.svelte`'s own header is `md` and up, so the group is drawn once at either width. The bar is `sticky` for X-26's reason — `scripts/ui-smoke.mjs` drives both widths |
| X-28 | The link in the sidebar's top corner is named for the page it opens — `All` — rather than for the application, and the root is called that everywhere it is written to a person | ✅ | `src/ui/Shell.svelte` for the corner and `src/ui/NodePage.svelte` for the head of the page; `src/ui/Breadcrumbs.svelte`, `src/ui/DonePage.svelte`, `src/ui/SearchPage.svelte` and `src/core/log-view.ts` are the four places a path names the root, and they say the same word. It was `All lists` until the nav grew entries beside it — one word keeps the corner a corner. `log-view.test.ts`, `scripts/ui-smoke.mjs` |
| X-29 | The sidebar scrolls in its own column: a page long enough to scroll moves the list and leaves the sidebar whole, and the sidebar scrolls itself when its own entries outgrow the window | ✅ | `src/ui/Shell.svelte` — the shell is one `h-dvh` row holding two scrollers rather than one document that scrolls entire. The nav has been `overflow-y-auto` since X-2 and never got the chance to use it; what it lacked was a column the height of the window rather than of the page — `scripts/ui-smoke.mjs` |
| X-30 | Putting the caret in a **note** row's title raises that note in the pane, and the list beside it does not move: a caret is not a navigation, so the route, the history and the left column are exactly where the reader left them. A caret in a folder's or a task's title leaves the pane as it is; the ✕ and a navigation are what end it | ✅ | `src/ui/panes.ts` derives both panes from the route and `RowFocus.noteId`, which only a note's title ever writes, and `src/ui/App.svelte` composes them as it already did. Above `lg` only — below it the pane is X-22's sheet, and a sheet raised by typing would cover the row being typed. How the pane was opened changes exactly one thing, the ✕: a link out of the route, or a button that clears the caret's note — [§10.3 A note beside the list](#103-a-note-beside-the-list). `panes.test.ts`, `focus.svelte.test.ts`, `scripts/ui-smoke.mjs` |
| X-31 | The note pane is an editor and nothing else: the add line and its two kind buttons are its top row, the body takes whatever height is left under the title and scrolls inside itself when the note outgrows it, and neither a path above the note nor the note's own children are drawn in it | ✅ | `src/ui/NotePane.svelte` — `src/ui/QuickAdd.svelte` in the header row `src/ui/Breadcrumbs.svelte` used to hold, and `src/ui/NoteBody.svelte` given `fill`, which is the height the pane has instead of the `min-h` floor a page's body needs. Nothing is lost with the children: the list beside the pane draws the whole subtree, so they are on screen one level in under the note's own row, and a row added here appears there — K-4. `scripts/ui-smoke.mjs` |
| X-32 | The `All` link in the sidebar's corner is a full-width target, exactly like the entries under it | ✅ | `src/ui/Shell.svelte` — the corner and G-7's two day lists and R-8's third are one column of full-width links with one padding, rather than a corner sized to its four letters with a row of links under it. The `✕` that closes the drawer sits beside it and is drawn below `md` only, which is the one width where the corner is not the whole row |
| X-33 | The keyboard reference lives on the settings screen, and nowhere else | ✅ | `KEY_HELP` in `src/ui/keyboard.ts`, rendered by `src/ui/SettingsPage.svelte` beside the bindings it describes; `keyboard.test.ts` fails if the two drift. It is the same kind of thing as everything else X-12 gathered — a fact about how *this* device is driven — and a reference read once does not belong under a control opened ten times a day — [§3.1 Keyboard (desktop)](#31-keyboard-desktop) |
| X-34 | The row `⋮` menu carries a row's edits and nothing else: no keys printed beside them, no caret hints under them, and none of the four reorderings a drag already does | ✅ | `menu` on each `RowAction` in `src/ui/actions.ts`, filtered by `menuActions` and rendered by `src/ui/RowMenu.svelte`. Indent, outdent and the two nudges stay defined there because `src/ui/keyboard.ts` resolves a key through the same list — they left the menu, not the app. `actions.test.ts`, `scripts/ui-smoke.mjs` |
| X-35 | Two of the theme's fourteen tokens are also a free choice on this device: the **theme colour**, which is the accent, and the **text colour**, which is the ink. Either is found in the system's colour picker or typed as a hex code, either is cleared back to whatever the chosen theme says, and both sit on top of any of the six themes rather than replacing one | ✅ | `src/core/colour.ts` is the parser and `src/app/theme-colour.svelte.ts` puts a pick on the document root as `--accent-pick`/`--ink-pick`; `src/app.css` holds what a pick *means*, deriving `accent-soft`, `ink-muted` and `ink-faint` by mixing the picked colour into the theme's own surface, so one colour still reads in a dark room. Device-local and applied before the first paint, for X-14's reasons — [§10.1 Themes](#101-themes). `colour.test.ts`, `scripts/ui-smoke.mjs` |

**A phone's top bar holds the add group rather than the application's name — X-27.** The bar existed to carry a `☰` and
said `Checklist` beside it, which is a thing to read once on an application with one tree in it: every screen it
appeared on was already this application, and the name is on the icon that opened it. The row is the scarcest one on the
layout — X-26 pins it, so whatever is in it is on screen for the whole session — and the control the app is mostly used
for is what earns it. Above `md` the page header carries the group as it always did and the bar is not drawn at all, so
the group exists once at either width rather than twice with one hidden.

**The sidebar scrolls apart from the page — X-29.** The shell was one column of markup as tall as whatever was in it, so
a list long enough to scroll made the *document* scroll, and the sidebar — a flex child of that document — was as tall
as the list and went up with it. The nav inside it already asked for `overflow-y-auto` and never reached it: an element
given the page's height never overflows. The fix is the height, not the overflow: the shell is `h-dvh` and clips, the
sidebar and the page area each scroll inside it, and the two are now independent in both directions — a scrolled list
leaves the nav in place, and a nav with more entries than the window has room for scrolls without moving the list. It is
also what X-26's pinned add group and the note pane's `sticky` edge were always drawn against: both now stick to the
column they live in rather than to a window the page slides under.

**The corner says where the link goes — X-28.** It said `Checklist`, which was the application naming itself in the one
place a person looks to find their way back to the top of the tree. Two words for one destination is one word too many,
and the one worth keeping is the one that describes the destination: the application's name is on the icon that launched
it and on the screen that installed it. It is the same link, the same drawer close and the same type size — X-27 took
the name off the phone's bar for the reason this takes it off the corner.

The word is now `All` rather than `All lists`, and it changed in six places at once rather than in the corner alone: the
page's own heading, the breadcrumb that starts every path, the two views that print a row's path (Done and Search) and
the log line that names a parent. A root with two names would be two places, and the corner is the one entry with
something under it — `Today` and `Tomorrow` sit below it now, and a corner that is longer than what it holds reads as a
heading rather than as a link.

Packaging decides which of these are reachable, and it answers them per target rather than once — see
[architecture.md §7 Packaging](architecture.md#7-packaging). X-3 in particular is a PWA install on Chromium and an APK
on Android, but a desktop shortcut on Firefox, which does not install PWAs.

X-12 is what makes X-13 cheap rather than a fourth nav entry: appearance is a device's own taste, the device's name is a
device's own statement about itself, and its log is a device's own record — three things that had no home between them
and now share one.

**The entry sits in the sidebar's footer, and the footer says nothing else.** The nav above it lists places in the tree,
and this device is not one of them — an entry among them reads as another list. The corner is where an application puts
the thing that is about the application, and it is the corner this device's readout was already occupying: the name, the
folder and the peer count sat there as three lines of small text that could be read but not acted on. Every one of them
is on the screen behind the entry, saying more than a line could — the folder with the buttons that open it, the name in
the field that sets it, the count as a link to the list. What stays in the corner is the one control that must be
reachable from every page (the S-19 refresh) and the one line that is a warning rather than a readout —
[§10.2 The sync folder, on the settings screen](#102-the-sync-folder-on-the-settings-screen).

### 10.1 Themes

**A theme is fourteen semantic tokens and nothing else.** `src/app.css` names roles — `surface`, `surface-sunken`,
`surface-raised`, `line`, `ink`, `ink-muted`, `ink-faint`, `accent`, `accent-soft`, `danger`, `scrim`, and A-2's three
flags `flag-low`, `flag-medium`, `flag-high` — and every component spells a role rather than a colour. A theme is
therefore one block of fourteen custom properties under a `[data-theme='…']` selector, and adding a seventh theme is
that block plus one line in the catalog. No component changes, and none ever can: a component that named a colour would
be the bug.

**The three flags are tokens for the same reason `scrim` is.** "Green, yellow, red" is a meaning rather than three
colours: the green that reads as low priority on the light surface is invisible on the dark one, and the yellow that
reads as medium beside a blue accent competes with a warm one. Each palette picks its own three, and the meaning is what
stays fixed — a component asks for `flag-high`, never for red.

| ID | What it is |
| --- | --- |
| `light` | The palette the app shipped with, and the default for a device that has never chosen |
| `dark` | The same roles inverted — a dark surface with light ink, not a filter over the light one |
| `green`, `teal` | Cool tints: a tinted surface and an accent from the same hue family |
| `orange`, `yellow` | Warm tints, where `danger` moves off red's neighbourhood so the destructive action is still the one that reads as destructive |

Two constraints on any palette, and they are why the list is not longer:

**`ink` on `surface` must stay readable, and `danger` must not read as `accent`.** A warm accent and a red danger sit
close enough on the wheel that a careless yellow makes "Delete" look like a link, which is why the two warm themes move
`danger` rather than only shifting the accent.

**A role that is a *relationship* cannot be derived from another token.** `scrim` — what the phone's drawer lays over
the page — was `ink` at 20% until the dark theme existed, and under a dark palette that is a white veil that brightens
what it is meant to dim. It is a token of its own because "darken whatever is behind this" is a role, and no arithmetic
on `ink` expresses it in both directions. `color-scheme` is the same argument for the things CSS does not own: a
scrollbar, a caret and a form control's default read the browser's own setting, so the dark palette declares it.

**A theme never changes a layout, a size or a font.** Switching one repaints and moves nothing, so it cannot become a
second UI to test — [test.md §3.5 UI](test.md#35-ui) drives one theme for behaviour and checks the rest for contrast
only.

**Two of the fourteen are also a free choice — X-35.** A palette is fourteen decisions somebody else made, and two of
them are the ones a person wants back: the colour the app is *in* — the accent, on every link, the selected entry, the
focus ring and the add button — and the colour it is *written in*. Both sit on the appearance screen as a swatch that
opens the system's colour picker, with a hex field beside it for a colour that is already written down somewhere, and a
control that appears once one is set and clears it back to the theme's own. A pick is not a seventh theme and never
becomes one: it sits **on top of** whichever of the six is chosen, so dark is still dark under it and the six swatches
still preview themselves rather than the pick.

**A pick re-points two tokens and derives three more.** `accent-soft`, `ink-muted` and `ink-faint` are relationships
rather than colours — a wash behind accent text, and two steps of quiet away from the ink — so they are mixed out of the
picked colour and the theme's own `surface` rather than picked in turn. That mix is what makes one colour work in a dark
room as well as a light one: it moves toward whatever is behind it, so the same number gives a paler `ink-faint` on the
light surface and a dimmer one on the dark. The other nine are the theme's and stay untouched, `danger` above all: the
rule that it must not read as `accent` now has a control able to provoke it, and the answer is that a pick cannot reach
it.

**Nothing refuses a colour, and nothing checks the contrast.** A validator here would be a second opinion about a screen
it cannot see, in a room it knows nothing about, and it would have to be wrong in one of the two directions. What the
screen offers instead is immediacy and a way back: the app repaints under the picker as the colour moves, and the pick
is cleared with one control that is only drawn while there is something to clear.

The choice does not sync, and that is the point rather than a limitation: the phone is read in bed and the laptop in an
office, and a preference that converged across them would be one the user has to fight on whichever device they are not
holding. It is `localStorage`, beside the collapse state (T-8) that is device-local for the same reason. The screen no
longer says so under the swatches — that was a sentence read once and then re-read by everyone who came back to change a
colour, and [§10.2 The sync folder, on the settings screen](#102-the-sync-folder-on-the-settings-screen) is where what
this device shares is actually described.

### 10.2 The sync folder, on the settings screen

X-12 gathered what is about *this device* rather than about the tree, and the folder is the oldest thing on that list:
it is chosen once, on the setup screen, and then never mentioned again except as a line in the footer. X-15 and X-16
give it a section — what this device writes to, how to look inside it, and how to point the device somewhere else.

**Opening a folder is not something the folder adapter does.** The adapter is three methods and stays three —
[code-standard.md §3 Module boundaries](code-standard.md#3-module-boundaries) — so the two buttons are a separate,
optional capability of the *shell*, and each shell answers for itself:

| Shell | Open the folder | Point at another folder |
| --- | --- | --- |
| Android (`android-folder`) | The system's file viewer, on the granted tree | The system picker, then a reload |
| Windows helper (`http-folder`) | The desktop's own file manager, from the process that already holds the folder | Not offered: the launcher's `--folder` decides, and the screen says so |
| Chrome/Edge (`fsaa-folder`) | Not offered: a page holds a directory handle, not a window | The File System Access picker, then a reload |
| Local storage (`local-folder`) | Nothing to open — there is no folder | The picker, where the browser has one. A folder the *shell* is holding was taken at startup and never reaches this screen — X-18 |

A button that a shell cannot honour is absent rather than disabled-with-a-tooltip: the row above it already says what
this device reaches its folder through, so an absent button reads as "not here" rather than as a fault.

**Changing the folder reloads the page, and takes nothing with it.** The rows already written are in the old folder; the
new one is read from scratch on the way back up, exactly as a new device reads it. That is stated on the screen before
the picker opens, because it is the one thing on this page that can lose work.

**"Local storage" must not be a one-way door — X-18.** That last row used to read "the picker, where the browser has
one", and on Firefox the browser has none: a device that answered "use local storage" on the setup screen could never
answer anything else, however much became reachable afterwards. The way in is easy to fall through — launch the helper
once with no `--folder`, or open the page before setup has run, and the browser-only button is the only one the setup
screen offers — and there was no way back out. Firefox is precisely the browser the loopback helper was written for, so
the folder was usually sitting right there, held by the process that served the page, while the screen said "this
browser cannot open a folder at all" — true of the browser, false of the device.

**The fix is not on this screen, and that is the point.** It was drafted here, as a button offering the folder the
helper is holding, and that was the wrong altitude: startup already asks the shells that question, so a device that has
to be *told* to take the folder is a device that was asked the wrong question. `local` is not a folder — it is the
absence of one — so a shell holding a folder now outranks it, and the device takes it on the next load with nothing to
press: [architecture.md §4 The folder adapter](architecture.md#4-the-folder-adapter). This screen keeps the picker for
the browser that has one, and nothing else changed on it.

**Nothing is written when the shell's folder is taken.** The stored `local` stays, so a device that later runs without
its helper falls back to the browser rather than to a setup screen, and the rows it wrote there are still in
`localStorage` for it to find. Those rows do not follow it to the folder — the same rule every other folder change obeys
— which is the one cost of doing this without asking, and it is the cost of the fallback itself rather than of the fix.

**The screen no longer names a cloud app at all — X-17 is withdrawn.** It named one for one reason: a button that
started the client keeping this folder in sync, for the times when "why has my phone not seen that row" is "the client
has not run today". Behind that button were a catalog of six providers, a stored label on every device, a launch
capability in both shells, and a `<queries>` block in the Android manifest naming six packages — and nothing else in the
app ever read any of it, because nothing else may: no merge, no adapter and no file knows which provider is under the
folder ([§7.3 Fixed constraints](#73-fixed-constraints)). The phone's own launcher starts that app, and the desktop's
own taskbar does, so the app was carrying a catalog of other people's software to save one tap outside itself. The
folder rows above it are what this section is actually for, and they say what this device reaches and how far it has got
— [past_decision.md §16 Retiring the cloud-app launcher](past_decision.md#16-retiring-the-cloud-app-launcher).

### 10.3 A note beside the list

A note used to take the screen. Clicking one navigated to its page, the list it was clicked from went, and getting back
was the breadcrumb or the Back button — two navigations to read one line of a note that belongs to the list you were
already looking at. That is the wrong trade for the one kind of row that is *read* rather than ticked: a folder is
somewhere you go, and a note is something you look at while staying where you are.

**The route is unchanged and the composition is not.** `#/n/<id>` still names one node, still deep-links, still survives
a cold launch (X-8). What changed is what the application draws for it when that node is a `note`: the note, and the
page of its resolved parent (T-6) beside it. The second pane is *derived* rather than remembered, which is the whole
reason there is no new route and no new state — the list on the left is a function of the note on the right, so a link
pasted into another device opens the same two panes, and Back closes the note by leaving the route exactly as it always
did.

**Only a note splits.** A folder is a list, and a list beside a list is the same drawing twice, one of which is always
the narrower — the argument T-10 already made against the sidebar carrying the whole tree. A task has no page to open.
So the split exists exactly when the route's node has `kind === 'note'`, and every other route renders as it did.

**The left pane is the nearest ancestor that is *not* a note — X-21.** A note nested under a note is opened from the
tree on the left, which draws it under the note it belongs to, and the pane is where it opens: the left column keeps the
list it was already showing rather than becoming the parent note's page. Drawing the parent note there instead was the
first reading and it was wrong twice over. It puts a second body on screen — a second editor, with its own K-7 debounce
and its own caret, for a note nobody asked to edit — and it moves the list under the pointer on every step down, which
is the jump X-23 exists to prevent. So walking down a chain of notes moves one pane, and the tree the chain hangs in
stays exactly where it is. The nested note is still reachable and still highlighted on the left, because the tree draws
the whole subtree rather than one level (T-10 is the sidebar's rule, not the tree's).

**The divider between the two is dragged — X-24.** The pane is the second column with a share of the width worth arguing
about, which is X-20's question asked a second time, and it gets X-20's answer: pointer events for T-14's reason, bounds
in `view-state.svelte.ts` rather than at the grip, `localStorage` rather than a file
([§2.3 What is never in the Sync Folder](#23-what-is-never-in-the-sync-folder)), and above `lg` only — below it the pane
is the sheet and its width is the viewport's. It is one component at both edges with the sign flipped: the sidebar's
grip is on its right edge and widens as it goes right, the pane's is on its left edge and widens as it goes left.

**What stops it is the window, and the list keeps a strip rather than a column.** The pane may take everything the
window has that is not the sidebar and is not 176px — X-20's own minimum, the width below which a title is a truncation.
A fixed ceiling was the first cut and it was the wrong question twice: a number generous on a laptop is a third of a
monitor, and reserving a *readable* 320px column for the list assumed the list was still being read. It is not — it is
behind the note, and what it owes the reader while a note is open is somewhere to click back to. The note long enough to
want the width was exactly the note that could not have it.

**Above `lg` it is beside, below `lg` it is over — X-1 with a breakpoint, not a second application.** The phone has no
room for two columns, so the same pane becomes a sheet on the bottom edge with the list still behind it.

**The breakpoint is `lg` and not X-2's `md`, because the two are different questions.** X-2 asks whether there is room
for a column of *navigation* beside the page, and 768px has that. X-21 asks whether there is room for two columns of
*content*, and 768px does not: the sidebar takes 256 of it and a two-fifths pane takes another 300, leaving the list
less width than one of its own rows needs. A tablet in portrait therefore gets the sheet, which is the right drawing for
it anyway — one column of content, and the note over it.

What the sheet adds is a height rule and a second tap:

- **As tall as the note, and never taller than 60% of the viewport.** This is `max-height` over an auto height, so a
  note short enough to fit is shown whole and a long one is cut at 60% — the requirement "how much is shown depends on
  the length" is a CSS rule rather than a measurement, and nothing has to be re-measured when a peer's edit changes the
  body under it (X-10).
- **The peek is not the editor.** A peek is covered by one transparent layer that swallows the tap and opens the sheet
  fully. Without it the tap would land in the body's textarea — which B-3 keeps mounted and transparent precisely so
  that a click reaches it — and the phone would put a caret and a keyboard into text the user can only see 60% of. One
  layer over the whole sheet is also what makes "the content or the header" one target rather than two: everything on
  the peek means *open this*, except the control that closes it.

**Expansion is not a route and not a stored preference.** It is one boolean in the pane, reset when the pane's note
changes, so every note opens at its own peek and no note remembers being expanded on some other device — the same
argument [§2.3 What is never in the Sync Folder](#23-what-is-never-in-the-sync-folder) makes about the collapse state,
one step further: this one does not even persist locally, because a peek is a gesture rather than a setting.

**The list stops being centred — X-23.** A centred column moves sideways whenever the space around it changes, so
opening the note would shift the list under the pointer and closing it would shift it back. Left-aligned, the list is
where it was before the note opened and where it will be after, and the note pane is what appears and goes. That is why
X-23 says "whether or not a note is open": a rule that only applied while the pane was there would be the jump it exists
to prevent.

**The caret opens it too, and nothing moves — X-30.** The icon on a row is a link and behaves like one: it changes the
route, and the left column becomes the nearest list above the note, which is the list being read only when the note is a
child of it. A caret is not a link. Typing in a row's title is done *inside* the list the reader already chose, and the
note under the caret is what they are touching rather than somewhere they are going — so the pane follows the caret and
the route does not move at all. The left column stays the list the route names, which is X-23's argument made a second
time: the thing that appears is the pane, and nothing else on screen answers it.

**The caret raises a note and nothing else lowers it.** A caret in a `folder`'s or a `task`'s title is not a caret in a
note, so the pane stays exactly as it was: ticking a task beside an open note is not a request for the note to go, and a
walk down a list with the arrow keys would otherwise flick the pane open and shut on every note it passed. `RowFocus`
therefore carries two things — the row holding the caret, which the keyboard model already needed, and the note that
caret is in, which only a note's title ever writes. The pane is that note, or the note the route names when no note has
held the caret; one derivation over the two, with no stored pane and no second route, so
[past_decision.md §14.1 The options](past_decision.md#141-the-options)'s costs are not paid a second time.

**The caret leaving the title is not the caret leaving the note.** The note is set when a title takes the caret and is
never cleared when it loses it, and the pane needs exactly that: clicking into the note's own body blurs the row's
title, and a pane that closed on blur would close under the click that was about to edit it. Two things end it, and only
two. The ✕ — which is the one control that differs by how the pane was opened, because a caret-raised pane is on no
route to leave, and clearing it falls back to the route's note where there is one. And a navigation, because a
navigation is the reader choosing what is on screen: the route decides both panes again, so a note raised on the page
being left does not follow them to the next one, and what is drawn after it is what a reload would draw.

A note that stops being one closes the pane too, and that is the derivation rather than a rule of its own: a peer's
delete (T-7) and a kind change from the row menu (K-5) both leave the caret pointing at something that is no longer a
note, and neither goes anywhere near the caret to say so.

**Above `lg` only.** Below it the pane is X-22's sheet over the list, and a sheet raised by putting a caret in a title
would cover the row being typed into with the phone's keyboard under it. The icon still opens the sheet there, because a
tap on a link is somewhere the reader asked to go.

**The pane is an editor, and only that — X-31.** It opened as the note's page redrawn in a column: a path, the title and
its flag, the tags, the body, then the add line and the note's own children under it. Three of those five were the
list's job. The path is one — the left column *is* where the note sits, drawn as the rows it sits among, so a breadcrumb
over the pane said in words what was already on screen in rows, and said it in the one place a second navigation could
only take the reader away from the note. The children are another: the tree beside the pane draws the whole subtree, so
they were on screen twice, in two lists that scrolled apart and disagreed about which one a drag belonged to. And the
body was the loser of both — a `min-h` floor five lines tall with half a window of nothing under it, in the pane the
reader opened to write in.

So the pane draws the title, the tags and the body, and **the body takes the height that is left, and scrolls in place**
— a note longer than the pane moves inside the field rather than growing it and pushing the title off the top. That is
`fill` in `NoteBody`, which is the pane's own height rather than a floor: above `lg` the pane is `h-dvh` and the field
ends where the pane does, and on the sheet there is no free space to distribute, so X-22's "as tall as the note" is
untouched and the floor is what the peek still gets. Two things follow from the field having a scrollbar of its own. Its
height is one expression rather than a `class:` toggle beside it, because a `class:` directive removes the class its
condition denies whatever the string said — the first cut left the height on B-3's overlay alone, and the field the
caret arrived in was two rows tall. And the rendered half is scrolled to match the field on every scroll, because B-3
draws one value in two boxes and the transparent one is on top: the wheel reaches the field, and a view that stayed put
would show a note frozen at its first screenful. K-4 is untouched as well — a note owns children exactly as it did, the
ops are the same ops, and this settles only where they are drawn.

**The add line takes the row the path left.** K-8 put it immediately above the children it adds to, which was the right
answer while the children were in the pane; with them on the left it would be an input above nothing, and "under the
body" is now the bottom edge of a field that fills the pane. The top row is where the group already lives on a phone
(X-27) and at the head of a list page (K-10), so it is the same group in the same place, and it makes what it always
made: a last child of the note, drawn one level in under the note's own row in the list beside it.

### 10.4 The sidebar's type size

X-19 settled that the sidebar reads a fifth larger than the page beside it, and settled it as one number for every
device. X-25 makes that number a choice, in four steps: **normal** is X-19's, **small** is a fifth under it, **large** a
fifth over, and **maximal** two fifths over. The sidebar is navigation aimed at from across a desk, and how far away
that desk is differs by device — the laptop is at arm's length, the phone is held, and neither of those is the monitor
across the room the app is glanced at on.

| Id | Multiplier | `sidebar-text` | `sidebar-note` | The icon beside them |
| --- | --- | --- | --- | --- |
| `small` | 0.8 | 0.84rem | 0.72rem | 0.96rem |
| `normal` | 1 | 1.05rem | 0.9rem | 1.2rem |
| `large` | 1.2 | 1.26rem | 1.08rem | 1.44rem |
| `maximal` | 1.4 | 1.47rem | 1.26rem | 1.68rem |

**It is one multiplier, not four sets of sizes.** `--sidebar-type` is a number on the document root, and X-19's rules
became `calc(1.05rem * var(--sidebar-type))` rather than gaining a variant apiece. That is X-19's own argument carried
forward: one rule rather than a size named per component, so a fifth step is one CSS line and no component change. The
icons joined the rules for the same reason — `size-[1.2rem]` was a literal written out five times across the two sidebar
components and is now `.sidebar-icon`, which multiplies like everything else, so the column keeps the proportions X-19
gave it at every step. The same literal elsewhere — a row's icon, the Done view's — is untouched: this setting is about
one column, not about every icon in the app.

**The type only, never the width.** The column's width is X-20's and is dragged; changing it here would move a divider
the user placed by hand, and on a phone it would resize a drawer that takes room from nothing. The two are independent
on purpose: `maximal` in a narrow column truncates more titles, and that is the reader's trade to make with the grip
that is already there. A device that wants both makes both gestures.

**This is not a theme, and cannot become one.** [§10.1 Themes](#101-themes) holds a theme to fourteen colour tokens and
says a theme never changes a layout, a size or a font. A size setting that rode on `data-theme` would break that in one
move and cost the smoke run its "no theme moves anything" check, so it is a second attribute with a catalog and a class
of its own. The two are read from the same boot line in `index.html` and are otherwise strangers.

It is `localStorage`, never a file, for X-14's reason exactly: the phone is read in bed and the laptop in an office, and
a size that converged across them would be one the user has to fight on whichever device they are not holding. It is set
before the first paint by the same boot line the theme uses — a sidebar that renders at normal and then jumps to maximal
is the reflow that boot line exists to prevent, and it costs one more line to prevent it here too.

The four buttons on the settings screen each carry `data-sidebar-size` themselves, so each one previews the step it
names in the sample inside it — X-13's swatch, applied to type rather than to colour.

## 11. Import, export and backup

_Not written yet._

## 12. Accessibility

_Not written yet._

## 13. Performance budget

_Not written yet._

## 14. Engineering constraints

_Not written yet._ Expected to cover: the no-server rule, the three-method adapter boundary, the logic layer rule from
[architecture.md §3 The layer model](architecture.md#3-the-layer-model), and the code standard in
[code-standard.md](code-standard.md).

## 15. Deviations and defects found during verification

What M1, M2 and M3 leave standing, in the order it matters. Every row here but the last is a deliberate gap rather than
a discovered bug — `npm test` and `npm run ui-smoke` both pass. Row 11 is the exception: a defect found by running the
Windows bundle in Firefox, fixed rather than accepted, and the reason X-18 exists.

| # | Deviation | Why it stands |
| --- | --- | --- |
| 1 | No provider's client has ever been under the folder | Every merge case is exercised against a folder adapter, and the `fsaa`, `http` and `android` adapters are the same three methods as the ones that are. What is unobserved is latency, partial files and a client's opinion of the folder — and it stays unobserved until the Windows and Android builds exist, which is [sync-flow.md §7 What is still open](sync-flow.md#7-what-is-still-open) item 5 |
| 2 | T-5's refusal has no UI that can provoke it | **Closed by M5.** The drag of T-14 is the move-to gesture this row was waiting for: dropping a row into the middle of one of its own descendants is exactly the move `canMoveTo` refuses, and the drop is drawn as refused rather than written and undone |
| 3 | X-3 and X-4 are verified in a browser, not on a device | An install and a launcher icon cannot be asserted from WSL — [test.md §3.6 Platform](test.md#36-platform) carries them as a written checklist |
| 4 | The `fsaa` adapter is outside the conformance suite | S-18. A directory handle needs a picker and a real user gesture, so no headless run can hold one. Its three methods are the thinnest of the six, and the folder grant is on [test.md §3.6 Platform](test.md#36-platform)'s checklist |
| 5 | Compaction never shrinks a **peer's** file | S-14 compacts this device's own ops and no others, because one writer per file (S-3) allows nothing else. A peer that stops running keeps its log at the size it died at, forever. Every running device shrinks, which is the whole of the growth problem in practice |
| 6 | `local-folder` has no quota story | A `localStorage` quota failure is reported and the ops stay queued, so nothing is lost in the session. Compaction makes it arrive later rather than never |
| 7 | Restoring reverses a delete; it does not reverse a compaction | T-13 is built. What a restored row comes back with is the state the surviving ops fold to, which after a compaction is the last value of each field rather than the whole history — the same thing every other read gets |
| 8 | Two tabs on one origin are one device with two writers | The device id is per-origin, so both tabs write `checklist.<same-id>.ops.jsonl` from separate in-memory logs, and the one that flushes second replaces the other's file. Nothing is lost while both tabs live — the next write from either restores its own ops — but a tab closed without flushing loses what only it had. It is one-writer-per-file (S-3) broken by the browser rather than by the code, it predates M2, and the fix is a lock between tabs rather than anything in the merge. **Compaction makes it sharper**: the second tab's write can restore ops the first tab had already compacted away, so the file grows back. It converges and loses nothing; it merely undoes the saving until both tabs agree |
| 9 | A device with no name is still eight hex characters | **Closed by D-5.** A device now names itself on its first write — `Win-Chro-a3f1`, from the platform, the browser and the first four digits of its own id — so the list and the conflict rows start from something readable and the typed name is an improvement on a name rather than the only one there is. Eight hex characters survive in one place: a peer whose build predates D-5 and that nobody ever named |
| 10 | The Windows and Android bundles are built but unobserved | `make windows` and `make apk` produce them — [architecture.md §7 Packaging](architecture.md#7-packaging) — which is what row 1 was waiting for. Running them against a real provider's client is still [test.md §3.6 Platform](test.md#36-platform)'s checklist and has not been done |
| 11 | The Windows bundle in Firefox showed "This browser only — not synced" while the helper beside it held the folder | **Found in use, fixed by X-18.** Not a Firefox bug and nothing to do with the adapter: the device had a stored choice of `local` from a launch that had no folder yet, that choice outranked every shell at startup, and the only way out on offer was the File System Access picker — which is the one thing Firefox does not have, so the screen said "this browser cannot open a folder at all" and meant it. Edge was unaffected because it had answered the setup screen with a picked folder instead. The fix is one line of precedence rather than a new button: `local` is the absence of a folder, so a shell holding one now outranks it — [architecture.md §4 The folder adapter](architecture.md#4-the-folder-adapter) |

## 16. Explicitly out of scope

Backlogged deliberately, not overlooked: dynamic lists, Google Calendar sync, recurring tasks, reminders and
notifications, attachments, dates and quick add, sharing or multi-user, and any form of application server or hosted
database.

Themes were on this list until M4 and are now X-13. What took them off it is that the shell had always spelled roles
rather than colours, so the feature turned out to be a palette per theme and no component change at all —
[§10.1 Themes](#101-themes). What stays off is anything that syncs a preference: a theme is device-local (X-14), and a
converging one is a different requirement with a merge rule attached.

Drag came off the list in the same way at M5 and is now T-14: the tree already moved a row with one `move` op, so a drag
turned out to be a second caller of it rather than a mechanism. What stayed off is a *move-to picker* — a dialog naming
every possible destination is a second navigation to build and to test, and the gesture people reach for is the drag.

## 17. Milestones

| ID | Milestone | Contains |
| --- | --- | --- |
| M0 | Decisions | **Closed.** The payload is an append-only op log per device — [sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision) — and [§2 Data model](#2-data-model), [§8 Device management](#8-device-management) and [§9 Conflict presentation](#9-conflict-presentation) are written. The stack, the packaging and the application shape were already settled — [architecture.md §6 Technology stack](architecture.md#6-technology-stack), [architecture.md §7 Packaging](architecture.md#7-packaging), [past_decision.md §3 State Management](past_decision.md#3-state-management) |
| M1 | Local-first core | **Closed.** The tree, the item kinds, the keyboard model, the shell — [§3 Tree structure and editing](#3-tree-structure-and-editing), [§4 Item kinds and attributes](#4-item-kinds-and-attributes) and [§10 Application shell, PWA, offline](#10-application-shell-pwa-offline), on one device. The store is `src/app/Session.svelte.ts`, the payload is already the real op log (S-21), and what it left standing is [§15 Deviations and defects found during verification](#15-deviations-and-defects-found-during-verification) |
| M2 | Sync | **Closed.** Every device's file read and folded together (`src/core/merge.ts`, `src/app/folder-sync.ts`), the activity-driven cycle (S-19), the conflict nav of [§9 Conflict presentation](#9-conflict-presentation), and the adapter set — `fsaa`, `http`, `android` beside the two M1 shipped, chosen by [architecture.md §4 The folder adapter](architecture.md#4-the-folder-adapter)'s flowchart. What it left standing is rows 1 and 4 of [§15 Deviations and defects found during verification](#15-deviations-and-defects-found-during-verification) |
| M3 | Compaction and polish | **Closed.** Compaction (S-14) once its trigger fires, [§6 Search](#6-search), device management ([§8 Device management](#8-device-management)), the restore path T-13 owes the Done view, and the two bundles [architecture.md §7 Packaging](architecture.md#7-packaging) describes — `make windows` and `make apk`. What it left standing is rows 5 and 10 of [§15 Deviations and defects found during verification](#15-deviations-and-defects-found-during-verification) |
| M4 | Settings and appearance | **Closed.** One screen for everything about this device rather than about the tree (X-12), and the six themes X-13 puts behind it — [§10.1 Themes](#101-themes). It moved the D-1 name editor and the D-4 log link onto that screen and took a nav entry away rather than adding one. It changed no component's colours, because no component ever named one |
| M5 | Attributes, the drag and the folder screen | **Closed.** Four features that each turned out to be a caller of something already there: the drag (T-14) over the `move` op M1 wrote, tags and priority ([§4.1 Tags and priority](#41-tags-and-priority)) over the `set` op and the conflict list M2 built, the quick-add line (K-8) over `createLastChild`, and the sync folder section ([§10.2 The sync folder, on the settings screen](#102-the-sync-folder-on-the-settings-screen)) over the shell that already held the folder. It closed row 2 of [§15 Deviations and defects found during verification](#15-deviations-and-defects-found-during-verification) — T-5's refusal has a gesture that can provoke it at last |

| M6 | Fewer things | **Closed.** A milestone that mostly removed: the fourth kind (K-1, `list` folded into `folder` at the decoder), the second control for a kind change ([K-6, withdrawn](#4-item-kinds-and-attributes)), and the sidebar's copy of the whole tree (T-10, one level then; T-17 later gave it a second level that starts closed). The one thing it added is K-9, a pasted paragraph becoming one row per line, which is the quick-add line answering a question it already had the machinery for. Nothing here changed the payload, the merge or the folder |

| M7 | Formatting in a note body | **Closed.** B-1 to B-6 — [§4.3 Bold and headings in a note body](#43-bold-and-headings-in-a-note-body) — bold and two heading levels, as Markdown marks inside the body string. The one milestone so far that adds a feature and changes nothing about the payload: `body` was a string before it and is a string after, so the merge, the conflict rows and compaction never learned that a body can be formatted |
| M8 | A note beside the list | **Closed.** X-21 to X-24 — [§10.3 A note beside the list](#103-a-note-beside-the-list) — a note opens beside the nearest list above it at `lg` and as a 60%-tall sheet over it below, a page's column is left-aligned so nothing moves when it does, and the divider between the two columns is dragged. Like M7 it adds a feature and changes nothing about the payload: no route, no op, no field. The one thing it stores is X-24's width, and that is device-local like every other width here. It is one composition change in `src/ui/App.svelte`, one new view, and one grip that the sidebar now shares |

| M9 | Today and Tomorrow | **Closed.** G-1 to G-7 — [§4.4 Today and Tomorrow](#44-today-and-tomorrow) — two lists that are not the tree, and the first milestone since M6 to touch the payload: one parent that is not a node and one field, `day`. What it did *not* add is a write nobody made — the rollover is a date comparison at read time, so nothing happens at midnight on any device. It also carried T-17's second level in the sidebar and X-28's shorter corner, both of which are what made room for two more nav entries |
| M10 | Timely | **Closed.** R-1 to R-8 — [§4.5 Timely](#45-timely) — a third list outside the tree, for the check items that come back rather than get finished. It is M9's shape a second time and costs almost as little: one more parent that is not a node, one more field (`every`), and a tick that writes the `day` M9 already added instead of writing `done`. Nothing happens at midnight here either — an item is due because a date comparison says so. It also carried X-32, the corner's link taking the width its neighbours already had |

M2 is closed against a folder, not against a provider. The three adapters it added are the three methods every other
adapter already offers, so what remains untested is the client underneath them, and observing that needs a Windows and
an Android build —
[§15 Deviations and defects found during verification](#15-deviations-and-defects-found-during-verification) row 1. M3
builds both, so the observation is now possible rather than done: row 10 is what row 1 became.

M3 closed the compaction cut rule that [sync-flow.md §7 What is still open](sync-flow.md#7-what-is-still-open) carried
as its first item, and it closed it without the snapshot format the milestone was named for —
[sync-flow.md §4.8 The compaction cut](sync-flow.md#48-the-compaction-cut). **Note-body diffing is therefore not built
and is no longer planned**: it was option C applied to one field, and dropping a device's own superseded bodies achieves
what it was for with no second format at all. The condition that reopens it is a measurement —
[past_decision.md §6 Compaction](past_decision.md#6-compaction).
