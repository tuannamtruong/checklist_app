# CLAUDE.md

## Project overview

A checklist and notes app for one person across several devices. Local-first, no application server: devices synchronise
through a folder that a cloud provider's own client keeps in sync.

**Status: milestones M1 to M10 are built** — the local-first core, sync through the folder, then compaction, search,
device names, undelete and the two platform bundles, then the settings screen and its six themes, then M5: the sync
folder section, drag and drop, tags and priority with a filter, and the quick-add line. M6 mostly removed: three kinds
rather than four (`list` is gone), one control for a kind change rather than two, a sidebar one level deep — and one
addition, a pasted paragraph becoming one row per line. M7 is bold and headings in a note body, as marks inside the body
string, and M8 opens a note beside the list rather than instead of it — from the icon, which navigates, and from the
caret (X-30), which does not. M9 is Today and Tomorrow, two lists that are not the tree, and M10 is Timely, a third one
for the check items that come back — both are a parent that is not a node and a `day` compared with today, so nothing
happens at midnight on any device. The production tree is `src/`, driven by `package.json`.

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

**Under WSL the port has a second half, and `scripts/win-port.sh` is what reaches it.** The two halves of `127.0.0.1`
are two namespaces: the Windows bundle's `serve.py` can hold 38531 on the Windows side while vite binds it here — both
succeed — and a browser *on Windows* is then served whatever `make windows` last staged into that bundle's `web/`, never
this server. `lsof` and `ss` cannot see across, so the script asks Windows through `netstat.exe`, matching a listening
socket by its `0.0.0.0:0` peer because the status column is localised.

**`make dev` closes that helper; nothing else does.** `dev` depends on `win-port-stop` *before* `port-check`, since the
Windows listener has to be gone before vite binds or WSL's forwarder never takes the port over there. `make preview` and
`make ui-smoke` only name it (`win-port-note`): both are watched from inside WSL, which reaches vite regardless, and the
app on the Windows taskbar is not theirs to shut. `make win-port-stop` closes it on its own. Only *our* helper is ever
killed, identified by `serve.py` plus `checklist` in its **command line** rather than by its image name, since
`pythonw.exe` is any number of other programs; anything else holding the port is named and left alone, and our own
`wslrelay.exe` forwarder is skipped so the note never fires on us. The script is silent and successful off WSL, so the
targets depend on it unconditionally.

**The dev server also removes a service worker left over from a build.** The bundle, `make preview` and `make dev` are
one origin, so a worker any of them installed still answers navigations from its precache and the dev server is never
asked anything — the app looks frozen at the last build. `vite.config.ts` serves a worker of its own at `/sw.js` in
development whose only job is to remove itself: it skips waiting, empties every cache, unregisters, and reloads the
pages it was holding. It is a `configureServer` hook and nothing else, so `make preview` and `make ui-smoke` still serve
the real `dist/sw.js` — X-5's offline cold start is that worker doing its job, and `ui-smoke` fails if it stops.





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

Never in a file, always `localStorage`: the device id, collapse state, which sidebar rows are open, the drawer's state,
the sidebar's and the note pane's widths, which folder this device chose, which cloud app it belongs to, the chosen
theme and the two colours picked over it, how large the sidebar's type is, and dismissed conflict rows. The File System
Access handle is the exception, and only because it is an object: IndexedDB.

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

### The note body

`body` is a string and stays one (B-2). Bold, two heading levels and code are Markdown marks *inside* it — `**bold**`,
`# `, `## `, three backticks on a line of their own, one backtick inside a line — so the merge, the conflict rows and
compaction never learned that a body can be formatted, and a build that predates M7 shows the marks as characters rather
than as noise. `src/core/markup.ts` is the only module that spells a mark: `parseBody` returns blocks and spans (never
HTML — B-6), `plainText` is what search matches and snippets show (B-5), and `toggleBold`/`setHeading`/`toggleCode` are
the three controls, which write marks a person could have typed and are therefore undone by the field's own undo.

Three controls, never five: bold; a heading that cycles none, heading, subheading — the shape A-2's priority flag
already has; and one `</>` whose mark is decided by the selection rather than by a second button — a run inside one line
becomes `` `inline` ``, a caret or a selection crossing a line break becomes a fenced box, and a caret already inside a
box takes the fences off. They sit in a row above the field, and **selecting a run of text raises the same controls
beside the selection** (B-7).

**A list is typed and Enter is the whole of it (B-10).** `- ` or `1. ` opens one; Enter carries the marker onto the next
line and counts the numbers up, and Enter on an item with nothing in it takes the marker off, which is the way out.
Nothing renumbers — the number drawn is the number in the string — and there is no control for it, because two typed
characters already reach every keyboard. `listEnter` returns a *splice* rather than a body so `NoteBody` can type it in
with `insertText`: a marker the app wrote is then undone by the field's own `Ctrl-Z`, and the caret is placed explicitly
afterwards because Chromium leaves it one short on an empty insert.

**A fenced block is the one construct that spans lines, and every mark but bold is a character inside it** — `# ` is a
comment and `- ` is a flag, but `**` is bold (B-11), read a line at a time, because the reason a long box is on screen
is usually one line in it. `boldRuns` is what both code paths call, so an inline run reads the same way. An unclosed fence stays literal, for the reason an unmatched `**`
does. It draws as a box headed `Code` with a Copy button, and that button is the one positioned thing inside B-3's
`aria-hidden` rendered half carrying a `z-index`: without it the click lands in the transparent textarea lying over the
box. It is `tabindex="-1"` because the text is in that field, which is what a screen reader reads. Placing that pair is
the one hard part: a textarea has no range geometry, so `src/ui/text-rect.ts` lays the text out again in a mirror
wearing the field's metrics and measures the run there, and `selectionchange` on the document is what raises the
controls — a field fires nothing of its own when a drag ends outside it.

`src/ui/NoteBody.svelte` holds one textarea that is never unmounted. When the caret is elsewhere it lies transparent
over the rendered blocks, so the click that reaches it is the click that focuses it; swapping two elements would drop
the focus on the way through, and a `contenteditable` would hand the caret to the browser — which K-7's debounce and
X-10's repaint-without-eating-the-caret both need to keep.

### The note pane

`#/n/<id>` of a **note** draws two things: the note, and the page of the nearest list above it (X-21). Both come out of
the one route — `src/ui/App.svelte` derives `noteId` and `listId` from it — so there is no second route and no stored
pair, and Back closes the note by leaving the route exactly as it always did. A `folder` or a `task` renders the single
page it always did: a list beside a list is the same drawing twice.

**"The nearest list above it" is a walk, not the parent.** `listAbove` in `src/core/tree.ts` climbs T-6's resolved
parents past every `note`, so opening a note *inside* a note swaps the pane and leaves the left column exactly where the
reader put it — the nested note is a row in that column's own tree, which draws the whole subtree, so the click is a
click on the left and only the pane answers it. Drawing the parent note on the left instead was the first cut: it put a
second body and a second K-7 debounce on screen, and moved the list on every step down. `closeHref` walks the same way,
or ✕ on a nested note would open its parent rather than close anything.

**The divider between them is dragged — X-24.** `src/ui/WidthGrip.svelte` is X-20's sidebar grip generalised: the same
pointer capture and the same `role="slider"`, with `sign={-1}` at the pane because the divider is the pane's *left*
edge. The width is `notePaneWidth` in `src/app/view-state.svelte.ts`, bounded there rather than at the grip and stored
in `localStorage` like the sidebar's. What stops the divider is the room in the window — everything but the sidebar and
a 176px strip for the list, the same `SIDEBAR_WIDTH.min` — so `App.svelte` reports `innerWidth` on every resize and
`NOTE_WIDTH.ceiling` is read only when no window has said. Above `lg` only — below it the pane is the sheet and its
width is the viewport's.

The breakpoint is **`lg`, not X-2's `md`**: the sidebar asks whether there is room for a column of nav, and this asks
whether there is room for two columns of content. Below it `src/ui/NotePane.svelte` is a bottom sheet instead —
`max-h-[60dvh]` over an auto height, so a short note shows whole and a long one stops at 60% with no measurement
anywhere (X-22). A peeked sheet is covered by one transparent button that swallows the tap and opens it; without it the
tap would land in B-3's always-mounted textarea. Expansion is one boolean in the pane, reset when the note changes — a
gesture, not a setting.

**On that sheet the pane wears the phone's clothes.** The way out is `←` in the top left corner rather than `✕` on the
right (X-36) — one control, ordered and lettered by the breakpoint, doing exactly what X-30 already gave it. The peek
draws a `Preview` tag where `NoteBody`'s three format controls sit, because a sheet whose every tap is swallowed cannot
be typed into (X-37). And the sheet is dragged as well as tapped: a swipe up on the peek opens it, a swipe down on the
grip puts it back, and it slides between the two rather than jumping (X-38). `sheetSwipe` in `src/ui/sheet.ts` is what a
travel means and the only part a unit test can see; the open sheet is a `height` of the viewport rather than a `top: 0`,
so the two states are two values of one property, and `.sheet-height` in `src/app.css` is the one declaration that lets
a transition cross the peek's `auto`. A browser without it arrives in one frame, which is what the sheet did before.

**The pane is an editor and nothing else — X-31.** The title, the tags, the body, and K-8's add line as the top row
where `Breadcrumbs` used to be. No path — the column on the left *is* the note's path, in rows. No list of the note's
own children — that same column draws them, nested under the note's own row, and drawing them here put the same rows on
screen twice. K-4 is untouched: the add line still files under the note, and the row it makes appears on the left. The
body takes the height that is left and scrolls inside itself, which is `fill` in `src/ui/NoteBody.svelte` — the `min-h`
floor is what a *page* needs and what the peeked sheet still gets, since flex distributes free space and an auto-height
sheet has none, so X-22's sizing rule is untouched too. Two traps live in that one prop. The field's height is one
expression in the class string and never a `class:h-full` beside it, because a `class:` directive takes its class away
when the condition is false whatever the string said — that is what made the field two rows tall the moment the caret
arrived. And `syncScroll` puts the rendered half under the field's own `scrollTop` on every scroll, because B-3's two
boxes each have a scrollbar now and the transparent one is on top: the wheel reaches the field, and the view that stays
put is the one the reader is looking at.

**The caret is a second way in, and it moves nothing — X-30.** Putting the caret in a **note** row's title raises that
note in the pane; the route, the history and the left column stay exactly where the reader left them. `src/ui/panes.ts`
is the whole of both rules — the pane is the note the caret is in, or the note the route names, and the list is the
route's *always*, which is what makes X-30 true by construction. The caret's note is `RowFocus.noteId`, written only by
a note's title: a caret in a folder or a task leaves the pane as it is, because the caret raises a note and nothing else
lowers it. It is not cleared on blur either — clicking from the title into the note's own body would otherwise close the
pane under the click about to edit it — so exactly two things end it: the ✕, the one control that differs by how the
pane was opened, and a navigation, which hands the question back to the route. Above `lg` only: below it the pane is
X-22's sheet, and a sheet raised by typing would cover the row being typed. The icon on the row still navigates, which
is what moves the left column to `listAbove` the note.

Pages are **left-aligned rather than centred** (X-23), so the list does not slide sideways when the pane opens.
`src/ui/PageTitle.svelte` is the title-and-flag heading both the page and the pane use. requirements.md §10.3,
past_decision.md §14.

### Kinds

Three, and `src/core/types.ts` is the whole list: `folder`, `note`, `task` (K-1). Kind drives rendering and never
structure — any kind may own children — so the only real distinctions are that a task is checkable and a note has a
body. `list` was a fourth until M6 and was a folder with a different icon; `src/core/op-log.ts` reads a `list` in an
older file as a `folder`, which is the only migration there is and is the same read-time normalisation `tags.ts` does.
Nothing rewrites a file to do it, and a peer on an older build reads `folder` without noticing anything happened —
past_decision.md §11.

`src/ui/SidebarLinks.svelte` renders the **top-level** folders and notes and, under each, its immediate folder and note
children — two levels, and it does not recurse (T-10). Every entry carries the tree's own `⋮` menu on its right (T-18),
the same component over the same `actions.ts` list, so nothing can drift into a sidebar-only set of actions; the two
editors a nav entry has nowhere to draw come up disabled, which is the rule `RowActionContext` already had. The second
level is behind a disclosure and **starts closed** (T-17): `sidebarOpen` in `src/app/view-state.svelte.ts` holds the
*open* ids, so a device that never opens one sees the column M6 shipped. It is deliberately not T-8's collapse set — the
nav and the page are two drawings and neither moves the other. Deeper than that is the tree view's, which is what draws
the nesting.

### Today and Tomorrow

Two lists that are **not** the tree — G-1 to G-7, requirements.md §4.4. `AGENDA` in `src/core/types.ts` is a second
parent that is not a node, exactly as `ROOT` is, and an item under it carries `day` (`YYYY-MM-DD`, local): Today is
every agenda item whose day has come, Tomorrow every one whose day has not. **The rollover is a read.** Nothing is
written at midnight and nothing can race — an item filed for tomorrow is in Today tomorrow because the comparison says
so, on every device at its own midnight. past_decision.md §18 says what a `move`-writing rollover would have cost.

`src/core/agenda.ts` is the whole of it: `dayKey`, `nextDayKey`, `agendaRows` and `agendaIds`, over a `now` the caller
passes in — the logic layer still reads no clock. `src/ui/AgendaPage.svelte` is one page asked about two days, reusing
K-8's line (which files under the page's day) and `TreeView`'s `only` set, which is A-4's filter mechanism with a second
caller. The nav entries sit in the corner's own block, under `All` and **above** the rule that starts the tree's rows,
in the corner's weight and colour and with no glyph — so they are pinned where `All` is rather than scrolling with the
lists, and the open one is marked by its background alone.

**More roots mean every walk that stopped at one now stops at three.** `isRoot` in `types.ts` is what they call:
`resolveTree`'s cycle and missing-parent walks — reading `agenda` as a parent that failed to arrive would repair every
agenda item into `All` — the T-7 tombstone walk, `ancestorsOf`, `isAncestorOrSelf`, `listAbove`, `canRestore` and
`canOutdent`, which is what stops Shift-Tab pushing a top-level agenda item into the tree. `rootOf` answers which root a
row hangs under, and `src/ui/paths.ts` is the one place that turns that into a word: `All`, `Today`, `Tomorrow` or
`Timely`, for the breadcrumb, the Done view and search.

The items are otherwise ordinary rows — same ops, same merge, same Done view, same search, same conflict rows. `day` is
an ordinary last-writer-wins field: `op-log.ts` reads and writes it, `compact.ts` drops a superseded one, `conflicts.ts`
offers the one that lost, and `edit.ts`'s `setDay` is both the G-6 menu control and the C-1 restore.

### Timely

A third list that is not the tree either — R-1 to R-8, requirements.md §4.5. `TIMELY` is a third parent beside `ROOT`
and `AGENDA`, holding **tasks only, one level deep**: `canMoveTo` refuses a move whose root would change and a move
*into* a timely row, so indent, `Alt-↓` and a drop-inside are refused by the model rather than by each view.

**A tick does not write `done`.** `tickTimely` in `src/core/edit.ts` writes one `set day` carrying the day the item is
next due, so T-11 never takes the row out of the list and T-12's archive never collects a chore that has no end. Due is
`day <= today` and waiting is `day > today` — G-3's comparison asked a third question — and the row is drawn ticked and
muted while it waits. Un-ticking is the same op writing today.

**The countdown starts at the tick.** `nextDue` in `src/core/timely.ts` is a function of `now` and the period alone; the
day the item was carrying is not an input, which is the whole of R-5. `every` is the period, `<n>d` or `<n>m`, an
ordinary last-writer-wins field — `op-log.ts` reads and writes it, `compact.ts` drops a superseded one, `conflicts.ts`
offers the one that lost, and `setEvery` is the one writer. Months are added by the calendar with the day of the month
clamped, so the 31st repeats on the 30th of a thirty-day month. past_decision.md §19 says what a `lastTicked` field and
a recurrence grammar would have cost.

`src/ui/TimelyPage.svelte` is the page, `src/ui/RepeatChip.svelte` the control on the row and
`src/ui/RepeatEditor.svelte` the count-and-unit editor it opens — the shape `TagChips`/`TagEditor` already had. The nav
entry sits with `All` and the two days, above the rule (R-8), and X-32 gave all four the same full-width target.

### Attributes

Any row carries **tags** (A-1) and a **priority** (A-2), and both are ordinary fields: one `set` op, last-writer-wins, a
conflict row when two devices raced, compaction dropping a superseded one. `src/core/tags.ts` is the only place a tag is
given its shape — case-folded, `#` dropped, sorted, deduplicated, twelve to a row — and it runs at the *decoder* as well
as at the input, so a tag from an older build arrives normalised. A tag set merges whole rather than per member;
past_decision.md §10 says what an OR-set would have cost.

**`#/tags` is the only place a tag narrows anything (A-4, A-7).** `src/ui/TagsPage.svelte` lists every tag in the tree
and then the rows carrying the ones chosen from it, each with the path it sits on — `tagsInTree` and `taggedRows` in
`src/core/filter.ts`, two scans of the materialised tree and no index, exactly as F-4's search is. The chosen tags are
the route (`#/tags/errand,town`) rather than `localStorage`: a page is where the reader already is, so nothing about
them is stored at all, which is a stronger A-5 than the old one.

`parseTagged` in `src/core/tags.ts` is A-8: a `#tag` prefix on the add line tags the row it makes — `#errand #town Buy
milk`. Leading tokens only, so `Buy milk #2` is a title; a line that is only tags writes nothing and keeps what was
typed. `src/ui/QuickAdd.svelte` is the one caller, per line of a K-9 paste as well as per Enter, which is why
`createLastChildren` takes each row's tags rather than the block's.

The tree itself is **not** filtered and `TagFilter.svelte` is gone. The bar cost five rules that each repaired a hole
the one before it opened — hide the non-matching rows, add the ancestors back, override T-8's collapse state, and A-6 to
stop a row vanishing as it was typed — for a mode a tree could be left in. `src/ui/TagChips.svelte` draws a link to `#/tags/<tag>` per chip
(A-10) — one tag rather than the chosen set — and A-6 is withdrawn: tagging at creation is A-8's `#tag` on the add line.

**A tag's colour is the tag's own name (A-9).** `src/core/tag-colour.ts` hashes it to one of sixteen tints and returns a
*number* — even steps of an `oklch` wheel, so a blue and a teal weigh what a red does, and the hash is avalanched
before the remainder because FNV-1a's low bits are its worst ones; `.tag-chip` in `src/app.css` is what a tint looks like, mixed from that hue toward the palette's own `ink`,
`line` and `surface` so one rule serves six themes. Nothing is stored, chosen or merged — a colour per tag as a field
would be a second last-writer-wins value with a conflict row, for a decoration — and a tag is the same colour on the
row, in `TagEditor` and on `#/tags` because all three call the same function. Chosen on `#/tags` is that same hue turned
up (`.tag-chip-chosen`) rather than the accent, which would have taken the tag's colour away exactly when it is being
pointed at.

**The three flag colours are theme tokens** — `flag-low`, `flag-medium`, `flag-high` — so a palette is fourteen
properties rather than eleven and no component names a colour. `themes.test.ts` fails if a theme leaves one out.

### Dragging

`src/ui/drag.svelte.ts` drives T-14 over **pointer** events, never HTML5 drag-and-drop: `dragstart` does not fire on
touch, and every other edit here reaches a phone. The grip captures the pointer, the row under it is found by
hit-testing the document, and the top and bottom quarters of a row mean "above" and "below" while the middle means
"inside". `dropOnto` in `src/core/edit.ts` turns that into one `move` op, and `canDrop` is where T-5 finally has a
gesture that can provoke it — a refused drop is drawn as refused and writes nothing.

### What the normal view leaves out

`resolveTree` drops two things from `children`, and every edit and every view reads the filtered set: a tombstoned
subtree (T-7, inherited) and a row whose own `done` is set (T-11, **not** inherited). Both are still in `tree.nodes`.
`src/core/done.ts` reads them back out for the Done view at `#/done` (T-12), and it is **one list with no distinction
between the two**: a tick and a delete are the same answer to "where did that go?", so `archivedRows` returns both,
newest first by `deletedAt` or `doneAt` — `doneAt` being derived at the fold from the winning `set done`, exactly as
`deletedAt` is, so nothing in the payload learned about it. One control on each row: `unarchive` in `src/core/edit.ts`
clears the tombstone, the tick, or both — T-13, one `restore` op, and the subtree comes back with it because T-7 never
tombstoned the descendants individually. past_decision.md §13.

`src/core/search.ts` at `#/search/<query>` is the other way back to both, and the only one that finds them by name: it
scans the materialised tree per query and stores no index at all (F-4).

### Settings

`#/settings` (`src/ui/SettingsPage.svelte`) is everything about *this device* rather than about the tree — X-12 — and it
is the third and last nav entry, beside Search and Done. Five things sit on it, and only the device name writes an op:

- **The sync folder** (X-15, X-16). What this device writes to, a button that opens it, and a way to point the device at
  another folder. None of it is a fourth adapter method: `src/app/shell.ts` asks the *shell* — the Android bridge, the
  loopback helper's `/shell/open`, the browser — what it can do, and a capability this shell lacks is an absent button.
  X-17's cloud-app picker was here and is withdrawn: nothing in this app may know which provider is under the folder, so
  the catalog could never have a second reader — architecture.md §4.1, past_decision.md §16.

- **The device name** (D-1). The one editor for it; `#/devices` lists what every device calls itself and edits none of
  them, including this one. A device arrives already named (D-5): `src/core/device-name.ts` shapes
  `platform-browser-id4` — `Win-Chro-a3f1` — off the user-agent string `src/app/device.ts` reads, and `Session.open`
  applies it only to a header carrying no name, so a typed one is never overwritten.
- **The log** (D-4). `#/logs` reads this device's own ops back newest first through `src/core/log-view.ts`, with the
  header line's vector above them. Nothing on that page writes.
- **The theme** (X-13). `src/core/themes.ts` is the catalog of six ids, `src/app.css` holds one eleven-token palette per
  id under `[data-theme='…']`, and `src/app/theme.svelte.ts` applies it. `themes.test.ts` fails if catalog and
  stylesheet drift. **No component ever names a colour** — that is what makes a seventh theme a CSS block and nothing
  else. The id is applied by a boot line in `index.html` so a dark theme never flashes light, and it never syncs (X-14).

- **The two picked colours** (X-35). The accent and the ink, over whichever theme is chosen — a swatch that opens the
  system's picker, a hex field beside it, and a reset drawn only while there is something to reset. A pick reaches the
  page as one custom property plus an attribute as the switch, and `src/app.css` holds what it *means*: `accent-soft`,
  `ink-muted` and `ink-faint` are `color-mix`ed with the theme's own surface, which is what makes one picked colour work
  on a light palette and a dark one. **Nothing in TypeScript computes a colour** — `src/core/colour.ts` only decides
  whether a string is one, and `src/app/theme-colour.svelte.ts` is the half that touches `window`. The rule is
  `:root[data-…-pick]`, which matches the root and nothing else, so the six theme swatches keep previewing themselves
  rather than the pick. past_decision.md §20.

- **The keyboard** (X-33). Every key `src/ui/keyboard.ts` binds, written down once as `KEY_HELP` in that same file and
  rendered here — `keyboard.test.ts` fails if a key is bound and taught nowhere, or taught and bound nowhere. It was
  printed on every row's `⋮` menu until M11, which put a reference read once under a control opened ten times a day.

- **The sidebar's type size** (X-25). X-19's fifth, made a per-device choice in four steps — small, normal, large,
  maximal, at 0.8/1/1.2/1.4. `src/core/sidebar-size.ts` is the catalog, `src/app.css` holds one `--sidebar-type`
  multiplier per id, and `src/app/sidebar-size.svelte.ts` applies it as `data-sidebar-size` on the root. **The type
  only, never the width** — the width is X-20's grip, and a preset that moved it would undo a drag the reader made.
  `.sidebar-text`, `.sidebar-note` and `.sidebar-icon` all `calc()` off the one multiplier, which is why a fifth step
  would be a CSS block and a catalog line. It is deliberately *not* a theme: §10.1 holds a theme to fourteen colours and
  to never changing a size, and that is the rule letting the smoke run assert every palette draws the identical DOM. The
  two share only the boot line, for X-14's reason applied to a size.

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
- A new keyboard binding must appear in `KEY_BOUND_ACTIONS` and in `KEY_HELP`, or `src/ui/keyboard.test.ts` fails. It
  must also be defined in `actions.ts`; whether the row menu *draws* it is `menu` on the action — X-34 keeps the four
  reorderings off it, and `src/ui/actions.test.ts` fails if that changes either way.
