---
name: dev
description: Development workflow for the check_list PWA — analyse a requirement against docs/, implement it, then run, drive and screenshot the real app to prove it works. Use when asked to build, change, fix, implement or verify a feature here, or to run, start, seed or screenshot the app.
---

# check_list — development workflow

Checklist PWA. 

`docs/` is the source of truth and code that contradicts it is the bug.

All paths below are relative to the repo root (`/home/nam/check_list`).

---

## Phase 1 — Requirement analysis, against the docs

Read the docs **before** the code. They are verified against the source, not
against intent, and they carry the file:line for every claim.

| File                   | What it settles                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/requirements.md` | Every requirement and its implement state. |
| `docs/architecture.md` | software architecture                                                                                                 |
| `docs/sync-flow.md`    | All logic regarding synchronisation of the app                                                                                         |
| `docs/test.md`         | Testing                                                                                                           |
| `docs/code-standard.md`         | Code standard                                                                                                       |
| `CLAUDE.md`            | Project specific detail                                                                                                    |

Then:

1. **Find the requirement.** Grep `docs/requirements.md` for its ID (`D-*`,
   `T-*`, `B-*`). If it is there and marked ✅, the work is a change to
   existing behaviour — update the row in the same commit.
2. **If it is not in the docs, write it there first**, then implement. Add a
   row to the right table with the ID, the state, and the `file:line` that will
   implement it. A requirement that only exists in the conversation is one
   nobody can verify later.
3. **Check it against the project specific detail** in `CLAUDE.md`.

## Phase 2 — Implement

- **Reusable ad-hoc script → `scripts/`, not the scratchpad.** If you write
  something to poke the DB, drive the UI or reproduce a merge, it belongs in
  `scripts/*.mjs` with an npm alias in `package.json`. Match the register of
  the existing four: a JSDoc header saying _why it exists_, then a `Usage:`
  block. Node scripts reach Playwright through `NODE_PATH` and the
  `createRequire` bridge — copy that from any existing script, ESM `import`
  will not resolve it.
- TypeScript strict, no `any` in `core/`. Tailwind semantic tokens only.
- Every keyboard action must also exist in `RowMenu` — phones have no Tab key.

## Phase 3 — Verify

---
