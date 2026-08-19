# CLAUDE.md

## Project overview

A checklist and notes app for one person across several devices. Local-first, no application server: devices synchronise
through a folder that a cloud provider's own client keeps in sync.

**Status: milestones M1 and M2 are built** — the local-first core, and sync through the folder. The production tree is
`src/`, driven by `package.json`. M3 (compaction, search, device names, undelete) has not started.

## Development

### The docs

`docs/` is the source of truth. Code that contradicts it is the bug or the doc is out of date.

| File | What it settles |
| --- | --- |
| `docs/requirements.md` | Every requirement, its ID, and its state |
| `docs/architecture.md` | Layers, the folder adapter contract, the stack, and the open design options |
| `docs/past_decision.md` | Options considered and not taken, with the condition that would reopen each |
| `docs/sync-flow.md` | What is settled about sync, and the payload chosen for the real app |
| `docs/test.md` | What gets tested, at which layer |
| `docs/code-standard.md` | Naming, module boundaries, error handling, comments |

Do not write production code that presumes an answer to these docs. Document must always precedes any permanent
development and changes.

### Writing docs

- Markdown prose hard wraps at 120 columns. Tables and code blocks stay as-is, even when they run past 120.
- `python3 scripts/md-reflow.py docs/*.md` does it (`--check` to fail without writing, `--width` to override).
- Chapters numbered from 1; cross-references are links carrying both number and title.


### Writing code

Follow `docs/code-standard.md`.

- The logic layer has no I/O, no clock and no `window`. Time is a `now()` parameter, the folder is an adapter object,
  the UI is a callback.
- A folder adapter is exactly three methods: `list()`, `read(name)`, `write(name, content)`.
- A device writes only paths carrying its own device id. This is the entire safety argument for sync.

## Commands

```bash
npm run dev              # the app, on 127.0.0.1:38531
npm test                 # Vitest over src/**/*.test.ts
npm run check            # svelte-check, strict TypeScript
npm run ui-smoke         # builds, serves dist/, drives Chromium, screenshots to ui-smoke/
npm run seed             # the app in a window with a small tree in it
npm run make-icons       # re-render the PWA PNGs from public/icons/*.svg
python3 scripts/md-reflow.py docs/*.md   # --check to fail without writing
```

`ui-smoke`, `seed` and `make-icons` need Playwright, which lives outside the project on this machine:

```bash
NODE_PATH=/home/nam/.npm/_npx/e41f203b7505f1fb/node_modules npm run ui-smoke
```

The Makefile wraps these as `make dev`, `make build`, `make preview`, `make test`, `make check`, `make seed`, `make
ui-smoke`, `make docs`, `make clean`, plus `make verify` for check + test + ui-smoke + docs. The Playwright targets set
`NODE_PATH` themselves. `make help` lists them.

**Port 38531 belongs to this project.** The dev server and the preview server both bind it on 127.0.0.1; do not pick
another one. `strictPort` is set, so a leftover server fails the next launch outright. `startPreview` puts the preview
in its own process group and kills the group, because `npx` does not pass a signal on to the vite it spawned — that was
the usual source of a leftover. `make dev`, `make preview`, `make seed` and `make ui-smoke` name the holding process
instead of failing bare, and `make stop` frees the port.





## Project specific detail

### Data files

One file per device, in the folder: `checklist.<device-id>.ops.jsonl`. A header line carries the full version vector,
then one op per line — `create`, `set`, `move`, `delete`. The device id is implied by the header rather than repeated on
every line. `src/core/op-log.ts` is the only module that spells the format; the adapter has no append, so every write is
the whole file.

A device writes that one file and reads every other. `src/app/device-log.ts` is the only writer;
`src/app/folder-sync.ts` is the only reader of peers, and the header written back carries a receipt for every peer
folded in — a write that happens even when nothing else changed, because a receipt nobody recorded is a race nobody had.

Which folder holds the files is decided at startup by `src/app/folder-choice.ts`, over the adapters in `src/adapters/`.
A browser that can reach no folder falls back to `local-folder`, which is `localStorage` and syncs with nothing; the
footer says so for as long as it is in use.

Never in a file, always `localStorage`: the device id, collapse state, the drawer's state, which folder this device
chose, and dismissed conflict rows. The File System Access handle is the exception, and only because it is an object:
IndexedDB.

### Component catalog

`src/core/` is the logic layer, `src/adapters/` storage, `src/app/` the store and routing, `src/ui/` the views.
`docs/requirements.md` names the file that implements each requirement.

### Data flow

An edit is a function of the tree, not a mutation of it:

```
key or menu -> ui/actions.ts -> core/edit.ts -> Op[]
                                   |
            Session.run ->  applyOp -> store ($state) -> Svelte re-renders
                     \-> DeviceLog.append -> debounce 250ms -> encodeLog -> adapter.write
```

Reading is the same path backwards, once, at startup: `adapter.read` -> `decodeLog` -> `foldOps` -> `resolveTree`. The
store materialises the tree once and keeps it; nothing replays the log per read.

A peer's edit arrives on the sync cycle, which is the same path with more files in it:

```
SyncCadence (edit +5s, +15s, +60s; focus; ↻) -> Session.cycle
    -> FolderSync.cycle -> adapter.list/read -> decodeLog        (a file that will not parse is skipped)
    -> mergeTree(every device's ops) -> store                    (a full re-fold, never ops laid on top)
    -> DeviceLog.noteReceipts -> the header records what was read
```

The re-fold is not optional. A peer's op usually has an *older* `at` than ops already applied, so laying it on top would
turn last-writer-wins into last-arriving-wins and every device would converge somewhere different.

Two edits do not follow the straight path, and both are deliberate: a title is a draft in its input until it is
committed, and a note body updates the store on a 1 s debounce but only becomes an op on blur, on navigation, or after
60 s (K-7, S-20).

### What the normal view leaves out

`resolveTree` drops two things from `children`, and every edit and every view reads the filtered set: a tombstoned
subtree (T-7, inherited) and a row whose own `done` is set (T-11, **not** inherited). Both are still in `tree.nodes`.
`src/core/done.ts` reads them back out for the Done view at `#/done` (T-12), which is where a finished row is un-ticked
and where a deleted one can be found. Nothing un-deletes — T-13 is not built.

### What the merge decided without asking

`src/core/conflicts.ts` derives three kinds of row from merged state and stores none of them: a field two devices wrote
concurrently (the row offers the value that lost, and taking it is an ordinary `set`), a T-6 re-rooting, and a sibling
order settled by device id. `#/conflicts` renders them, and its nav entry exists only while there are any. Dismissals
are the only thing that persists, per device, in `localStorage`.

## Testing

- `npm test` — Vitest over `src/**/*.test.ts`. Test files sit beside the file under test.
- `npm run ui-smoke` — the built app in Chromium. Every check reports, then the run fails; screenshots land in
  `ui-smoke/`.
- The logic layer is never mocked. Time, ids and counters are injected, so a test asserts exact values.
- A new keyboard binding must appear in `KEY_BOUND_ACTIONS` and in the row menu, or `src/ui/actions.test.ts` fails.
