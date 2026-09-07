# CLAUDE.md

## Project overview

A checklist and notes app for one person across several devices. Local-first, no application server: devices synchronise
through a folder that a cloud provider's own client keeps in sync.

**Status: milestones M1, M2, M3 and M4 are built** — the local-first core, sync through the folder, then compaction,
search, device names, undelete and the two platform bundles, and lastly the settings screen and its six themes. The
production tree is `src/`, driven by `package.json`.

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

make windows             # bundles/checklist-windows.zip — web assets, the loopback helper, Setup.vbs
make apk                 # bundles/checklist.apk, built in Docker; nothing is installed on the host
```

Both bundles take `dist/` as input rather than building their own, so the phone and the laptop cannot drift. The shells
live in `packaging/windows/` and `packaging/android/` — architecture.md §7. `make windows PYTHON_EMBED=skip` omits the
embeddable Python runtime (and its one network fetch, cached in `.build-cache/`); `make apk` needs Docker and says so in
a second rather than after ten minutes of Gradle.

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
then one op per line — `create`, `set`, `move`, `delete`, `restore`. The device id is implied by the header rather than
repeated on every line. `src/core/op-log.ts` is the only module that spells the format; the adapter has no append, so
every write is the whole file.

The header also carries two advisory fields nothing in the merge reads: `name`, which is what this device calls itself
(D-1), and `at`, when it last wrote (D-2). A device names only itself, because it writes only its own file — that is the
whole merge story for a name. `src/core/devices.ts` is the only reader of either.

A device writes that one file and reads every other. `src/app/device-log.ts` is the only writer;
`src/app/folder-sync.ts` is the only reader of peers, and the header written back carries a receipt for every peer
folded in — a write that happens even when nothing else changed, because a receipt nobody recorded is a race nobody had.

Which folder holds the files is decided at startup by `src/app/folder-choice.ts`, over the adapters in `src/adapters/`.
A browser that can reach no folder falls back to `local-folder`, which is `localStorage` and syncs with nothing; the
footer says so for as long as it is in use.

**Compaction rewrites a device's own file in place** once total log bytes exceed device count × serialised tree bytes.
`src/core/compact.ts` drops only those of this device's ops that a later op of its own overwrites — provably unreachable
under every interleaving, so the fold is *identical* rather than merely equivalent — and `Session.cycle` is what fires
it. Never a peer's file: one writer per file, and that is also why the cut needs no agreement with anyone. It must never
lower this device's top counter, or every peer reads the file as a partial download and skips it forever. sync-flow.md
§4.8.

Never in a file, always `localStorage`: the device id, collapse state, the drawer's state, which folder this device
chose, the chosen theme, and dismissed conflict rows. The File System Access handle is the exception, and only because
it is an object: IndexedDB.

### Component catalog

`src/core/` is the logic layer, `src/adapters/` storage, `src/app/` the store and routing, `src/ui/` the views,
`packaging/` the two platform shells. `docs/requirements.md` names the file that implements each requirement.

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
and a deleted one restored — T-13, one `restore` op, and the subtree comes back with it because T-7 never tombstoned the
descendants individually.

`src/core/search.ts` at `#/search/<query>` is the other way back to both, and the only one that finds them by name: it
scans the materialised tree per query and stores no index at all (F-4).

### Settings

`#/settings` (`src/ui/SettingsPage.svelte`) is everything about *this device* rather than about the tree — X-12 — and it
is the third and last nav entry, beside Search and Done. Three things sit on it, and only the first writes an op:

- **The device name** (D-1). The one editor for it; `#/devices` lists what every device calls itself and edits none of
  them, including this one.
- **The log** (D-4). `#/logs` reads this device's own ops back newest first through `src/core/log-view.ts`, with the
  header line's vector above them. Nothing on that page writes.
- **The theme** (X-13). `src/core/themes.ts` is the catalog of six ids, `src/app.css` holds one eleven-token palette per
  id under `[data-theme='…']`, and `src/app/theme.svelte.ts` applies it. `themes.test.ts` fails if catalog and
  stylesheet drift. **No component ever names a colour** — that is what makes a seventh theme a CSS block and nothing
  else. The id is applied by a boot line in `index.html` so a dark theme never flashes light, and it never syncs
  (X-14).

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
