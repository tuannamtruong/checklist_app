# Requirements

Requirement docs and its current state.

**Milestone M1 is built** — the production tree is `src/`, and every ✅ row below names the file that implements it. Rows
marked `pt.` are proven by running code in `prototype/`, which does not share code with production and is not on the way
to it — the design crosses over, the source does not.

Two commands verify the ✅ rows:

```bash
npm test          # the logic layer, in Node
npm run ui-smoke  # the built app in Chromium: the keyboard model, a reload, a cold start offline
```

Legend:

| Mark | Meaning |
| --- | --- |
| ✅ | done |
| ◐ | partial |
| ✗ | not built |
| pt. | proven in `prototype/` |

Sections marked _Not written yet._ are placeholders: the heading records that the topic is owed, and the content is
still to be decided.

---

## 1. Summary against the stated requirements

| # | Stated requirement | State | Note |
| --- | --- | --- | --- |
| 1 | Folder structure: a tree | ✅ | `src/core/tree.ts`, `src/ui/TreeView.svelte` |
| 2 | Sync between PCs and phones via a cloud file service | pt. | Transport proven for one text field; the tree payload is an append-only op log per device — [sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision) |
| 3 | Lists and sub-lists | ✅ | Nesting is the tree; indent/outdent, drag-free reorder — `src/core/edit.ts` |
| 4 | Either a checklist or a text note | ✅ | `src/ui/NodePage.svelte`, `src/ui/NoteBody.svelte` |

## 2. Data model

A node is a record in the store and a fold of ops on disk. The folder holds ops; the store holds the materialised tree
and never replays per read — [sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision).

### 2.1 The node

| Field | Type | Settles |
| --- | --- | --- |
| `id` | string | Minted by the creating device, never reused |
| `parent` | node id or `root` | Always read through the cycle-repair resolver, never directly — T-6 |
| `parentSetAt` | timestamp | When the move was written. The repair reads it; nothing reads the local clock |
| `parentSetBy` | device id | The device that wrote the move, and the repair's tiebreak when two `parentSetAt` collide — [sync-flow.md §6.2 The repair](sync-flow.md#62-the-repair) |
| `kind` | one of `folder`, `list`, `note`, `task` | K-1. Mutable after the fact — K-5 |
| `title` | string | The row label, every kind |
| `done` | boolean | Tasks only — K-2. Also the T-11 filter: a row carrying it leaves the normal view |
| `body` | string or null | Notes only — K-3 |
| `order` | base-62 string | Fractional index among siblings — T-2 |
| `orderBy` | device id | The device that minted `order`, and the sort tiebreak |
| `deleted` | boolean | T-7. Absence and deletion must stay distinguishable |
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
| `set` | `id` plus the fields that changed — `title`, `done`, `body`, `kind` |
| `move` | `id`, `parent`, `order`; `at` becomes the node's `parentSetAt` |
| `delete` | `id`; tombstones the subtree at read time, per T-7 |

Concurrent writes to one field resolve by `(at, device id)` — newest wins, disjoint fields never interact, and the user
is told rather than asked. `parentSetAt` is that rule's timestamp for `parent`, not a special mechanism.

### 2.3 What is never in the Sync Folder

Device-local state, held in `localStorage` and never written to a shared file: the device id, collapse/expand state
(T-8), the sync cadence setting (S-19), dismissed conflict notices, and any filter the Done view grows (T-12). Anything
the user would not want to converge across devices belongs here rather than in the tree.

The Done view itself is not state. It is a read-time filter over `done` and the T-7 tombstone — derived, so it needs no
sync and no writes.

## 3. Tree structure and editing

| ID | Requirement | State | Where / test |
| --- | --- | --- | --- |
| T-1 | Unlimited nesting of lists inside lists inside folders | ✅ | `src/core/tree.ts`; `tree.test.ts` |
| T-2 | Children render in a stable order every device agrees on | ✅ | `src/core/order.ts`, sorted on `(order, orderBy, id)` — [sync-flow.md §5 Sibling ordering](sync-flow.md#5-sibling-ordering); `order.test.ts` |
| T-3 | Indent (become child of sibling above) / outdent (become parent's next sibling) | ✅ | `src/core/edit.ts` `indent`/`outdent`; `edit.test.ts`, `scripts/ui-smoke.mjs` |
| T-4 | Move up/down among siblings | ✅ | `src/core/edit.ts` `moveUp`/`moveDown`; `edit.test.ts` |
| T-5 | A move that would create a loop is refused | ◐ | `src/core/edit.ts` `canMoveTo`; `edit.test.ts`. M1 has no drag and no move-to picker, so no UI path can attempt one yet. Local check only — it catches one device dragging a folder into its own child, never the merge case, which is T-6: [sync-flow.md §6.1 T-5 is not the loop defence](sync-flow.md#61-t-5-is-not-the-loop-defence) |
| T-6 | A Cyclic tree state (concurrent A→B, B→A) is repaired at _read_ time by re-rooting, never by writing | ✅ | Drop the cycle edge with the oldest `(parentSetAt, device id)` — [sync-flow.md §6.2 The repair](sync-flow.md#62-the-repair) — `src/core/tree.ts` `resolveTree`; `tree.test.ts`. Cannot arise on one device — the tests are the proof until M2 |
| T-7 | Deleting a node tombstones its whole subtree, not just the node | ✅ | The ancestor walk must climb the T-6-resolved parent, or a tombstoned subtree containing a cycle hangs — [sync-flow.md §6.2 The repair](sync-flow.md#62-the-repair) — `src/core/tree.ts`; `tree.test.ts` covers the tombstoned subtree that contains a cycle |
| T-8 | Collapse/expand state is per-device and never synced | ✅ | `src/app/view-state.svelte.ts` — `localStorage`, never a file |
| T-9 | Breadcrumbs show the path back up from any node | ✅ | `src/ui/Breadcrumbs.svelte`, over `ancestorsOf` |
| T-10 | Sidebar shows only containers — `folder` and `list` | ✅ | `CONTAINER_KINDS` in `src/core/types.ts`, read by `src/ui/SidebarBranch.svelte`. A note owns children (K-4) but is a destination rather than navigation, and a task would drown the list outright |
| T-11 | A ticked row is not in the normal view at all — not in its list, not in the sidebar, not in the caret order, and neither is anything it holds | ✅ | The filter is `resolveTree`'s, beside T-7's: `src/core/tree.ts` drops an own-`done` node from `children`, and one filtered set answers all three. The subtree goes with it because nothing walks *into* a row that is not there — but the flag itself is **not** inherited, so a finished row's own page still shows what is inside it, which is what makes T-12's rows worth opening. `tree.test.ts`, `scripts/ui-smoke.mjs` |
| T-12 | One Done view lists every finished row and every deleted row, each with the path it sat on | ✅ | `src/core/done.ts` derives both lists; `src/ui/DonePage.svelte` at `#/done`. Each list names the top of its run, never the descendants. A finished row is un-ticked from here and returns to the tree — an ordinary `set done:false`, so it costs no new op. `done.test.ts`, `scripts/ui-smoke.mjs` |
| T-13 | A deleted row can be restored from the Done view | ✗ | Un-tombstoning needs an op the payload does not have — [§2.2 The op](#22-the-op) has `delete` and nothing that reverses it, and adding one is a change to a decision M0 closed. M1 lists deleted rows and opens them; it does not bring them back — [§15 Deviations and defects found during verification](#15-deviations-and-defects-found-during-verification) |

[sync-flow.md §3 Why a snapshot does not scale to a tree](sync-flow.md#3-why-a-snapshot-does-not-scale-to-a-tree) is why
T-2, T-5, T-6 and T-7 constrain the sync payload, not just the UI.

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

Every one of these also has to exist in the row `⋮` menu, which is where a phone reaches them, and that menu is where
the keyboard list is shown to the user. `src/ui/actions.test.ts` fails if a key ever binds something the menu does not
show, and `scripts/ui-smoke.mjs` checks the same thing against the rendered menu.

## 4. Item kinds

| ID | Requirement | State | Where |
| --- | --- | --- | --- |
| K-1 | A row is one of four kinds: `folder`, `list`, `note` or `task` | ✅ | `src/core/types.ts`. Only a task is checkable; `folder` and `list` are the containers T-10 shows in the sidebar. Kind drives rendering, never structure — any kind may own children |
| K-2 | Tasks render a checkbox; folders/lists/notes render a kind icon | ✅ | `src/ui/Row.svelte`, `src/ui/KindIcon.svelte` |
| K-3 | A note has a long free-text body with its own full-page editor | ✅ | `src/ui/NodePage.svelte`, `src/ui/NoteBody.svelte` |
| K-4 | A note can still own checklist children (heading + items pattern) | ✅ | The note's page renders its body and its children; `edit.test.ts` |
| K-5 | Any row can be converted to any kind after the fact ("Turn into") | ✅ | `turnInto` in `src/core/edit.ts`, in the row menu. Two devices converting one row differently resolve by `(at, device id)`, with a notice — [§9 Conflict presentation](#9-conflict-presentation) |
| K-6 | A note can be promoted to a checklist from its own page | ✅ | `src/ui/NodePage.svelte`; the body is kept, so it is reversible |
| K-7 | Note body saves are debounced (1 s) so typing is not one op per keystroke | ✅ | `src/ui/NoteBody.svelte`. The 1 s debounce governs the store; an **op** is emitted on blur, on navigating away, or after 60 s of continuous editing — S-20 |

Notes are deliberately not checkable. `done` is still a field on every node, because K-5 keeps it across a "Turn into"
so that turning back restores the tick — which is also why T-11's filter reads `done` rather than `kind === 'task'`.

## 5. Navigation and routing

Hash routing, per X-7, so the fragment never reaches a server and the app deploys to a static host, to the loopback
helper and to the Android WebView unchanged. `src/app/router.svelte.ts` holds the whole of it.

| Route | Renders | Where |
| --- | --- | --- |
| `#/` | The root: every top-level row | `src/ui/NodePage.svelte` with no node |
| `#/n/<node-id>` | One node's page — its path, its title, its body if it is a note, and its children | `src/ui/NodePage.svelte` |
| `#/done` | The Done view of T-12: every finished row, then every deleted one | `src/ui/DonePage.svelte` |
| anything else | The recovery page, per X-11 | `src/ui/RecoveryPage.svelte` |

A node id that no longer resolves is not an error state: `#/n/<id>` of a deleted or unknown node renders the recovery
page, which tells deletion from absence because T-7 keeps the two distinguishable. A **finished** node resolves normally
— T-11 hides a row from its parent's page, not from its own — so a row opened from `#/done` gets the page it always had.

Two navigations exist besides the routes: the sidebar (T-10, containers only, and T-11 takes finished ones out of it)
and breadcrumbs (T-9). Both climb the T-6-resolved parent, never the stored one. `#/done` is the third entry in the
sidebar's nav and is always present, because a view that appeared only when it had something in it would be a view the
user could not learn.

## 6. Search

_Not written yet._

## 7. Sync

The transport is proven and the payload is chosen — an append-only op log per device,
[sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision). The design reasoning lives in
[sync-flow.md](sync-flow.md); this section records only requirement state.

### 7.1 Proven in the prototype

| ID | Requirement | State | Where |
| --- | --- | --- | --- |
| S-1 | Every mutation goes through one write path | pt. | `prototype/core/folder-sync.mjs` |
| S-3 | A device writes only paths carrying its own device id, so no two devices write one path | pt. | `prototype/core/device.mjs` |
| S-4 | Merge is commutative, associative and idempotent | pt. | `prototype/core/merge.mjs`; scenario-tested, not property-tested |
| S-5 | Concurrent edits are detected by version vector, never prevented | pt. | `prototype/core/merge.mjs` |
| S-6 | Any device can settle any race, with no leader, quorum or membership | pt. | `prototype/core/device.mjs` |
| S-7 | A half-synced file is skipped and picked up whole on the next cycle | pt. | `prototype/core/folder-sync.mjs` |
| S-8 | A write is never observable in a partial state (temp file plus atomic rename) | pt. | `prototype/adapters/node-folder.mjs` |
| S-9 | A new device joins by writing a file — no registration, no coordination | pt. | `prototype/core/merge.mjs` |
| S-10 | No-op edits are dropped before they reach the log | pt. | `prototype/public/app.js`, and see [prototype/README.md §6.1 Stale state](../prototype/README.md#61-stale-state) |
| S-17 | Multi-device convergence simulator | pt. | `prototype/test/e2e/scenario.mjs` |

### 7.2 Not built

| ID | Requirement | State | Note |
| --- | --- | --- | --- |
| S-2 | A mutation shape that merges at field granularity rather than whole-document | ✗ | Decided — an append-only op log per device: [sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision) |
| S-11 | Upload queue, resumable after interruption | ✗ | May be unnecessary — the folder write is the queue |
| S-12 | Property-based tests for S-4 | ✗ | [test.md §3.1 Merge properties](test.md#31-merge-properties) |
| S-13 | Tree-aware merge: concurrent moves, subtree tombstones, sibling order | ✗ | T-2, T-5, T-6, T-7. Analysed in [sync-flow.md §5 Sibling ordering](sync-flow.md#5-sibling-ordering) and [sync-flow.md §6 Concurrent moves and cycle repair](sync-flow.md#6-concurrent-moves-and-cycle-repair) |
| S-14 | Compaction, so history does not grow without bound | ✗ | Deferred, not blocking. Add the snapshot when total log bytes exceed device count × serialised tree bytes — [sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision). Milestone M3 |
| S-15 | An on-disk encoding that is appendable and diff-readable | ✗ | Decided — JSON Lines, one op per line, after a header line carrying the full vector |
| S-16 | Retiring a device, so a dead replica stops contributing a counter | ✗ | Cosmetic, not correctness: a dead device is dominated and drops out of the maximal set as an ancestor. Advisory `lastSeen` only — [§8 Device management](#8-device-management) |
| S-18 | Adapter conformance suite covering all five adapters | ✗ | [test.md §3.3 Adapter conformance](test.md#33-adapter-conformance) |
| S-19 | The sync cycle runs on activity: the write path *is* the cycle, decaying to window focus and a manual refresh when idle | ✗ | Cadence is device-local and never synced — [sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision) |
| S-20 | A note body is emitted as an op on blur, on navigating away, or after 60 s of continuous editing | ✅ | `src/ui/NoteBody.svelte` and `Session.commitBody`; navigating away is `src/ui/App.svelte`. Not on K-7's 1 s store debounce. Whole-body ops are the dominant growth term, so the emission trigger is what bounds the log |
| S-21 | M1 persists this device's own op log through a folder adapter backed by `localStorage` | ✅ | `src/adapters/local-folder.ts`. M1 has one device and no Sync Folder, but the payload is already decided, so M1 writes the real `checklist.<device-id>.ops.jsonl` and reloads by folding it. M2 swaps the adapter, not the write path — [architecture.md §4 The folder adapter](architecture.md#4-the-folder-adapter) |

### 7.3 Fixed constraints

- No application server, ever. Sync goes through a cloud **file** provider.
- A device writes **only** paths under its own id, so the provider's conflict-copy behaviour never triggers.
- No authoritative clock, for the same reason. Timestamps recorded in a write still order writes identically on every
  device, but a skewed clock can order them against what the user meant — accepted, and costed in
  [sync-flow.md §6.5 Accepted limit](sync-flow.md#65-accepted-limit).
- Provider choice stays behind the three adapter methods so it can be swapped. The default is **MEGA**, matching the
  `Makefile`'s `D:\MEGA\Checklist` and milestone M2; the Dropbox and OneDrive mentions in the prototype's comments are
  historical and settle nothing. Real provider behaviour is not observable until a Windows and an Android build exist,
  and is deferred until then — [sync-flow.md §7 What is still open](sync-flow.md#7-what-is-still-open).

## 8. Device management

A device joins by writing a file and needs no registration (S-9). Nothing removes one, and nothing has to:
[sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision) never prunes a version vector, so a retired device costs
about twenty bytes forever and its stale file is dominated out of the maximal set as an ancestor. What is left is
presentation.

| ID | Requirement | State | Where |
| --- | --- | --- | --- |
| D-1 | A settings screen lists known devices by id, with a name the user can set | ✗ | The name is data and syncs; the id is minted locally |
| D-2 | Each device carries an advisory `lastSeen`, so a dormant one is visible as dormant | ✗ | Advisory only — the merge never reads it |
| D-3 | Nothing in the merge path depends on the device list being complete or current | ✗ | This is what keeps S-16 cosmetic rather than blocking |

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
| C-1 | A genuine race — differing content in the maximal set — asks the user to choose | ✗ | Decision | [sync-flow.md §2.2 The maximal set reduces the whole folder at once](sync-flow.md#22-the-maximal-set-reduces-the-whole-folder-at-once) |
| C-2 | A T-6 repair names the node it re-rooted and offers to jump to it | ✗ | Notice | [sync-flow.md §6.3 The user has to see it](sync-flow.md#63-the-user-has-to-see-it) |
| C-3 | A tiebreak that landed two concurrently inserted rows in device-id order says so | ✗ | Notice | [sync-flow.md §5.3 The tiebreak](sync-flow.md#53-the-tiebreak) |
| C-4 | A field resolved by last-writer-wins — a title, a tick, a "Turn into", a note body — says so | ✗ | Notice | [sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision) |
| C-5 | Nothing here blocks: no modal, no interruption of an edit in progress | ✗ | | A re-rooted node reads as data loss, and a blocking prompt would make it read as worse |
| C-6 | Rows are derived from merged state each cycle, never stored; only dismissals persist, per device | ✗ | | Storing them would mean writing a file to acknowledge a notice, which is a fresh concurrent edit |

C-2 and C-3 need no resolution path — the user drags the node back, and that corrective move is an ordinary edit.

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

Packaging decides which of these are reachable, and it answers them per target rather than once — see
[architecture.md §7 Packaging](architecture.md#7-packaging). X-3 in particular is a PWA install on Chromium and an APK
on Android, but a desktop shortcut on Firefox, which does not install PWAs.

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

What M1 leaves standing, in the order it matters. Every row here is a deliberate gap rather than a discovered bug — `npm
test` and `npm run ui-smoke` both pass.

| # | Deviation | Why it stands |
| --- | --- | --- |
| 1 | T-5's refusal has no UI that can provoke it | M1 moves rows with the keyboard and the row menu, and neither can express "into my own child". The check and its test exist; a drag or a move-to picker is what will reach them |
| 2 | X-3 and X-4 are verified in a browser, not on a device | An install and a launcher icon cannot be asserted from WSL — [test.md §3.6 Platform](test.md#36-platform) carries them as a written checklist |
| 3 | T-6 cannot arise on one device | The repair is implemented and tested against hand-built cycles. Nothing writes a second device's file until M2 |
| 4 | The op log is never compacted | S-14, and it is M3's. On one device a checklist's log grows by kilobytes a month — [sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision) |
| 5 | `local-folder` has no quota story | A `localStorage` quota failure is reported and the ops stay queued, so nothing is lost in the session. It is the same growth problem as row 4, arriving early |
| 6 | The Done view cannot undelete | T-13. Deleted rows are listed and openable, and that is the whole of it: the op that reverses a `delete` does not exist, and minting one is a change to the payload M0 closed. Un-ticking a finished row does work, because that is an ordinary field write |

## 16. Explicitly out of scope

Backlogged deliberately, not overlooked: dynamic lists, Google Calendar sync, colour modes and themes, recurring tasks,
reminders and notifications, attachments, attributes (tags, priority, dates, quick add), sharing or multi-user, and any
form of application server or hosted database.

## 17. Milestones

| ID | Milestone | Contains |
| --- | --- | --- |
| M0 | Decisions | **Closed.** The payload is an append-only op log per device — [sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision) — and [§2 Data model](#2-data-model), [§8 Device management](#8-device-management) and [§9 Conflict presentation](#9-conflict-presentation) are written. The stack, the packaging and the application shape were already settled — [architecture.md §6 Technology stack](architecture.md#6-technology-stack), [architecture.md §7 Packaging](architecture.md#7-packaging), [past_decision.md §3 State Management](past_decision.md#3-state-management) |
| M1 | Local-first core | **Closed.** The tree, the item kinds, the keyboard model, the shell — [§3 Tree structure and editing](#3-tree-structure-and-editing), [§4 Item kinds](#4-item-kinds) and [§10 Application shell, PWA, offline](#10-application-shell-pwa-offline), on one device. The store is `src/app/Session.svelte.ts`, the payload is already the real op log (S-21), and what it left standing is [§15 Deviations and defects found during verification](#15-deviations-and-defects-found-during-verification) |
| M2 | Sync | The op log, tree-aware merge, the activity-driven cycle (S-19), the conflict nav of [§9 Conflict presentation](#9-conflict-presentation), and the adapter set proven against a real provider folder |
| M3 | Compaction and polish | Snapshots once S-14's trigger fires, note-body diffing, search, and the restore path T-13 owes the Done view |

M1 is closed, so M2 can start, and it starts from a write path that already emits the op log M2 has to merge: what M2
adds is reading every device's file rather than this one's, folding them together, the activity-driven cycle (S-19) and
the conflict nav. What M0 deliberately did **not** settle is listed in
[sync-flow.md §7 What is still open](sync-flow.md#7-what-is-still-open); none of it blocked M1, and the compaction cut
rule is the only item that blocks M3.
