# Checklist

A personal checklist and notes app for one person and several devices. Local-first, no application server: devices
synchronise through a folder that a cloud provider's own client keeps in sync.

Milestones M1, M2 and M3 are built: the local-first core, sync through the folder, and compaction, search, device
management, undelete and the two platform bundles. `docs/` is the source of truth for what the app is.

The sync prototype that proved folder-based sync between Windows and Android is a separate project, at
`/home/nam/check-list-prototype`. It shares no code with this one and nothing here depends on it.

```bash
npm install
npm run dev        # http://127.0.0.1:38531
npm test           # the logic layer
npm run ui-smoke   # the built app, driven in Chromium   (needs Playwright on NODE_PATH)
```

Or through the Makefile, which wraps the same scripts and supplies Playwright's `NODE_PATH` itself — `make help` lists
every target:

```bash
make dev           # http://127.0.0.1:38531
make build         # production bundle -> dist/
make verify        # check + test + ui-smoke + docs
make stop          # free port 38531 when a leftover server holds it
```

The two platform bundles land in `bundles/` — [docs/architecture.md §7](./docs/architecture.md#7-packaging) says which
target needs which:

```bash
make windows       # checklist-windows.zip: web assets, the loopback helper, Setup.vbs
make apk           # checklist.apk, built in Docker; nothing is installed on the host
```

| Where | What |
| --- | --- |
| `src/core/` | The logic layer: the tree, the order keys, the op fold, the cycle repair, the edits. No I/O, no clock, no `window` |
| `src/adapters/` | Folder adapters — three methods each, and nothing else |
| `src/app/` | The store, the op log, the device id, routing |
| `src/ui/` | Svelte components, the keyboard model, the row menu |
| `packaging/` | The two shells: the Windows loopback helper, the Android WebView project |
| `docs/` | Requirements, architecture, the sync design, the test plan, past decisions |

Start with [docs/requirements.md](./docs/requirements.md) for what is built and what is not, and
[docs/architecture.md](./docs/architecture.md) for why it is shaped this way.
