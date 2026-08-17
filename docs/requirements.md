# Checklist — Requirements & Implemented Behaviour

Status of the project.
Every requirement below carries the file that implements it and the test that pins it down

Verification run for this document:

```
Command here
```

Legend: **✗ done** · **◐ partial** · **✗ not built** · **pt. prototyped**

---

## 1. Summary against the stated requirements

| #   | Stated requirement                                           | State | Note                                                          |
| --- | ------------------------------------------------------------ | ----- | ------------------------------------------------------------- |
| 1   | Folder structure: a tree                                     | ✗    |   |
| 2   | Sync between PCs and phones via a cloud file service         | pt.     | |
| 3   | Lists and sub-lists                                          | ✗    | Nesting is the tree; indent/outdent, drag-free reorder        |
| 4   | Either a checklist or a text note                            | ✗    | |

---

## 2. Data model

---

## 3. Tree structure and editing

| ID   | Requirement                                                                                                     | State | Where / test                                |
| ---- | --------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------- |
| T-1  | Unlimited nesting of lists inside lists inside folders                                                          | ✗    |           |
| T-2  | Children render in a stable order every device agrees on                                                        | ✗    ||
| T-3  | Indent (become child of sibling above) / outdent (become parent's next sibling)                                 | ✗    | |
| T-4  | Move up/down among siblings                                                                                     | ✗    | |
| T-5  | A move that would create a loop is refused                                                                      | ✗    ||
| T-6  | A structurally impossible tree (concurrent A→B, B→A) is repaired at _read_ time by re-rooting, never by writing | ✗    | |
| T-7  | Deleting a node tombstones its whole subtree, not just the node                                                 | ✗    ||
| T-8  | Collapse/expand state is per-device and never synced                                                            | ✗    | |
| T-9  | Breadcrumbs show the path back up from any node                                                                 | ✗    |        |
| T-10 | Sidebar shows only containers (folder/list/note); tasks would drown it                                          | ✗    |                        |

### Keyboard (desktop)

| Key                         | Behaviour                                                                 | Where              |
| --------------------------- | ------------------------------------------------------------------------- | ------------------ |
| `Enter`                     | New sibling below — or a **first child** if the row is an expanded parent | 
| `Tab` / `Shift-Tab`         | Indent / outdent                                                          | 
| `Alt-↑` / `Alt-↓`           | Move among siblings                                                       | 
| `↑` / `↓`                   | Move the caret between rows                                               | 
| `Backspace` on an empty row | Delete it — **refused if it has children**                                | 
| `Escape`                    | Discard the in-progress title edit                                        | 

In the row `⋮` show list of keyboard in UI for user.

---

## 4. Item kinds — checklist item vs note

| ID  | Requirement                                                                  | State | Where                 |
| --- | ---------------------------------------------------------------------------- | ----- | --------------------- |
| K-1 | A row is either a checkable item or a text note                              | ✗    | 
| K-2 | Tasks render a checkbox; folders/lists/notes render a kind icon              | ✗    | 
| K-3 | A note has a long free-text body with its own full-page editor               | ✗    | 
| K-4 | A note can still own checklist children (heading + items pattern)            | ✗    | 
| K-5 | Any row can be converted to any kind after the fact ("Turn into")            | ✗    | 
| K-6 | A note can be promoted to a checklist from its own page                      | ✗    | 
| K-7 | Note body saves are debounced (500 ms) so typing is not one op per keystroke | ✗    | 
| K-8 | Lists and folders show `done/total` progress of their direct task children   | ✗    | 

Notes are deliberately not checkable.

---


## 7. Sync

**State: ✗ not implemented.** This is milestone 2 and the one stated
requirement not currently met.

### What exists

| ID   | Built                                                                        | State | Where                               |
| ---- | ---------------------------------------------------------------------------- | ----- | ----------------------------------- |
| S-1  | Every mutation goes through one write path and is recorded as an op          | ✗    | 
| S-2  | Ops are the only mutation shape — create, edit, move, delete are all patches | ✗    | 
| S-4  | Merge is commutative, associative and idempotent (property-tested)           | ✗    | 
| S-10 | No-op edits are dropped before they reach the log                            | ✗    | 
| S-11 | Upload queue: `pendingOps` / `markSynced`, resumable after interruption      | ✗    |
| S-15 | Ops encode as JSON Lines — appendable and diff-readable                      | ✗    |
| S-17 | Multi-device convergence simulator                                           | ✗    |

### What does not exist

| ID   | Missing                                                                 | State |
| ---- | ----------------------------------------------------------------------- | ----- |
| S-20 | A provider adapter (Google Drive or Dropbox) implementing `RemoteStore` | ✗     |
| S-21 | OAuth / account connection flow and token storage                       | ✗     |

- No application server, ever. Sync goes through a cloud **file** provider.
- A device writes **only** paths under its own id, so no two devices ever write
  the same file and the provider's conflict-copy behaviour never triggers.
- Provider choice stays behind four methods so it can be swapped later.

---

## 8. Application shell, PWA, offline

| ID   | Requirement                                                                 | State | Where                     |
| ---- | --------------------------------------------------------------------------- | ----- | ------------------------- |
| X-1  | One codebase and one layout for desktop and phone                           | ✗    | 
| X-2  | Sidebar permanent from `md` up, dismissible drawer below                    | ✗    | 
| X-3  | Installable to a phone home screen and a desktop taskbar                    | ✗    | 
| X-4  | Maskable Android icon, padded so the mask cannot clip it                    | ✗    | 
| X-5  | Full cold-start offline — everything precached, no API calls                | ✗    | 
| X-6  | New builds take effect on next launch without an update prompt              | ✗    | 
| X-7  | Hash routing, so it deploys to any static host with no rewrite rules        | ✗    | 
| X-8  | Deep links survive a cold launch from a home-screen icon                    | ✗    | 
| X-10 | UI repaints automatically on any data change, including a merged remote one | ✗    | 
| X-11 | Deleted/missing node renders a recovery page rather than a crash            | ✗    | 

---

## 9. Engineering constraints


---

## 10. Deviations and defects found during verification

Ordered by how much they matter.


---

## 11. Explicitly out of scope

Backlogged deliberately, not overlooked: dynamic list, Google Calendar sync, color modes/themes, recurring tasks,
reminders and notifications, attachments, Attributes (tags, priority, dates, quick add), attachements, 
sharing or multi-user, and any form of application server or hosted database.

## Milestones

- **M1 — local-first core** 
- **M2 — sync** — MegaSync, implement the adapter
- **M3 — compaction and polish** — snapshots, chunk cleanup, search, archive