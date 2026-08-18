# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project overview

A checklist and notes app for one person across several devices. Local-first, no application server: devices
synchronise through a folder that a cloud provider's own client keeps in sync.

**Status: nothing is implemented.** The repository holds `prototype/` and `docs/`. There is no production source
tree and no `package.json`. 
Tech stack: Vite + TypeScript + Svelte.

`prototype/` is separate prototype that proves folder-based sync between Windows and Android. It does not share
code with a production tree. Ignore it when developing the project.

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

Do not write production code that presumes an answer to these docs. Document must always precedes any permanent development and changes.

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
make proto_all           # both prototype bundles make proto_exe_win       # Windows launcher: staged Python + desktop
shortcut make proto_android       # Android APK, built inside Docker make proto_clean         # remove build output and
caches

python3 prototype/install/serve.py --folder ~/Dropbox/checklist   # the prototype, on :38531 python3
scripts/md-reflow.py docs/*.md                            # --check to fail without writing
```


**Port 38531 belongs to this project.** The helper binds it on 127.0.0.1; do not pick another one.

There is no `npm` in this repository yet. Any `npm run` line in `prototype/README.md` is aspirational.





TODO BEGIN
## Project specific detail
## Data Files
### Component Catalog
### Data Flow

## Testing
TODO END
