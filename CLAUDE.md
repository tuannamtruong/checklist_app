# CLAUDE.md

## Project overview

A checklist and notes app for one person across several devices. Local-first, no application server: devices synchronise
through a folder that a cloud provider's own client keeps in sync.

**Status: milestone M1 is built** — the local-first core on one device. The production tree is `src/`, driven by
`package.json`. M2 (sync) has not started: nothing reads another device's file yet.

`prototype/` is separate prototype that proves folder-based sync between Windows and Android. It does not share code
with a production tree. Ignore it when developing the project.

## Development

### The docs

`docs/` is the source of truth. Code that contradicts it is the bug or the doc is out of date.

| File | What it settles |
| --- | --- |
| `docs/requirements.md` | Every requirement, its ID, and its state |
| `docs/architecture.md` | Layers, the folder adapter contract, the stack, and the open design options |
| `docs/past_decision.md` | Options considered and not taken, with the condition that would reopen each |
| `docs/sync-flow.md` | What the prototype proved about sync, and the payload chosen for the real app |
| `docs/test.md` | What gets tested, at which layer |
| `docs/code-standard.md` | Naming, module boundaries, error handling, comments |
| `prototype/README.md` | The prototype only — its build, its findings, its known issues |

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
`NODE_PATH` themselves. `make help` lists them alongside the prototype's targets.

The prototype's own bundles are unchanged: `make proto_all`, `make proto_exe_win`, `make proto_android`, `make
proto_clean`, and `python3 prototype/install/serve.py --folder <path>`.

**Port 38531 belongs to this project.** The dev server, the preview server and the prototype's loopback helper all bind
it on 127.0.0.1; do not pick another one. `strictPort` is set, so a leftover server — usually a preview one that
outlived a `seed` or `ui-smoke` run — fails the next launch outright. `make dev`, `make preview`, `make seed` and `make
ui-smoke` name the holding process instead of failing bare, and `make stop` frees the port. Any `npm run` line in
`prototype/README.md` is still aspirational — that `package.json` was never written, and this one is not it.





## Project specific detail

### Data files

One file per device, in the folder: `checklist.<device-id>.ops.jsonl`. A header line carries the full version vector,
then one op per line — `create`, `set`, `move`, `delete`. The device id is implied by the header rather than repeated on
every line. `src/core/op-log.ts` is the only module that spells the format; the adapter has no append, so every write is
the whole file.

In M1 that file lives in `localStorage` behind `src/adapters/local-folder.ts` (requirement S-21). M2 swaps the adapter,
not the write path.

Never in a file, always `localStorage`: the device id, collapse state, the drawer's state.

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

Two edits do not follow the straight path, and both are deliberate: a title is a draft in its input until it is
committed, and a note body updates the store on a 500 ms debounce but only becomes an op on blur, on navigation, or
after 60 s (K-7, S-20).

## Testing

- `npm test` — Vitest over `src/**/*.test.ts`. Test files sit beside the file under test.
- `npm run ui-smoke` — the built app in Chromium. Every check reports, then the run fails; screenshots land in
  `ui-smoke/`.
- The logic layer is never mocked. Time, ids and counters are injected, so a test asserts exact values.
- A new keyboard binding must appear in `KEY_BOUND_ACTIONS` and in the row menu, or `src/ui/actions.test.ts` fails.
