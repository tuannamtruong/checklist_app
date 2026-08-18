# Test

What gets tested, at which layer, and with what. The prototype's approach is described as fact; the production runner
follows the stack rather than leading it, and is settled in [§5 Runner and driver](#5-runner-and-driver).

---

## 1. Principles inherited from the prototype

Four rules that `prototype/test/` follows and that are worth keeping regardless of tooling.

**Nothing in the logic layer is mocked.** What runs in a test is the code that ships. `prototype/core/folder-sync.mjs`
takes its folder, its clock and its change callback as arguments, so a headless scenario drives the same module the
browser does. A test that passes is then a statement about the application rather than about a test double.

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
| Merge properties | the logic layer, generated inputs | is the merge commutative, associative, idempotent | partly — `test/e2e/scenario.mjs` check 10 |
| Scenario | the logic layer plus an in-memory folder | do N devices converge across a scripted sequence of edits, races and joins | `test/e2e/scenario.mjs` checks 1–9, against temp directories rather than memory |
| Adapter conformance | each adapter in turn | do all five adapters honour the same three-method contract | — |
| Integration | real files, real processes | does a device reach a real folder through the path its platform forces on it | `test/e2e/bridge.mjs` |
| UI | the page in a browser | does an edit produce exactly one write, does a race raise the panel, does the keyboard model work | `test/ui.mjs`, and `test/android-bridge.mjs` for the Android startup path |
| Platform | the WebView shell, the installed PWA | does startup, the folder grant, and a cold offline launch work on the device | — |

Three of the six are implemented, and merge properties only in the weak form
[§3.1 Merge properties](#31-merge-properties) describes. Adapter conformance and the platform checklist are new work.

## 3. What each layer owes

### 3.1 Merge properties

Requirement S-4 asks for commutative, associative and idempotent merge, property-tested. Concretely: for randomly
generated op sets or snapshot sets, applying them in any order, in any grouping, and more than once must all produce one
state. Property-based generation matters here — hand-written cases find the bugs you thought of.

Vector arithmetic — `join`, `bump`, `dominates`, `equal`, `concurrent` — is exhaustively testable over small vectors and
should be.

The prototype gets part of the way. `test/e2e/scenario.mjs` check 10 runs four devices through 300 randomised edits,
deliveries and syncs drawn from a seeded PRNG, then asserts that all four agree on the text and on the vector; `SEED` in
the environment reproduces any failure exactly. What is missing is what makes S-12 a separate requirement in
[requirements.md §7.2 Not built](requirements.md#72-not-built): the three laws are never asserted, only their
consequence, and a failure arrives as 300 steps rather than shrunk to the two that caused it.

### 3.2 Scenario

The prototype's `test/e2e/scenario.mjs` walks two devices through equal, ahead, behind and concurrent in its first nine
checks, then through all three resolution styles, asserting the exact vector at each step. Its tenth check is the
randomised run in [§3.1 Merge properties](#31-merge-properties).

[prototype/README.md §5.2.7 Sync between two devices](../prototype/README.md#527-sync-between-two-devices) tabulates the
same sequence, so the document and the test are checkable against each other.

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

### 3.3 Adapter conformance

One suite, run against all five adapters, asserting the contract rather than the implementation: `list` returns names
and not paths, `read` of an absent name returns `null` rather than throwing, `write` followed by `read` round-trips
exactly, a write is never observable in a partial state, and names with awkward characters survive. The prototype has no
such suite; each adapter is exercised only by the test that happens to use it, which is how the five drift apart.

### 3.4 Integration

Real folder on disk, real helper process, real browser, and a modelled cloud client that only copies files between two
directories. The prototype's `test/e2e/bridge.mjs` runs the whole loopback-helper path with `showDirectoryPicker`
deleted from the page, which is the only honest way to prove the Firefox path works.

Each run builds its own temp folder, so runs do not contaminate each other.

### 3.5 UI

The prototype drives Chromium and asserts four things: one local edit writes exactly one file, a dominating peer is
adopted silently, a racing peer raises the conflict panel, and resolving dominates both sides. Production adds the
keyboard model — `Enter`, `Tab`/`Shift-Tab`, `Alt-↑`/`Alt-↓`, `Backspace` on an empty row, `Escape` — and the rule that
every keyboard action also exists in the row menu, since phones have no Tab key.

`test/android-bridge.mjs` drives the same page in the same browser with `window.AndroidFolder` replaced by an in-page
stub, which is how the Android startup path — first-run folder pick, edit, conflict, resolution — is exercised without a
JVM. It is a UI test wearing the phone's clothes, not a platform test; the platform layer starts where the stub stops.

A UI test needs a folder that is not a real one. The prototype's `?uitest` mode swaps in the in-memory adapter, with no
disk and no network; production wants the same escape hatch and the same rule that it is reachable only by explicit
opt-in.

### 3.6 Platform

Not automatable on this machine, so it is a written checklist rather than a script: the Android SAF grant surviving a
restart and an app update, a cold offline launch from the home-screen icon, a deep link surviving that cold launch
(X-8), and the maskable icon rendering uncropped on a real launcher (X-4).

## 4. What the tests must not do

- **No assertion on wall-clock time.** Every timestamp in a test comes from an injected `now`.
- **No sleeps as synchronisation.** A sync cycle is invoked, not waited for. The 3 s poll belongs to the app, not to the
  tests.
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

Production commands wait on a `package.json`. The repository has none, so every `npm run` line in
[prototype/README.md §7.2 Test](../prototype/README.md#72-test) names a script that cannot run.

The prototype's tests need no runner, so `node` runs them directly, and does today:

```bash
node prototype/test/e2e/scenario.mjs      # merge rules and randomised convergence, no browser — start here
node prototype/test/e2e/bridge.mjs        # the helper path, on a helper and a temp folder it starts itself
node prototype/test/ui.mjs                # the page in Chromium
node prototype/test/android-bridge.mjs    # the Android startup path, Java bridge stubbed
```

Only the first runs unaided. The other three need Playwright on `NODE_PATH`, and the last two need the helper already
serving on `BASE`, which defaults to `http://localhost:38531`.

The rest of what works today:

```bash
make proto_all           # both prototype bundles
make proto_exe_win       # Windows launcher + desktop shortcut
make proto_android       # Android APK, inside Docker
python3 scripts/md-reflow.py docs/*.md --check
```
