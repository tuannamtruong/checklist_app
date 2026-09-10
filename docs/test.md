# Test

What gets tested, at which layer, and with what. The prototype's approach is described as fact; the production runner
follows the stack rather than leading it, and is settled in [§5 Runner and driver](#5-runner-and-driver).

---

## 1. Principles inherited from the prototype

Four rules the prototype's tests follow and that are worth keeping regardless of tooling.

**Nothing in the logic layer is mocked.** What runs in a test is the code that ships. The sync cycle takes its folder,
its clock and its change callback as arguments, so a headless scenario drives the same module the browser does. A test
that passes is then a statement about the application rather than about a test double.

**A stand-in appears only where the real collaborator cannot run on this machine.** The Android Java bridge is stubbed
in-page because there is no JVM in the test process. The cloud provider's client is modelled because installing one in
CI is absurd. Everything else — files, processes, browsers — is real.

**Every check reports, then the run fails.** Each script runs all of its checks, prints `ok` or `FAIL` per check, and
exits non-zero if any failed. One failure still shows the state of the rest, which is what makes a red run diagnosable
instead of merely red.

**Time is a parameter.** `now` is passed in, never read from the clock, so a scenario asserts exact timestamps and exact
vectors rather than approximations.

## 2. The layers

| Layer | Runs against | Answers | In the prototype |
| --- | --- | --- | --- |
| Merge properties | the logic layer, generated inputs | is the merge commutative, associative, idempotent | partly — `scenario.mjs` check 10 |
| Scenario | the logic layer plus an in-memory folder | do N devices converge across a scripted sequence of edits, races and joins | `scenario.mjs` checks 1–9, against temp directories rather than memory |
| Adapter conformance | each adapter in turn | does every adapter honour the same three-method contract | — |
| Integration | real files, real processes | does a device reach a real folder through the path its platform forces on it | `bridge.mjs` |
| UI | the page in a browser | does an edit produce exactly one write, does a race raise the panel, does the keyboard model work | `ui.mjs`, and `android-bridge.mjs` for the Android startup path |
| Platform | the WebView shell, the installed PWA | does startup, the folder grant, and a cold offline launch work on the device | — |

Three of the six are implemented in the prototype, and merge properties only in the weak form
[§3.1 Merge properties](#31-merge-properties) describes. Five of the six are implemented in production; the platform
layer is a written checklist and stays one.

M1 added production tests at two of the layers. `src/core/*.test.ts` runs the logic layer under Vitest — order keys, the
fold, the T-6 repair, the T-7 tombstone walk and every edit intent — and `scripts/ui-smoke.mjs` drives the built app in
Chromium for the keyboard model, a reload through the op log and a cold start with the network off. Neither mocks
anything below itself: the UI run uses the real `local-folder` adapter, seeded by writing the device file it would have
written.

M2 added the other three that can run on this machine. `src/core/merge.test.ts` is the scenario layer and the
merge-property layer at once — every case in [§3.2 Scenario](#32-scenario), then the three laws over a seeded generator;
`src/app/folder-sync.test.ts` drives one cycle against a folder adapter, including the half-synced file of S-7; and
`src/adapters/conformance.test.ts` is [§3.3 Adapter conformance](#33-adapter-conformance), one suite over four of the
six adapters. The smoke run gained a peer: a second device's file is written into the same folder while the page is
open, and the check is that the row appears without a reload.

## 3. What each layer owes

### 3.1 Merge properties

Requirement S-4 asks for commutative, associative and idempotent merge, property-tested. Concretely: for randomly
generated op sets or snapshot sets, applying them in any order, in any grouping, and more than once must all produce one
state. Property-based generation matters here — hand-written cases find the bugs you thought of.

Vector arithmetic — `join`, `bump`, `dominates`, `equal`, `concurrent` — is exhaustively testable over small vectors and
should be.

`src/core/merge.test.ts` asserts the three laws directly, over op sets from a seeded generator: the fold of a shuffled
set equals the fold of the original (commutative), folding in two groups equals folding at once (associative), and
folding a set twice changes nothing (idempotent). `SEED` in the environment reproduces a failure exactly. What keeps
S-12 open is shrinking — a failure arrives as the whole generated set rather than as the two ops that caused it.

Compaction is a fourth property over the same generator, and it belongs here rather than with the scenarios because it
is the same kind of claim: **the fold of a compacted op set equals the fold of the original**, for every device
compacted, in any combination. `src/core/compact.test.ts` asserts it, along with the two invariants
[sync-flow.md §4.8 The compaction cut](sync-flow.md#48-the-compaction-cut) names — the highest counter survives, and
every retained op reconstructs the vector it had before.

The prototype gets part of the way. Its `scenario.mjs` check 10 runs four devices through 300 randomised edits,
deliveries and syncs drawn from a seeded PRNG, then asserts that all four agree on the text and on the vector; `SEED` in
the environment reproduces any failure exactly. What is missing is what makes S-12 a separate requirement in
[requirements.md §7.2 Not built](requirements.md#72-not-built): the three laws are never asserted, only their
consequence, and a failure arrives as 300 steps rather than shrunk to the two that caused it.

### 3.2 Scenario

The prototype's `scenario.mjs` walks two devices through equal, ahead, behind and concurrent in its first nine checks,
then through all three resolution styles, asserting the exact vector at each step. Its tenth check is the randomised run
in [§3.1 Merge properties](#31-merge-properties).

Its README tabulates the same sequence under *Sync between two devices*, so that document and that test are checkable
against each other.

Production adds the tree cases, and these are the ones that will find bugs:

| Case | Asserts |
| --- | --- |
| Concurrent edits to different subtrees | merge with no user prompt |
| Concurrent edits to one node's title | one race, scoped to that node |
| Concurrent move A→B and B→A | read-time re-rooting picks the oldest `(parentSetAt, device id)` edge, every device drops the same one, and nothing is written (T-6) |
| Moving the re-rooted node back afterwards | an ordinary move breaks the cycle permanently, with no resolve-conflict path |
| Deleting a subtree that contains a cycle | the tombstone walk climbs the resolved parent and terminates (T-6 with T-7) |
| Delete a subtree while a peer edits inside it | tombstone wins over the whole subtree (T-7) |
| A third device joins mid-sequence | no registration step, converges from an empty vector |
| A device offline across many peer edits, then returning | fast-forward without a spurious race |
| Sibling ordering under concurrent insertion | every device derives one order (T-2) |
| Deleting a row, then restoring it | the tombstone clears and the row returns to the list it came from, at the order key it kept (T-13) |
| Concurrent delete and restore of one row | `deleted` resolves by `(at, device id)` like any other field, and the loser is offered back (T-13, C-4) |
| Compacting one device's log mid-sequence | every device still derives the identical tree, and the compacted file is not skipped as a stale read (S-14) |

### 3.3 Adapter conformance

One suite, run against every adapter, asserting the contract rather than the implementation: `list` returns names and
not paths, `read` of an absent name returns `null` rather than throwing, `write` followed by `read` round-trips exactly,
a write is never observable in a partial state, and names with awkward characters survive. The prototype has no such
suite; each adapter is exercised only by the test that happens to use it, which is how adapters drift apart.

`src/adapters/conformance.ts` is that suite, and `conformance.test.ts` runs it over four of the six: `memory-folder`,
`local-folder` against a fake `Storage`, `android-folder` against a stubbed bridge, and `http-folder` against a loopback
server the test starts and stops itself. Two are not in it, for different reasons. `fsaa-folder` needs a directory
handle, which needs a picker and a real user gesture, so no headless run can hold one — it is on
[§3.6 Platform](#36-platform)'s checklist instead. `node-folder` has no production caller at all. The partial-write
clause is the one the suite cannot assert from inside a page either: a writer cannot observe its own write being
partial, and the property belongs to the provider's client — S-8.

### 3.4 Integration

Real folder on disk, real helper process, real browser, and a modelled cloud client that only copies files between two
directories. The prototype's `bridge.mjs` runs the whole loopback-helper path with `showDirectoryPicker` deleted from
the page, which is the only honest way to prove the Firefox path works.

Each run builds its own temp folder, so runs do not contaminate each other.

### 3.5 UI

The prototype drives Chromium and asserts four things: one local edit writes exactly one file, a dominating peer is
adopted silently, a racing peer raises the conflict panel, and resolving dominates both sides. Production adds the
keyboard model — `Enter`, `Tab`/`Shift-Tab`, `Alt-↑`/`Alt-↓`, `Backspace` on an empty row, `Escape` — and the rule that
every keyboard action also exists in the row menu, since phones have no Tab key.

Two of the checks are about what is *not* on screen, which a unit test cannot see: ticking a row makes it leave the tree
and the sidebar (T-11), and the Done view at `#/done` then holds it in one list with every deleted row, newest first,
each with the path it sat on (T-12). The one Restore control there returns a ticked row to the tree it came from, and
since M3 a deleted one too — T-13, which the smoke run checks by deleting a row with a child, restoring it from
`#/done`, and asserting the child came back with it.

M3 adds two more views to drive: `#/search` for [requirements.md §6 Search](requirements.md#6-search) — that a query
finds a title, a note body, and a row T-11 has hidden — and `#/devices` for D-1, that a name typed there survives a
reload, which is the only way to see that it reached the file rather than the page.

`#/logs` is driven from the settings screen it hangs off, for D-4: that the link is in the "This device" section, and
that the newest entry names the edit the run has just made. What the unit test cannot see is the ordering the page
exists for — the log reads from the end, and every other list in the app reads from the start.

M4 adds `#/settings`, and the two checks there are the two a unit test cannot make. The name typed into it survives a
reload (D-1), which is the only way to see that it reached the file rather than the page; and picking a theme sets
`data-theme` on the document root, repaints the tree, and is still set after a reload (X-13, X-14). Contrast is not
asserted — it is a screenshot per theme, which is what a person can check and a script cannot. What the script does
assert about the rest of the palette is that no theme changes the layout: the app is measured for horizontal overflow
under the widest one, and every theme renders the same DOM.

X-25 puts a third check on that screen, and it is the same shape as the theme's without being the theme's: every step in
the catalog is offered, picking one sets `data-sidebar-size` on the document root, and the sidebar's type is measurably
larger afterwards — the computed `font-size` of a sidebar link, which is the only thing that can say the multiplier
reached the rule rather than only the attribute. It survives a reload, for X-14's reason applied to a size. The check
that matters most is the negative one: the *width* of the sidebar does not move when the type does, because that width
is X-20's and a setting that quietly resized the column would undo a drag the reader made.

X-35 puts a fourth check on that screen, and it is about the half of a pick that lives in CSS. Typing a hex code into
the theme-colour field puts `--accent-pick` on the document root, and the assertion is not the property but its effect:
a control wearing `bg-accent` is measurably that colour afterwards, which is the only thing that can say the pick
reached the rule rather than only the attribute. The derived tokens are checked the same way and in the direction that
matters — `ink-faint` under a picked ink is neither the ink itself nor the theme's — and the pick survives a reload and
is gone again when cleared. Contrast is not asserted here either, for the reason the palettes are not: it is a
screenshot, before and after.

D-5 puts one more check on that screen, and it is a check about a field nobody has touched: the device name is already
filled in on a first launch, it matches `platform-browser-id4`, and its last four characters are the first four of the
device id shown beside it. The mapping itself is a unit test — `src/core/device-name.test.ts` over a table of real
user-agent strings, including the Android WebView the bundle runs in, which is the one string where "the browser" is not
a browser the user chose.

M5's other three features are driven end to end, because each of them is a claim about what is on screen rather than
about a value. The drag (T-14) is driven with the pointer, not with a synthesised drag event: down on the grip, move, up
— and once with a drop into the dragged row's own child, which asserts the refusal T-5 has carried since M1 with no UI
able to provoke it. Tags and the flag (A-1, A-2) are typed and clicked the way a person does, including the hash and the
capital that `cleanTag` folds away, and the filter (A-4, A-6) is checked for the two things a unit test cannot see: that
the tree shows a match *and the path to it*, and that a row created while the filter is on carries the filter's tags
rather than vanishing as it is typed.

M6 puts one line in the peer's file for the same reason: it names `list`, a kind K-1 no longer has, and the smoke run
asserts the row arrives as a folder rather than as a line that will not parse. The decoder's own rule is
`op-log.test.ts`'s; what only the browser run shows is that it holds along the path a peer's file actually takes —
decode, merge, re-fold, render — which is where losing a row on upgrade would actually happen.

M7's body formatting is checked at both layers, and the split is the useful part. `markup.test.ts` is a table of bodies
through the parser and the two controls — what a mark means, what an unmatched one means, where the caret lands — and
`search.test.ts` asserts the one thing B-5 exists for: a term that reaches across a mark still finds the note, and the
snippet comes back without it. What only the browser can show is B-3's two views of one value: the marks are on screen
with the caret in the field and the formatting is on screen without it, and the value that survives a reload is the one
with the marks in it.

B-7 is checked as geometry, which is unusual here and is the point: a textarea has no range geometry, so the controls
are placed by laying the text out a second time in a mirror element
([requirements.md §4.3 Marks in a note body](requirements.md#43-marks-in-a-note-body)), and the only thing that can say
the measurement landed on the selected line rather than at the origin is a real browser measuring the rendered result.
The run selects a word, asserts the controls sit inside the field's box and level with the line, uses them, and asserts
they go when the selection does.

A-9's tag colours split the same way as everything else here: `tag-colour.test.ts` asserts what the hash promises — a
tint for every name, the same one every time, and more than one tint across a handful of ordinary tags — and it asserts
the *seam*, that `app.css` still holds the rule the number feeds. The browser owns the rest, because a colour is a
computed style: the run reads two tags' computed colour on the Tags page and asserts they differ, and reads one tag's
tint on its row in the tree and on the page and asserts they match, which is the whole of "derived from the name and
stored nowhere".

B-8's code box is checked in the browser for a reason the parser cannot reach: it is the one thing on the rendered half
that is also a control, and B-3 keeps a transparent field over that half. The run makes a box from the control, asserts
the fences landed around what was then typed, selects a run inside a line and asserts the same control wrote backticks
instead, and then clicks Copy and reads the clipboard back — which is what says the button is above the field rather
than under it. `markup.test.ts` owns everything else about the two marks, including the fence that never closed.

B-10 splits the same way. `markup.test.ts` owns what a marker means, what Enter means on an item and what it means on an
empty one, and the browser owns the one thing that is not a function of the string: the marker is *typed* into the field
with `insertText` so the field's own undo can take it back, and only a real field has an undo stack. The run types two
items, presses Enter on the empty third, and asserts the marker came off rather than the list carrying on.

K-9 is a browser check for a reason a unit test cannot get at: the split itself is `paste.test.ts`'s, but the event that
carries a clipboard into an input only exists in a browser. The smoke run dispatches one over the quick-add line with
something already typed in it, and asserts the three things the rule promises — a row per line, in the pasted order, the
blank line making none of them, and the text that was already there joined to the first.

M5 adds the sync folder section, and what the smoke run can assert about it is narrow on purpose: the section and the
sidebar each name the unsynced fallback in their own words, and a shell that cannot open a folder offers no button for
it
([requirements.md §10.2 The sync folder, on the settings screen](requirements.md#102-the-sync-folder-on-the-settings-screen)).
The buttons themselves are [§3.6 Platform](#36-platform)'s — a file manager opening is an event that happens outside the
browser, and the run that could see it is the one on a real phone and a real desktop.

M8's split is a browser check almost entirely, because every claim it makes is about what is on screen at a given width.
Above `lg` the run opens a note and asserts both panes are there at once — the list it came from still showing its rows,
the note beside it with its body — and that closing the note leaves the list where it was rather than sliding it back to
the middle (X-21, X-23). The left edge is measured, not eyeballed: the list's column has the same `x` with the pane open
and with it shut, which is the whole of X-23 and the one thing a screenshot would not catch.

Two more numbers come out of the same page. Opening a note *nested inside* the open note swaps the pane and leaves the
left column showing the same list, which is X-21's walk past every note ancestor — asserted as the left column's title
being unchanged while the pane's is the sub-note's, since a check that only read the pane would pass on the old drawing
too. And the divider is dragged, which is X-20's check on the other grip: the pane is wider by roughly what the pointer
moved, it survives a reload, and the arrow keys move it without a pointer at all (X-24). `listAbove` is the unit half of
the first — `tree.test.ts` walks a note under a note under a folder — and `view-state.svelte.test.ts` the unit half of
the second.

The phone half is X-22, and it is checked as three numbers and a tap. A long note's sheet is no taller than 60% of the
viewport; a short one is shorter than that, which is what "depends on the length of the content" means and what
distinguishes the rule from a fixed height; and a tap anywhere on the peeked sheet — on the body, where B-3's
transparent textarea is waiting — expands it without putting a caret in the field. The unit layer holds none of this:
the height is a CSS rule over rendered content and the tap target is a layer that exists only while the sheet is peeked,
so a real browser at 390px is the only thing that can see either.

X-30 is two halves and the unit half carries most of it. `panes.test.ts` is a table over the one derivation — which note
the pane draws and which list is beside it, given a route and the note the caret is in — and `focus.svelte.test.ts` is
the rule that feeds it: a note's title raises the pane, a folder's and a task's leave it exactly where it was, and only
the ✕ and a navigation clear it. Between them they hold the cases a browser would be slow to reach, including the two
that close a pane without touching the caret at all: a peer deleting the note under it (T-7) and the row menu turning it
into a folder (K-5).

The browser half is the claim the unit tests cannot make, and it is one measurement: the caret goes into a nested note's
title, the pane opens, and the left column's title and `x` are both what they were before — the route's list, not the
note's parent, and not moved sideways. The run then checks what the composition owns and the unit layer cannot see: the
✕ on a caret-raised pane clears it without changing the hash, a caret moved to a folder and then to a task leaves both
columns alone, a navigation closes it rather than carrying it to the next page, and at 390px the same caret raises no
sheet at all. The contrast is checked beside it, because it is the requirement's own argument: the icon on that same row
*does* move the left column, to the list above the note.

X-29 is checked at a deliberately short window, because that is the cheapest way to make the seeded tree taller than the
viewport and the claim is only about what scrolling one column does to the other. Three numbers say it: the document
itself does not scroll at all, the sidebar's box has the same `y` after the page column is scrolled as before, and the
sidebar is exactly the window's height rather than the page's. The last one is what would fail if the shell ever went
back to a `min-height`, which is the shape of the bug — the nav's `overflow-y-auto` was there the whole time and could
not fire inside a column with no ceiling. There is no unit half: a height that comes from a flex parent is layout, and
layout is the browser's answer.

The prototype's `android-bridge.mjs` drives the same page in the same browser with `window.AndroidFolder` replaced by an
in-page stub, which is how the Android startup path — first-run folder pick, edit, conflict, resolution — is exercised
without a JVM. It is a UI test wearing the phone's clothes, not a platform test; the platform layer starts where the
stub stops.

A UI test needs a folder that is not a real one. The prototype's `?uitest` mode swaps in the in-memory adapter, with no
disk and no network; production wants the same escape hatch and the same rule that it is reachable only by explicit
opt-in.

### 3.6 Platform

Not automatable on this machine, so it is a written checklist rather than a script: the Android SAF grant surviving a
restart and an app update, a cold offline launch from the home-screen icon, a deep link surviving that cold launch
(X-8), and the maskable icon rendering uncropped on a real launcher (X-4).

M3 built the two bundles that make the rest of this checklist reachable, and none of it has been walked yet —
[requirements.md §15 Deviations and defects found during verification](requirements.md#15-deviations-and-defects-found-during-verification)
row 10. In the order that finds the most:

| # | Check | Answers |
| --- | --- | --- |
| 1 | Install `bundles/checklist.apk`, grant a folder in the provider's synced directory, add a row | The SAF grant and the Android adapter against a real client |
| 2 | Force-stop the app, reopen it | `takePersistableUriPermission` survived, so there is no second prompt |
| 3 | Unzip `checklist-windows.zip` on Windows, double-click `Setup.vbs`, pick the folder, point Firefox at it | The loopback helper path, which no headless run can hold |
| 3b | In that Firefox, on a device that says "Local storage", reload the page | X-18 against a real Firefox rather than a Chromium with `showDirectoryPicker` deleted: the folder is taken on load, and the reload is the whole gesture. `folder-choice.test.ts` covers the decision and the smoke run cannot — `vite preview` serves no `/folder/info`, so there is never a folder to take |
| 3a | Launch it again from the desktop icon | No console window appears at any point, and the folder is not asked for twice — [architecture.md §7.1 The two Windows bundles](architecture.md#71-the-two-windows-bundles) |
| 4 | Edit on the phone, wait for the provider's client, refresh on Windows | Provider latency and partial files — [sync-flow.md §7 What is still open](sync-flow.md#7-what-is-still-open) item 5 |
| 5 | Edit both while both are offline, then reconnect | A real race with a real clock skew between two real devices |
| 6 | Leave it running for long enough for the compaction trigger to fire | S-14 against a provider's client, which re-uploads the whole file when it shrinks |
| 7 | On the phone and on Windows, open Settings and press "Open the folder" | X-15 on both shells: the file app shows the granted tree, and Explorer shows the folder the launcher was given |

Check 6 is the one with a genuinely unknown answer. Every other row exercises code that a test already covers with a
stand-in; a provider's reaction to a file that got *smaller* is behaviour nothing here has ever observed.

## 4. What the tests must not do

- **No assertion on wall-clock time.** Every timestamp in a test comes from an injected `now`.
- **No sleeps as synchronisation.** A sync cycle is invoked, not waited for. The 3 s poll belongs to the app, not to the
  tests. The browser run cannot invoke the write path the way a unit test can, so it waits for the *file* instead of for
  a clock: `landed()` in `scripts/ui-smoke.mjs` polls the folder until the op is in it, because a fixed pause is a race
  against the 250 ms write debounce that a busy main thread sometimes wins — and it fails as "the edit did not survive a
  reload", which is a sentence about the application that was not true.
- **No remote network.** Nothing a test does leaves the machine. Loopback is the one exception, and only because it is
  the subject: [§3.4 Integration](#34-integration) starts the helper on `127.0.0.1:38531` and drives `http-folder`
  against it, which is the Firefox path.
- **No shared fixture folder.** Each run builds and removes its own.

## 5. Runner and driver

**Vitest, with Playwright Test for the browser layers and a property-based library for
[§3.1 Merge properties](#31-merge-properties).**

The prototype uses no test runner at all — plain Node scripts and hand-rolled `ok`/`FAIL` reporting. That was right for
a prototype and worth re-deciding for a codebase meant to last. The stack settled it:
[architecture.md §6 Technology stack](architecture.md#6-technology-stack) chose Vite, and a second build pipeline for
the tests would cost a dependency tree and return nothing.

| Option | For | Against |
| --- | --- | --- |
| 1. Plain Node scripts, as now | Zero dependencies; the scripts are readable start to finish; already written and working | Reporting, filtering, watch mode and parallelism are all hand-built; no coverage without extra work; failures report less context than a real runner |
| 2. `node:test` built in | No dependency, TAP output, filtering and watch included; runs anywhere Node runs | Weaker assertion and mocking ergonomics; ESM plus TypeScript needs a loader flag; smaller ecosystem of reporters |
| 3. Vitest — **chosen** | Fastest feedback loop of the options; native TypeScript and ESM; browser-mode and coverage in one tool; watch mode is genuinely good | Ties the test setup to Vite, the build tool chosen in [architecture.md §6 Technology stack](architecture.md#6-technology-stack) — which is an argument for it here, not against; a dependency tree to keep current |
| 4. Playwright Test for the browser layers — **chosen** | Purpose-built for what the UI and integration layers actually do — real browsers, traces, screenshots on failure, retries; already installed on this machine, and the prototype's three browser tests already import the library | Wrong shape for pure unit tests, so it arrives alongside one of options 1–3 rather than instead of them |
| 5. Property-based library alongside any of the above — **chosen** | The only realistic way to satisfy S-12; shrinking turns a random failure into a minimal reproduction | Adds a second style of test to read; a slow property suite gets skipped, which is worse than not having it |

Options 4 and 5 were never alternatives to 1–3 — they arrive alongside whichever of the three wins. What reopens the
choice is the stack changing, not the test suite growing.

## 6. Commands

Production, as of M3:

```bash
npm test              # Vitest over src/**/*.test.ts — the logic layer, the merge, the adapters, the row-action parity
npm run check         # svelte-check, in strict TypeScript
npm run ui-smoke      # builds, serves dist/ on 38531, drives Chromium, screenshots to ui-smoke/
npm run seed          # the same app with a small tree in it, in a window, to look at
npm run make-icons    # re-render the PWA PNGs from public/icons/*.svg
```

The two bundles are built rather than tested, and what they produce is on [§3.6 Platform](#36-platform)'s checklist
rather than in any script:

```bash
make windows          # bundles/checklist-windows.zip — web assets, the helper, Setup.vbs
make apk              # bundles/checklist.apk, built in Docker
```

`ui-smoke` and `seed` need Playwright on `NODE_PATH`, which is installed on this machine rather than in the project:

```bash
NODE_PATH=/home/nam/.npm/_npx/e41f203b7505f1fb/node_modules npm run ui-smoke
```

The prototype's tests are its own project's and do not run from this tree.

The rest of what works today:

```bash
python3 scripts/md-reflow.py docs/*.md --check
```
