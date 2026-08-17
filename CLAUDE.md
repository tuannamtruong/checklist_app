# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

A checklist and notes app for one person, multiple devices. For a specific
aspect of the project, look under the `docs` folder.

`prototype/` is separate, throwaway code that proves the sync transport
folder-based sync between Windows and Android. It does not share code
with `src/` and is not on the way to production; read `prototype/README.md`
before changing anything in it.

## Essential Commands

```bash
npm run dev              # vite dev server on :5173
npm test
npm run build
npm run preview          # serve the build with the service worker active

npm run proto -- --folder ~/Dropbox/checklist   # sync prototype on :38531
npm run proto:test       # prototype: two devices, simulated cloud client
npm run proto:bridge     # prototype: any-browser path against a real folder
npm run proto:ui         # prototype: the page (helper must be running)
npm run proto:android    # prototype: the Android path, Java bridge stubbed
```

**Port 38531 belongs to this project.** The helper binds it on 127.0.0.1; do not
pick another one.

## Security Guidelines

### CRITICAL: NEVER Hardcode Secrets or IDs

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


## Writing docs

- Markdown prose: hard wrap at 120 columns. Tables and code blocks stay as-is —
  they are never wrapped, even when they run past 120.
- `scripts/md-reflow.py` does it: `python3 scripts/md-reflow.py docs/*.md`
  (`--check` to fail without writing, `--width` to override).


TODO BEGIN
## Project specific detail
## Data Files
### Component Catalog
### Data Flow

## Testing
TODO END
