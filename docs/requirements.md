# Requirements

Requirement docs and its current state.

**Nothing is implemented.** The repository holds `prototype/` and `docs/`, and no production source tree. Rows marked
`pt.` are proven by running code in `prototype/`, which does not share code with production and is not on the way to it
— the design crosses over, the source does not.

Once production code exists, every row carries the file that implements it and the test that pins it down, and this line
is replaced by the command that verifies them.

Legend:

| Mark | Meaning |
| --- | --- |
| ✅ | done |
| ◐ | partial |
| ✗ | not built |
| pt. | proven in `prototype/`|

Sections marked _Not written yet._ are placeholders: the heading records that the topic is owed, and the content is
still to be decided.

---

## 1. Summary against the stated requirements

| # | Stated requirement | State | Note |
| --- | --- | --- | --- |
| 1 | Folder structure: a tree | ✗ | |
| 2 | Sync between PCs and phones via a cloud file service | pt. | Transport proven for one text field; the tree payload is an append-only op log per device — [sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision) |
| 3 | Lists and sub-lists | ✗ | Nesting is the tree; indent/outdent, drag-free reorder |
| 4 | Either a checklist or a text note | ✗ | |

## 2. Data model

A node is a record in the store and a fold of ops on disk. The folder holds ops; the store holds the materialised tree
and never replays per read — [sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision).

### 2.1 The node

| Field | Type | Settles |
| --- | --- | --- |
| `id` | string | Minted by the creating device, never reused |
| `parent` | node id or `root` | Always read through the cycle-repair resolver, never directly — T-6 |
| `parentSetAt` | timestamp | When the move was written. The repair reads it; nothing reads the local clock |
| `kind` | one of `folder`, `list`, `note`, `task` | K-1. Mutable after the fact — K-5 |
| `title` | string | The row label, every kind |
| `done` | boolean | Tasks only — K-2 |
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
(T-8), the sync cadence setting (S-19), dismissed conflict notices, and the archive view's filter. Anything the user
would not want to converge across devices belongs here rather than in the tree.

## 3. Tree structure and editing

| ID | Requirement | State | Where / test |
| --- | --- | --- | --- |
| T-1 | Unlimited nesting of lists inside lists inside folders | ✗ | |
| T-2 | Children render in a stable order every device agrees on | ✗ | [sync-flow.md §5 Sibling ordering](sync-flow.md#5-sibling-ordering) |
| T-3 | Indent (become child of sibling above) / outdent (become parent's next sibling) | ✗ | |
| T-4 | Move up/down among siblings | ✗ | |
| T-5 | A move that would create a loop is refused | ✗ | Local check only — it catches one device dragging a folder into its own child, never the merge case, which is T-6: [sync-flow.md §6.1 T-5 is not the loop defence](sync-flow.md#61-t-5-is-not-the-loop-defence) |
| T-6 | A Cyclic tree state (concurrent A→B, B→A) is repaired at _read_ time by re-rooting, never by writing | ✗ | Drop the cycle edge with the oldest `(parentSetAt, device id)` — [sync-flow.md §6.2 The repair](sync-flow.md#62-the-repair) |
| T-7 | Deleting a node tombstones its whole subtree, not just the node | ✗ | The ancestor walk must climb the T-6-resolved parent, or a tombstoned subtree containing a cycle hangs — [sync-flow.md §6.2 The repair](sync-flow.md#62-the-repair) |
| T-8 | Collapse/expand state is per-device and never synced | ✗ | |
| T-9 | Breadcrumbs show the path back up from any node | ✗ | |
| T-10 | Sidebar shows only containers (folder/list/note); tasks would drown it | ✗ | |

[sync-flow.md §3 Why a snapshot does not scale to a tree](sync-flow.md#3-why-a-snapshot-does-not-scale-to-a-tree) is why
T-2, T-5, T-6 and T-7 constrain the sync payload, not just the UI.

### 3.1 Keyboard (desktop)

| Key | Behaviour | Where |
| --- | --- | --- |
| `Enter` | New sibling below — or a **first child** if the row is an expanded parent | |
| `Tab` / `Shift-Tab` | Indent / outdent | |
| `Alt-↑` / `Alt-↓` | Move among siblings | |
| `↑` / `↓` | Move the caret between rows | |
| `Backspace` on an empty row | Delete it — **refused if it has children** | |
| `Escape` | Discard the in-progress title edit | |

Every one of these also has to exist in the row `⋮` menu, which is where a phone reaches them, and that menu is where
the keyboard list is shown to the user.

## 4. Item kinds

| ID | Requirement | State | Where |
| --- | --- | --- | --- |
| K-1 | A row is one of four kinds: `folder`, `list`, `note` or `task` | ✗ | Only a task is checkable; the other three are the containers T-10 shows in the sidebar. Kind drives rendering, never structure — any kind may own children |
| K-2 | Tasks render a checkbox; folders/lists/notes render a kind icon | ✗ | |
| K-3 | A note has a long free-text body with its own full-page editor | ✗ | |
| K-4 | A note can still own checklist children (heading + items pattern) | ✗ | |
| K-5 | Any row can be converted to any kind after the fact ("Turn into") | ✗ | Two devices converting one row differently resolve by `(at, device id)`, with a notice — [§9 Conflict presentation](#9-conflict-presentation) |
| K-6 | A note can be promoted to a checklist from its own page | ✗ | |
| K-7 | Note body saves are debounced (500 ms) so typing is not one op per keystroke | ✗ | The 500 ms debounce governs the store; an **op** is emitted on blur, on navigating away, or after 60 s of continuous editing — S-20 |

Notes are deliberately not checkable.

## 5. Navigation and routing

_Not written yet._

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
| S-20 | A note body is emitted as an op on blur, on navigating away, or after 60 s of continuous editing | ✗ | Not on K-7's 500 ms store debounce. Whole-body ops are the dominant growth term, so the emission trigger is what bounds the log |

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
| X-1 | One codebase and one layout for desktop and phone | ✗ | |
| X-2 | Sidebar permanent from `md` up, dismissible drawer below | ✗ | |
| X-3 | Installable to a phone home screen and a desktop taskbar | ✗ | |
| X-4 | Maskable Android icon, padded so the mask cannot clip it | ✗ | |
| X-5 | Full cold-start offline — everything precached, no API calls | ✗ | |
| X-6 | New builds take effect on next launch without an update prompt | ✗ | |
| X-7 | Hash routing, so it deploys to any static host with no rewrite rules | ✗ | |
| X-8 | Deep links survive a cold launch from a home-screen icon | ✗ | |
| X-10 | UI repaints automatically on any data change, including a merged remote one | ✗ | |
| X-11 | Deleted/missing node renders a recovery page rather than a crash | ✗ | |

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

_Not written yet._ Nothing to verify against until production code exists. Ordered by how much they matter, once there
is something to order.

## 16. Explicitly out of scope

Backlogged deliberately, not overlooked: dynamic lists, Google Calendar sync, colour modes and themes, recurring tasks,
reminders and notifications, attachments, attributes (tags, priority, dates, quick add), sharing or multi-user, and any
form of application server or hosted database.

## 17. Milestones

| ID | Milestone | Contains |
| --- | --- | --- |
| M0 | Decisions | **Closed.** The payload is an append-only op log per device — [sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision) — and [§2 Data model](#2-data-model), [§8 Device management](#8-device-management) and [§9 Conflict presentation](#9-conflict-presentation) are written. The stack, the packaging and the application shape were already settled — [architecture.md §6 Technology stack](architecture.md#6-technology-stack), [architecture.md §7 Packaging](architecture.md#7-packaging), [past_decision.md §3 State Management](past_decision.md#3-state-management) |
| M1 | Local-first core | The tree, the item kinds, the keyboard model, the shell — [§3 Tree structure and editing](#3-tree-structure-and-editing), [§4 Item kinds](#4-item-kinds) and [§10 Application shell, PWA, offline](#10-application-shell-pwa-offline), on one device |
| M2 | Sync | The op log, tree-aware merge, the activity-driven cycle (S-19), the conflict nav of [§9 Conflict presentation](#9-conflict-presentation), and the adapter set proven against a real provider folder |
| M3 | Compaction and polish | Snapshots once S-14's trigger fires, note-body diffing, search, archive |

The sections M0 was blocking are written, so M1 can start. What M0 deliberately did **not** settle is listed in
[sync-flow.md §7 What is still open](sync-flow.md#7-what-is-still-open); none of it blocks M1, and the compaction cut
rule is the only item that blocks M3.
