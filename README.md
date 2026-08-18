# Checklist

A personal checklist and notes app for one person and several devices. Local-first, no application server: devices
synchronise through a folder that a cloud provider's own client keeps in sync.

Milestone M1 — the local-first core, on one device — is built. `docs/` is the source of truth for what the app is;
`prototype/` is the separate experiment that proved folder-based sync between Windows and Android.

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

| Where | What |
| --- | --- |
| `src/core/` | The logic layer: the tree, the order keys, the op fold, the cycle repair, the edits. No I/O, no clock, no `window` |
| `src/adapters/` | Folder adapters — three methods each, and nothing else |
| `src/app/` | The store, the op log, the device id, routing |
| `src/ui/` | Svelte components, the keyboard model, the row menu |
| `docs/` | Requirements, architecture, the sync design, the test plan, past decisions |
| `prototype/` | The sync prototype. Shares no code with `src/` |

Start with [docs/requirements.md](./docs/requirements.md) for what is built and what is not, and
[docs/architecture.md](./docs/architecture.md) for why it is shaped this way.
