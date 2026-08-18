# Checklist — Requirements

What the application has to do, and what state each requirement is in.

**Nothing is implemented.** The repository holds `prototype/` and `docs/`, and no production source tree. Rows marked
`pt.` are proven by running code in `prototype/`, which does not share code with production and is not on the way to it
— the design crosses over, the source does not.

Once production code exists, every row carries the file that implements it and the test that pins it down, and this line
is replaced by the command that verifies them.

Legend:

| Mark | Meaning |
| --- | --- |
| ✅ | done in production code, with a test |
| ◐ | partial |
| ✗ | not built |
| pt. | prototyped — proven in `prototype/`, not in production code |

Sections marked _Not written yet._ are placeholders: the heading records that the topic is owed, and the content is
still to be decided.

---

## 1. Summary against the stated requirements

| # | Stated requirement | State | Note |
| --- | --- | --- | --- |
| 1 | Folder structure: a tree | ✗ | |
| 2 | Sync between PCs and phones via a cloud file service | pt. | Transport proven for one text field; the tree payload is an open decision, see [sync-flow.md §4 The four candidate payloads](sync-flow.md#4-the-four-candidate-payloads) |
| 3 | Lists and sub-lists | ✗ | Nesting is the tree; indent/outdent, drag-free reorder |
| 4 | Either a checklist or a text note | ✗ | |

## 2. Data model

_Not written yet._ [sync-flow.md §4 The four candidate payloads](sync-flow.md#4-the-four-candidate-payloads) decides
whether a node is a record or a fold of ops.

## 3. Tree structure and editing

| ID | Requirement | State | Where / test |
| --- | --- | --- | --- |
| T-1 | Unlimited nesting of lists inside lists inside folders | ✗ | |
| T-2 | Children render in a stable order every device agrees on | ✗ | [sync-flow.md §5 Sibling ordering](sync-flow.md#5-sibling-ordering) |
| T-3 | Indent (become child of sibling above) / outdent (become parent's next sibling) | ✗ | |
| T-4 | Move up/down among siblings | ✗ | |
| T-5 | A move that would create a loop is refused | ✗ | Local check only — it catches one device dragging a folder into its own child, never the merge case, which is T-6: [sync-flow.md §6.1 T-5 is not the loop defence](sync-flow.md#61-t-5-is-not-the-loop-defence) |
| T-6 | A structurally impossible tree (concurrent A→B, B→A) is repaired at _read_ time by re-rooting, never by writing | ✗ | Drop the cycle edge with the oldest `(parentSetAt, device id)` — [sync-flow.md §6.2 The repair](sync-flow.md#62-the-repair) |
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

## 4. Item kinds — checklist item vs note

| ID | Requirement | State | Where |
| --- | --- | --- | --- |
| K-1 | A row is either a checkable item or a text note | ✗ | |
| K-2 | Tasks render a checkbox; folders/lists/notes render a kind icon | ✗ | |
| K-3 | A note has a long free-text body with its own full-page editor | ✗ | |
| K-4 | A note can still own checklist children (heading + items pattern) | ✗ | |
| K-5 | Any row can be converted to any kind after the fact ("Turn into") | ✗ | |
| K-6 | A note can be promoted to a checklist from its own page | ✗ | |
| K-7 | Note body saves are debounced (500 ms) so typing is not one op per keystroke | ✗ | |
| K-8 | Lists and folders show `done/total` progress of their direct task children | ✗ | |

Notes are deliberately not checkable.

## 5. Navigation and routing

_Not written yet._

## 6. Search

_Not written yet._

## 7. Sync

The transport is proven; the payload is not. The design options and their trade-offs are in
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
| S-2 | A mutation shape that merges at field granularity rather than whole-document | ✗ | Open: [sync-flow.md §4 The four candidate payloads](sync-flow.md#4-the-four-candidate-payloads) |
| S-11 | Upload queue, resumable after interruption | ✗ | May be unnecessary — the folder write is the queue |
| S-12 | Property-based tests for S-4 | ✗ | [test.md §3.1 Merge properties](test.md#31-merge-properties) |
| S-13 | Tree-aware merge: concurrent moves, subtree tombstones, sibling order | ✗ | T-2, T-5, T-6, T-7. Analysed in [sync-flow.md §5 Sibling ordering](sync-flow.md#5-sibling-ordering) and [sync-flow.md §6 Concurrent moves and cycle repair](sync-flow.md#6-concurrent-moves-and-cycle-repair) |
| S-14 | Compaction, so history does not grow without bound | ✗ | Only applies to some payloads; milestone M3 |
| S-15 | An on-disk encoding that is appendable and diff-readable | ✗ | Open; JSON Lines is one candidate |
| S-16 | Retiring a device, so a dead replica stops contributing a counter | ✗ | See [sync-flow.md §7 What is still open](sync-flow.md#7-what-is-still-open) |
| S-18 | Adapter conformance suite covering all five adapters | ✗ | [test.md §3.3 Adapter conformance](test.md#33-adapter-conformance) |

### 7.3 Fixed constraints

- No application server, ever. Sync goes through a cloud **file** provider.
- A device writes **only** paths under its own id, so the provider's conflict-copy behaviour never triggers.
- No authoritative clock, for the same reason. Timestamps recorded in a write still order writes identically on every
  device, but a skewed clock can order them against what the user meant — accepted, and costed in
  [sync-flow.md §6.5 Accepted limit](sync-flow.md#65-accepted-limit).
- Provider choice stays behind the three adapter methods so it can be swapped. Which provider is the default is
  unsettled: the `Makefile` defaults to `D:\MEGA\Checklist`, milestone M2 names MegaSync, and the prototype's comments
  name Dropbox and OneDrive. Any of them works; the docs should stop naming three.

## 8. Device management

_Not written yet._

## 9. Conflict presentation

_Not written yet._ One item is already owed: a T-6 repair moves a node to the top level without being asked, which reads
as data loss, so it needs a non-blocking notice naming what moved and offering to jump to it — see
[sync-flow.md §6.3 The user has to see it](sync-flow.md#63-the-user-has-to-see-it).

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
| M0 | Decisions | Close [sync-flow.md §4 The four candidate payloads](sync-flow.md#4-the-four-candidate-payloads); write the sections marked _Not written yet._ above. The stack, the packaging and the application shape are settled — [architecture.md §6 Technology stack](architecture.md#6-technology-stack), [architecture.md §7 Packaging](architecture.md#7-packaging), [past_decision.md §3 Application shape](past_decision.md#3-application-shape) |
| M1 | Local-first core | The tree, the item kinds, the keyboard model, the shell — [§3 Tree structure and editing](#3-tree-structure-and-editing), [§4 Item kinds — checklist item vs note](#4-item-kinds--checklist-item-vs-note) and [§10 Application shell, PWA, offline](#10-application-shell-pwa-offline), on one device |
| M2 | Sync | The chosen payload, tree-aware merge, and the adapter set proven against a real provider folder |
| M3 | Compaction and polish | Snapshots, chunk cleanup, search, archive |

M0 is not paperwork. Three sections — [§2 Data model](#2-data-model), [§8 Device management](#8-device-management) and
[§9 Conflict presentation](#9-conflict-presentation) — cannot be written before the payload is chosen, and M1 cannot
start before the data model exists.
