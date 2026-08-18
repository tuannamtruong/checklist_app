# Code standard

## 1. Paths

- Use relative paths.
- Never hardcode an absolute path or a home directory. The one exception is a path the user supplied (Sync Folder)
- Join with the platform's join (`path.join`, `os.path.join`), never with string concatenation.
- Anything user-visible that names a folder shows the folder's own name, not a path assembled in code.

## 2. Naming

| Kind | Convention | Example |
| --- | --- | --- |
| Files | `kebab-case` | `folder-sync.mjs`, `node-folder.mjs` |
| Files declaring one class | `PascalCase` matching the class | `RowMenu.tsx` |
| Functions, variables | `camelCase` | `applyPeers`, `deviceId` |
| Constants | `UPPER_SNAKE_CASE` | `POLL_MS`, `DEBOUNCE_MS` |
| Types, classes | `PascalCase` | `DeviceFile`, `SClock` |
| Custom elements, CSS classes | `hyphenated-names` | `row-menu`, `conflict-panel` |
| Test files | mirror the file under test | `merge.test.mjs` beside `merge.mjs` |

Names carry the domain vocabulary from [Glossary](glossary.md).

## 3. Module boundaries

**The logic layer has no I/O, no clock and no `window`.** Time enters as a `now()` parameter, the folder enters as an
adapter object, the UI enters as a callback. A module that imports `fs`, reads `Date.now()` or touches `document` is not
part of the logic layer, whatever folder it sits in.

**A folder adapter is exactly three methods** — `list()`, `read(name)`, `write(name, content)` — and nothing else, per
[architecture.md §4 The folder adapter](architecture.md#4-the-folder-adapter). Adding a fourth method to solve one
adapter's problem breaks the other four.

**One writer per file.** A device writes only paths carrying its own device id. This is the entire safety argument for
the sync design, and it is a code rule, not a convention.

## 4. Error handling

- Use try/catch for async operations
- Error messages contains context and content
- Log with context: which device, which file, which cycle
- Implement fallback mechanisms

## 5. Comments

Comments say why, not what.

```javascript
// Hold our own state untouched while a conflict is open. Picking for the user
// here is exactly the silent data loss the conflict exists to prevent.
if (conflict) return { state: mine, conflict, changed: false };
```

- Every non-obvious invariant carries the sentence that explains it.
- A module opens with a comment states its responsibilty.
- A comment that restates the line beneath it gets deleted.

## 6. Secrets and identifiers

**NEVER write API keys, tokens, passwords, project IDs, org IDs, or any identifier in code.** ALL must go in `.env`.

```javascript
// WRONG
const API_KEY = "AIzaSy...";

// CORRECT
const API_KEY = process.env.GOOGLE_API_KEY;
```

**When creating scripts with API keys:**
1. Use `process.env` (Node.js) or `os.environ.get()` (Python)
2. Load from `.env` file using `dotenv`
3. Add variable to `.env.example` with placeholder
4. Verify `.env` is in `.gitignore`

**If you accidentally commit a secret:**
1. Revoke the key IMMEDIATELY
2. Generate new key
3. Update `.env`
4. Old key is compromised forever (git history)