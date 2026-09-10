# Past decisions

History of project's decision. The situation, its options and resolution.

## 1. Decision log

| Decision | Chosen | Over | 
| --- | --- | --- | 
| [Tech stack](#2-tech-stack) | Vite + TypeScript + Svelte, in a browser | Kotlin, Dart, Rust, Go, C#/.NET, React Native; and vanilla ESM, React, Lit | 
| [T-6 Cyclic tree state](sync-flow.md#62-the-repair) | Drop the cycle edge with the oldest `(parentSetAt, device id)` at read time, never written | - non-temporal tiebreak (node id)<br>- Prevention by limitting hierarchy level (flat groups)<br> -pre-defined hierarchy folder->list->item |
| [Sync data model](#4-sync-data-model) | append-only op log per device | -  whole-tree snapshot per device<br>-  snapshot plus op tail<br>-  one file per node |  
| [State Management](#3-state-management) | Materialised State Store, reactive views | -  prototype logic, scaled up<br>-  local database, folder as a sync target<br>-  event-driven<br>-  CRDT document | 
| [Compaction](#6-compaction) | Drop a device's own superseded ops, in place | -  snapshot plus tail (option C)<br>-  note-body diffing against a checkpoint<br>-  reaping tombstones<br>-  a retention window in days |
| [Undelete](#7-undelete) | A `restore` op, making `deleted` an ordinary contested field | -  a `set` carrying `deleted: false`<br>-  copying the subtree to a new id<br>-  delete-always-wins precedence |
| [Device naming](#8-device-naming) | Each device names itself, in its own file's header line | -  a shared `devices.json`<br>-  a `device` op in the log<br>-  names kept only in `localStorage` |
| [Theming](#9-theming) | Swap the semantic tokens under `data-theme` on the document root | -  a stylesheet per theme, loaded at runtime<br>-  Tailwind's `dark:` variant on every component<br>-  `prefers-color-scheme` and no choice at all |
| [A picked colour, over the theme](#20-a-picked-colour-over-the-theme) | Two picks — the accent and the ink — laid over the chosen theme, with the three related tokens mixed from them | -  a full fourteen-token editor<br>-  a seventh, user-owned theme<br>-  one seed colour re-tinting the whole palette<br>-  a longer catalog of ready-made themes |
| [Retiring the `list` kind](#11-retiring-the-list-kind) | Read `list` as `folder` at the decoder, and leave every file alone | -  keeping the kind<br>-  a migration pass that rewrites the log<br>-  a log version bump |
| [Formatting in a note body](#12-formatting-in-a-note-body) | A Markdown subset stored in the body string | -  a rich editor over `contenteditable`, storing HTML<br>-  a JSON document model in a new field<br>-  a `heading` kind of row<br>-  no formatting at all |
| [One archive rather than two lists](#13-one-archive-rather-than-two-lists) | One list of everything the tree no longer shows, ordered by when it left | -  keeping the finished and deleted lists apart<br>-  one list with a badge saying which kind of gone<br>-  a separate `archived_at` field on the op |
| [A note beside the list](#14-a-note-beside-the-list-rather-than-instead-of-it) | One route drawing two panes, the list derived from the note | -  a second route carrying both ids<br>-  the pane as device-local state beside the route<br>-  splitting every kind, not just notes<br>-  a preview popover over the row |
| [The caret opens the note pane](#144-the-caret-opens-the-pane-too) | The caret raises the pane and the route does not move | -  the caret navigating like the icon<br>-  a route carrying both ids<br>-  remembering the list beside the route<br>-  the icon as the only way in |
| [What the note pane draws](#146-what-the-pane-draws--x-31) | The title, the tags and the body, with the body filling the pane | -  the note's page redrawn in a column<br>-  keeping the children under the body<br>-  dropping the tree's nesting under a note instead |
| [Retiring the cloud-app launcher](#16-retiring-the-cloud-app-launcher) | Remove X-17 outright — no catalog, no stored provider, no launch capability | -  keeping the button and dropping only the picker<br>-  a free-text command instead of a catalog<br>-  detecting the provider from the folder's path |

---

## 2. Tech stack

**Vite + TypeScript + Svelte, in a browser.**

[X-10](requirements.md#10-application-shell-pwa-offline) "the UI repaints on any data change, including one merged from
a peer" means arbitrary nodes can change from outside the UI every sync cycle, so hand-written DOM would mean
hand-written reconciliation against a recursive tree. Svelte compiles to targeted DOM mutations, so a peer renaming one
node touches one text node rather than re-rendering a subtree that may contain the focused input, which is what keeps a
caret alive across a background merge.

The cost: a smaller ecosystem than React's and Svelte 5's runes are recent enough that generated code sometimes reverts
to Svelte 4 idioms.

### 2.1 Language options

The prototype is JavaScript because a browser was the fastest way to answer four questions about folders, not because
the sync design requires one. The design needs `list`, `read`, `write` over a folder the user picked, and every
candidate below can do that. Each was weighed against the same four constraints: Android's folder grant is a Storage
Access Framework call that lives on the JVM, Windows warns on unsigned binaries, the app is mostly editable text, and
one person maintains it.

| Option | The case against | Would have won if |
| --- | --- | --- |
| **TypeScript — a browser (chosen)** | Ships no native shell of its own, so Android needs the Java SAF bridge and Firefox needs the loopback helper for packaging | — |
| Kotlin — Multiplatform + Compose | The only option where Android is easy, since SAF is native Kotlin. Then Windows needs a bundled JRE — an installer and a SmartScreen prompt, undoing the one clean result the prototype had | Android were the only target, or a signed Windows installer were acceptable |
| Dart — Flutter | Two native builds and an unsigned Windows binary, and the UI is Flutter's rendering model, so nothing survives a later move back to the web | The phone came first and the desktop were an afterthought |
| Rust — Tauri 2 | Does not remove the web UI language: this is Rust *plus* TypeScript, not instead of it. Also rejected as a **packaging** option once Firefox was demoted to nice-to-have — see [architecture.md §7 Packaging](architecture.md#7-packaging) | Firefox on Windows were a hard requirement, or the desktop had to run without a browser |
| Go — Gio or Fyne | Weakest text editing of the candidates, and the app is mostly editable text. The Java SAF shim survives anyway, so the bridge is rewritten rather than saved | The app were a daemon or a CLI. Still the best candidate for the **loopback helper** specifically |
| C# — .NET MAUI | Its Windows target must be built on Windows and it has no Linux target. Every build here is driven from WSL | Development moved to a Windows host |
| C# — Avalonia | Builds from Linux and targets both platforms, so it clears MAUI's blocker. Text editing is still behind a browser's, which is the app's core interaction | A native desktop feel outranked text-editing maturity |
| C# — Blazor WebAssembly | Keeps the browser and swaps only the language, but ships the .NET WASM runtime on a cold offline start, against [X-5](requirements.md#10-application-shell-pwa-offline) | C# were a hard requirement |
| Xamarin | End of support 1 May 2024. Superseded by MAUI | Never. Material describing it is describing a dead product |
| React Native, with react-native-windows | Renders native widgets, so it discards the web UI rather than packaging it. `react-native-windows` builds through MSBuild on Windows only and trails upstream | Native widgets were wanted over a web UI in the first place |

### 2.2 In-browser stack options

All five satisfied the hard constraints — static hosting, no server, full offline, one layout for desktop and phone — so
those did not discriminate. [X-10](requirements.md#10-application-shell-pwa-offline) did.

| Option | The case against | Would have won if |
| --- | --- | --- |
| 1. Vanilla ES modules, no build | [X-10](requirements.md#10-application-shell-pwa-offline) turns into hand-written reconciliation for remote patches against a recursive tree. No types on the merge logic either, which is where a type error costs most | The UI stayed a flat list with no background merges |
| 2. Vite + TypeScript, no framework | Types where they pay, but types do not render a tree — the [X-10](requirements.md#10-application-shell-pwa-offline) problem is unchanged | Same as option 1, with the merge logic typed |
| 3. Vite + TypeScript + React | The named fallback, and the closest call. Caret preservation across a background merge is a matter of re-render discipline rather than construction, and the tree is the whole app | Ecosystem depth and assistance quality outweighed fit. Still the option to switch to if Svelte's smaller ecosystem starts costing real time |
| **4. Vite + TypeScript + Svelte (chosen)** | A smaller ecosystem than React's, and Svelte 5's runes are recent enough that generated code sometimes reverts to Svelte 4 idioms | — |
| 5. Vite + TypeScript + Lit | Weakest state handling of the component options, and its styling model fights Tailwind. It buys framework-independence that the logic layer already provides | Components had to outlive the framework — which the logic layer makes unnecessary |

### 2.3 What made this decision cheap

The logic layer is why. If Svelte turns out to be wrong, what changes is the components, not the merge, the sync cycle
or the adapters. Worth remembering before spending more time on a future stack argument than the switch would cost.

---

## 3. State Management

**B — Materialised State Store, reactive views.** One store object holds the tree and publishes changes; the view layer
re-renders the affected subtree. The folder remains the only persistence.

### 3.1 The options

| Option | The idea | Its cost | Would have won if |
| --- | --- | --- | --- |
| A — prototype logic, scaled up | An in-memory object plus hand-written DOM updates. The folder is the only persistence | Rewrites the whole tree on every change, and rendering a nested tree by hand grows unpleasant fast. No history, so undo is built separately | Shipping early outranked everything, and the tree stayed a flat list. It is the only option already proven end to end |
| **B — Materialised State Store (chosen)** | One store holds the tree and publishes changes; views re-render the affected subtree. Folder still the only persistence | Still rewrites the full state on each save. Buys a framework dependency | — |
| C — local database | IndexedDB is the working set; a sync module reads and writes the folder on its own schedule | Two sources of truth to keep agreeing, and schema migrations become a permanent chore. Reverses the prototype's deliberate finding that no database is needed | The tree grew past what memory holds for free, or many devices went offline for long stretches. Its leading argument — cold start without the folder — was already removed by [architecture.md §7.3 Accepted limits](architecture.md#73-accepted-limits) accepting a lapsed grant as a rare click |
| D — Log-Derived State | The op log *is* the model; every view is a projection replayed from ops | Every read path goes through a replay, so snapshotting inside the app becomes necessary early. Hardest option to debug when a projection disagrees with expectation | Undo, history and per-device attribution had to be properties of the model rather than features — and only alongside an op-log payload |
| E — CRDT document | A library document (Automerge, Yjs) holds the tree; its own encoding is what lands in the folder | The folder stops being readable — a binary document cannot be inspected, diffed or hand-repaired, which is a stated attraction of the whole design. Bundle size, and a dependency that dictates the data model | Owning merge logic stopped being acceptable, and an opaque folder were a fair trade for never writing a conflict UI |

### 3.2 The five options are answers to two questions

Every option is a pair of answers to two independent questions:

**What is the model, that builds the application state?** The current state (A, B, C), or the history that produced it
(D, E).

**How the UI finds out something changed?** User by hand (A) or a subscription (B, C, D, E).

The app does not *need history in the model and need to stop holding the tree in memory?* -> B. Undo is wanted
eventually but is not worth making every read a replay, and a one-person checklist tree fits in memory with room to
spare.

## 4. Sync data model

**An append-only op log per device**, `checklist.<device-id>.ops.jsonl`.


 The full comparison is [sync-flow.md §4.5 Comparison](sync-flow.md#45-comparison) and the reasoning is
 [sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision); what follows is only the record of what was not taken.

This is the decision the rest of the application hung off, and it closed milestone M0.

### 4.1 The options

| Option | The idea | Its cost | Would have won if |
| --- | --- | --- | --- |
| A — whole-tree snapshot per device | The prototype exactly, with a tree where the string was | Conflict granularity is the whole database, so one tick and one unrelated rename become a choice between two trees with one real edit lost either way | Shipping the proven thing outranked everything and the tree stayed a flat list. It is the only option already proven end to end |
| **B — append-only op log (chosen)** | One op per line per device; state is the fold of every log | The log grows until compaction exists, and the cut rule is genuinely hard for a peer months behind | — |
| C — snapshot plus op tail | A periodic full snapshot per device, plus the ops since it | Two formats that must mean the same thing, and the ordering "old snapshot, new tail" loses ops outright | Growth or cold start actually hurt. **It still will** — C is a strict superset of B, so this is the planned evolution rather than a rejection, and its trigger is total log bytes exceeding device count × serialised tree bytes |
| D — one file per node | The folder mirrors the checklist; each node is its own file | File count grows with the tree, and cloud clients degrade on thousands of small files. A move or a subtree delete stops being atomic | A running Windows and Android build showed a provider syncing thousands of small files without latency or quota cost. That observation is deferred, which is what ruled D out rather than leaving it neutral |
| E — CRDT document | A library document holds the tree and its encoding lands in the folder | — | Already closed one level up by [§3 State Management](#3-state-management); it was never independently available here |

### 4.2 Two rules that came out of it

**Version vectors are never pruned.** An absent counter means zero, which is indistinguishable from never having seen
that device, so pruning turns agreement into a false race — and an epoch attribute that claims otherwise turns it into
silent data loss. Keeping the vector whole costs about twenty bytes per device forever. The saving that pruning was
reaching for is available losslessly by carrying a delta vector per op instead of a full one.

**Compaction is deferred, not solved.** The cut rule is the one thing M0 left genuinely open, and it blocks nothing
before M3.
## 5. Reading a folder of logs

Four decisions M2 made while building [§4 Sync data model](#4-sync-data-model)'s payload into a working cycle. None of
them reopens the payload; each one is a place where the obvious implementation is wrong for a reason worth keeping.

| Decision | Chosen | Over | Would be reopened by |
| --- | --- | --- | --- |
| Applying a peer's ops | Re-fold the whole op set whenever a cycle delivers anything | Applying the new ops onto the tree in arrival order; per-field timestamps carried on the node | A log large enough that a fold costs more than a frame — which is compaction's problem (S-14) and arrives with it |
| Receipts | Counted from the ops actually held, per peer file | Joining the vector out of a peer's header, which is the cheaper-looking read | Nothing: it is the difference between under-claiming and over-claiming, and only one of those loses data |
| The user-facing race | One row that states the resolution and offers the value it dropped | A prompt asking which of two states to keep, as the maximal set implies | A payload where the unit of conflict is the file again, which is option A |
| A browser with no folder | Fall back to `local-folder` and say so, permanently, in the footer | Refusing to start; a read-only mode; silently pretending to sync | Nothing. The alternative to being honest here is a user who believes their phone has their tree |

**Why not apply a peer's ops incrementally.** It is the natural implementation and it is wrong in a way that does not
show up in a two-device test. A peer's op usually arrives *older* than ops already applied — that is what being offline
means — so laying it on top turns last-writer-wins into last-arriving-wins. Two devices that received the same ops in a
different order would then hold different trees, permanently, with nothing in either file to say which was right. The
alternative that does work incrementally is a timestamp per field per node, which is a bigger node, a bigger file, and
the same answer.

**Why the conflict row is not a prompt.** Under the op log both values are on disk and the fold has already picked one
by `(at, device id)`. Asking the user to choose would mean either blocking the merge until they answered — on a device
that may not be opened for a week — or asking about a decision already taken. Stating it and offering to reverse it is
the same information with none of the waiting, and the reversal is an ordinary `set` that dominates both sides, so there
is no resolution protocol to write, test or converge.

## 6. Compaction

**Drop those of a device's own ops that a later op of its own overwrites, rewriting its own file in place.** The rule
and its safety argument are [sync-flow.md §4.8 The compaction cut](sync-flow.md#48-the-compaction-cut); what follows is
only the record of what was not taken.

S-14 was the one requirement milestone M0 deferred as genuinely hard, and it was hard because the question was assumed
to be "how does a device summarise the folder". It is not. A device may only write its own file, so the only ops it can
ever drop are its own, and its own ops are exactly the ops it can reason about without talking to anyone.

### 6.1 The options

| Option | The idea | Its cost | Would have won if |
| --- | --- | --- | --- |
| **A — drop own superseded ops (chosen)** | For each node and field, keep only this device's last write | Loses history, so undo and per-device attribution stop being free. A conflict row nobody has read yet stops being offerable | — |
| B — snapshot plus tail, option C | A periodic full snapshot per device plus the ops since it | Two formats that must mean the same thing; a cut point that loses ops outright if an old snapshot syncs beside a new tail; and a snapshot is a fold *result*, so folding one device's snapshot beside another device's raw ops reintroduces last-arriving-wins | Option A did not bound growth — which it does, because superseded writes are almost all of the log |
| C — note-body diffing against a checkpoint | Store a body as a diff against its last checkpoint | A second encoding for one field, and the diffs still accumulate. Option A already deletes forty-nine of fifty bodies outright | Bodies still dominated the log *after* option A, which is a measurement rather than a prediction |
| D — reap tombstones | Drop nodes whose `deleted` has stood for long enough | Needs the cross-device floor that vector pruning needed, and [sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision) already shows why that floor cannot be claimed. Also kills T-13 for the reaped node | A tombstone census showed nodes, not ops, were the growth term |
| E — a retention window in days | Drop anything older than N days | The one rule that can lose a live value: a field written once two years ago and never touched again is the field most likely to still be correct | Nothing. It is the naive version of option A and it is unsound |

### 6.2 Why option A is not a compromise

The three that bound growth — A, B, D — do it by deleting something. B deletes ops and replaces them with a summary, so
it must keep the summary and the ops agreeing. D deletes nodes, so it needs a floor nobody can compute. A deletes only
what is provably unreachable, so there is nothing left to agree with and nothing to compute: the fold over the compacted
set is *identical*, not merely equivalent, to the fold over the original.

That last property is what makes it testable rather than merely arguable. `compact.test.ts` runs the same generated op
sets S-4's laws run over, compacts each device's ops, and asserts the merged tree is unchanged —
[test.md §3.1 Merge properties](test.md#31-merge-properties).

### 6.3 What reopens it

A measurement, in this order: total log bytes still growing without bound after compaction runs, which would mean
distinct fields rather than repeated writes are the term; or note bodies still dominating, which is option C's
condition. Neither is predictable from here, and both are visible in the byte counts the trigger already computes.

## 7. Undelete

**A `restore` op.** T-13 was the last requirement of milestone M1 left unbuilt, and it was left unbuilt because the
payload had no way to reverse a `delete` — [sync-flow.md §4.9 The restore op](sync-flow.md#49-the-restore-op).

| Option | The idea | Its cost | Would have won if |
| --- | --- | --- | --- |
| **A — a `restore` op (chosen)** | One line, one id, the mirror of `delete` | One more op kind to fold and to decode | — |
| B — `set` with `deleted: false` | Reuse the op that already carries fields | `delete` is not a `set` either, so the pair stops being symmetric and the folder stops reading as what happened. Same merge behaviour, worse to read by hand — and the readable folder is a stated attraction of the whole design | `delete` had been a `set` from the start |
| C — copy the subtree to fresh ids | Re-create what was deleted, as new nodes | Breaks every link to the old ids, duplicates the subtree if two devices restore concurrently, and costs one op per node instead of one | The payload could not be changed at all |
| D — delete always beats restore | A precedence rule instead of last-writer-wins | A second merge rule for one field, which is exactly what the per-field rule exists to avoid. It also makes a restore silently fail whenever any device holds an unsynced delete | Deletion had to be irreversible once seen — which is the opposite of T-13 |

Option D deserves the extra sentence, because it is the intuitive one. "A delete should win" sounds safe, and it is the
unsafe choice: the user who restores a row and watches it disappear again on the next sync has no way to tell that from
data loss, and no action available that would work.

## 8. Device naming

**Each device names itself, in the header line of the file it already owns.** D-1 asks for a settings screen listing
devices with a name the user can set, and the only real question was where the name lives.

| Option | The idea | Its cost | Would have won if |
| --- | --- | --- | --- |
| **A — in the device's own header (chosen)** | The name rides the line that already carries the vector | The phone can only be renamed from the phone | — |
| B — a shared `devices.json` | One file mapping id to name | Every device writes it, which breaks one writer per file (S-3) — the entire safety argument — and invites the provider's conflict-copy behaviour, the one thing the design has never had to handle | The design had a coordination mechanism, which it deliberately does not |
| C — a `device` op in the log | Name changes as ops, folded like everything else | Works, and buys the ability to rename any device from any device — at the price of a merge rule for a field that cannot conflict when option A is used, plus an op kind that is not about the tree | Renaming a device you are not holding turned out to matter |
| D — `localStorage` only | Names never sync | Every device shows a different set of names, and the conflict rows that motivated D-1 still say `a3f19c02` on every device but one | Names were only ever for the local user's benefit — but a conflict row naming the *other* device is the case that exists |

Option C is the one to revisit if renaming a lost phone from the laptop ever matters. It is additive: a `device` op
would override the header name for the device it names, and a folder holding neither is a folder of unnamed devices,
which is what one looks like today.

## 9. Theming

**Swap the ten semantic tokens under a `data-theme` attribute on the document root.** Themes were out of scope until M4
— [requirements.md §16 Explicitly out of scope](requirements.md#16-explicitly-out-of-scope) — and what reopened them was
noticing the cost had already been paid: `src/app.css` had named roles rather than colours since M1, so the whole
feature is a block of custom properties per theme.

| Option | The idea | Its cost | Would have won if |
| --- | --- | --- | --- |
| **A — token swap under `data-theme` (chosen)** | One `[data-theme='x']` block per theme, overriding the same ten properties | The palette lives in CSS and the id list in TypeScript, so two files can drift — closed by a test that reads both | — |
| B — a stylesheet per theme, fetched on change | Each theme its own file, loaded when picked | A network request to change colour, which X-5's cold-start-offline rule then has to precache six of; and a flash while it loads | The palettes were large enough that shipping all six mattered — they are ten lines each |
| C — Tailwind's `dark:` variant | The framework's own answer | It is a *pair*, not a set: six themes under it means five variants hand-registered and every component carrying six class lists. It also puts colour back into components, which is the thing that made A cheap | The requirement had been dark mode alone, and permanently so |
| D — follow `prefers-color-scheme`, offer nothing | The OS decides | Answers only two of the six themes, and answers them for a user who wanted the green one. Worth adding *beside* A as a seventh "System" choice; not worth having instead of it | The request had been "respect my OS setting" rather than "let me pick" |

**The id is applied in `index.html` before the module loads.** A theme read after the bundle boots is a theme applied
after the first paint, and a dark theme that flashes white is worse than no dark theme — X-14. The boot line is three
statements and duplicates nothing: it reads the same `localStorage` key the class does and sets the same attribute.

**What reopens it.** A seventh theme costs a CSS block and a catalog line, so growth is not a reason. What would reopen
it is a theme that changes more than colour — a compact density, a larger type scale — because that is no longer a
palette and A has nothing to say about it.

**A type scale was asked for, and it did not reopen this.** X-25 is exactly the case above, and the answer was a second
attribute rather than a wider theme: see [§15 A size for the sidebar's type](#15-a-size-for-the-sidebars-type). What
that settles for A is that the boundary holds — a theme is still fourteen colours, and the thing that was not a colour
got its own catalog, its own attribute and its own line in the same boot script.

## 10. Tags as one field

A-1 makes `tags` a set on a node, and the merge treats the whole set as one field: the later write wins, and the set
that lost is offered back on a conflict row. Two devices tagging one row concurrently therefore keep one set and are
told about the other.

### 10.1 The options

| # | Option | What it costs |
| --- | --- | --- |
| A | **One field, last-writer-wins** — the set is a value like a title | A concurrent add on two devices keeps one set. The other is a click away on the conflict row, because C-1 already offers a dropped value back |
| B | An OR-set: every member carries the device and counter that added it, and a removal carries a tombstone | Nothing is ever lost. A second merge mechanism lives inside one field, the payload grows a stamp per tag, and a removed tag needs a tombstone that compaction may not drop — every rule [sync-flow.md §4 Sync data model](sync-flow.md#4-sync-data-model) settles once, settled again differently |
| C | A `tag`/`untag` op pair, merged by `(at, device id)` per member | Two new op kinds and a per-member total order. It is option B with the state in the log rather than in the node, and it grows the same tombstone question |

**A was taken.** The reason is not that losing a tag is cheap; it is that C-1 already exists. A field two devices wrote
concurrently is the case the conflict list was built for, and a tag set is that case with no new mechanism at all — the
row says what was kept, offers what was not, and taking it back is an ordinary `set`. B and C both buy "never lose a
concurrent add" by giving one field its own merge rule, its own tombstone lifetime and its own compaction question,
which is the cost [sync-flow.md §4.6 The decision](sync-flow.md#46-the-decision) refused for the tree itself.

### 10.2 What reopens it

A measurement, like everything else here: two devices routinely tagging the same rows while apart, so that the conflict
list fills with tag rows rather than with the races it was built for. One person with a phone and a laptop is not that
workload. If it ever is, option B is the one to reach for, and the thing to reuse is the `orderBy` pattern — a member
carrying the device that wrote it — rather than a new op.

## 11. Retiring the `list` kind

K-1 had four kinds and has three. `list` and `folder` were the same thing wearing two icons: both were containers, both
could own any kind — T-1 and K-4 make that true of every kind — and neither was checkable. A choice with no consequence
still has to be made, once per row, forever, so a tree ends up holding both for the same job.

Removing a kind is not a UI change, because the kind is in the log. Every `create` op ever written carries one, and the
files carrying `list` are in a folder this device may not rewrite —
[§5 Reading a folder of logs](#5-reading-a-folder-of-logs) and S-3 both say so — and on peers that have not been updated
yet.

### 11.1 The options

| # | Option | What it costs |
| --- | --- | --- |
| A | **Read `list` as `folder` at the decoder** — one line of vocabulary, nothing written | The file keeps saying `list` until the row is written again or compaction drops the op, so a `grep` of the folder shows a kind the code no longer has |
| B | Keep the kind, and only take it out of the UI | The kind stays in the type, the icon, the menu and the conflict rows forever, and an old file can still create one. Nothing is simplified — the choice is merely hidden from new rows |
| C | A migration pass that rewrites this device's log, turning every `list` into a `folder` | A second thing that rewrites a log, beside compaction, with the same "must never lower the top counter" rule to get right — [sync-flow.md §4.8 The compaction cut](sync-flow.md#48-the-compaction-cut). It fixes this device's file and no peer's, so A is still needed underneath it |
| D | Bump `LOG_VERSION` and refuse the old files | Every device is a stranger until it is upgraded, and a folder mid-upgrade loses rows. This is the failure the format exists to prevent |

**A was taken**, and C was not taken *as well* because it buys nothing A does not: the ops that carry `list` are already
superseded by whatever the row was set to since, and compaction drops them on its own schedule. The decoder is where
`cleanTags` already does the same job for A-1 — a value from an older build arrives in this build's vocabulary — so the
rule has one home and one test.

The direction matters and is not symmetric: `list` becomes `folder`, never the reverse, because a peer running the older
build has `folder` among its four kinds and reads what we write without knowing anything happened.

### 11.2 What reopens it

A kind that is genuinely a fourth answer rather than a second icon. The test is the one `list` failed: name the question
the kind answers that `folder`, `note` and `task` do not. A kind that renders differently is not one — that is what a
view is for.

## 12. Formatting in a note body

**Taken** — [requirements.md §4.3 Marks in a note body](requirements.md#43-marks-in-a-note-body) is B-1 to B-10, built.
A note body (K-3) is the only long text in the application, and it had no way to say that a line is a heading, that a
word matters, or that a run of characters is a command to be typed exactly. The question is what the body *is* once it
can.

### 12.1 The options

| # | Option | What it costs |
| --- | --- | --- |
| A | **A Markdown subset inside the body string** — `**bold**`, `# `, `## `, and nothing else | The marks are visible to anything that has not been taught them: an older build, the file in the folder, a search snippet until B-5 strips them. In exchange, `body` is still a string, so no field, no op, no merge rule, no conflict row and no compaction rule changes at all |
| B | A rich editor over `contenteditable`, storing HTML | The body stops being text. An older build renders the tags as noise rather than as a note, search has to strip them anyway, and the caret belongs to the browser — which is the one thing X-10 and K-7 need to own, because a peer's edit merges into the field while it is being typed in |
| C | A document model: blocks and spans as JSON, in a new field | A second document format living inside a node, with an encoder, a renderer and a migration — and the field is still last-writer-wins, so it buys structure and pays for it twice. [§4 Sync data model](#4-sync-data-model) refused exactly this shape for the tree |
| D | Headings as rows: a `heading` kind | It answers half the question — a heading, never bold — and it puts a formatting decision into the tree, where it becomes a row the caret order ([requirements.md §3.1 Keyboard (desktop)](requirements.md#31-keyboard-desktop)), the drag (T-14), the Done view (T-12) and every edit have to special-case. [§11 Retiring the `list` kind](#11-retiring-the-list-kind) removed a kind for being an icon; this would add one for being a font size |
| E | Nothing: the body stays plain text | Free, and it is what the application does today. It is the option to keep if the marks turn out to be typed once and never again |

**A was taken.** The reason is not that Markdown is popular; it is that A is the only option under which the sync design
learns nothing new. The body is one field with one merge rule, and A leaves it a string — so the whole of
[sync-flow.md §4 Sync data model](sync-flow.md#4-sync-data-model) applies to a formatted body exactly as it applies to
an unformatted one, and the feature is a parser and a component. B and C both make the body a document, and a document
in a field that is overwritten whole by the later writer is a document that can be lost whole; that is tolerable for
text a person can retype and unpleasant for structure they cannot see.

The fallback is the tiebreak between A and the rest. A device that has not been updated shows `**07:40**`, which is a
time with four characters around it. Under B it shows a paragraph of tags, and under C it shows JSON.

### 12.2 It reopened, and A answered again

A body wanted code and a list, which are two of the three things named here as the reopening condition. The answer was
not the editor this section expected: it was four more marks in the same subset — B-8's fenced block, B-9's inline run
and B-10's two list markers, [requirements.md §4.3 Marks in a note body](requirements.md#43-marks-in-a-note-body) —
because the argument that chose A is about the payload, and a third mark costs the payload exactly what the first two
did, which is nothing. A build that predates them shows three backticks around a command, which is a command with six
characters near it.

What that argument does *not* answer is the caret. Every mark here is written by an edit to the text and read back by a
parser, so a control is typing and the field's own undo reverses it; the moment a body wants something that cannot be
spelled as characters a person could have typed — an image, a table with dragged column widths, a link whose target is
not its text — A stops being cheap and the thing to reach for is B, with the caret model as the price.

### 12.3 What is still refused

A link, an image, a table, and anything that needs a second field. A bullet in a note body was refused once on the
grounds that the application already has lists — that is the tree, T-1 — and the answer held until the notes got long
enough to have steps in them. It is still true of anything that wants to be *ticked*, moved or found: a step that
matters is a row, and B-10 is for the ones that do not. The measurement that would justify B remains the one this
section always named: bodies long enough that the person is writing *in* the app rather than *about* the rows.

---

## 13. One archive rather than two lists

**One list of everything the tree no longer shows, newest first, with no distinction drawn between a ticked row and a
deleted one.**

The Done view shipped in M1 as two sections — finished, then deleted — because that is how the data is shaped: a tick is
a field and a tombstone is an op, and they are undone by different writes. Shaping the *screen* that way asked the
reader a question the screen exists to answer. Someone arriving at `#/done` is looking for a row and knows only that it
is not where they left it; making them first settle whether they had ticked it or deleted it is asking them to remember
the thing they came to look up.

Ordering follows from the same argument. Tree order was right for the finished list while it was a second view of the
tree, and it is wrong for one list nobody browses: the row being looked for is nearly always the last one to go.

### 13.1 The options

| | Option | Cost |
| --- | --- | --- |
| A | **One list, ordered by when the row left** — chosen | `done` needed a timestamp, which `deleted` already had |
| B | Two lists, as built | The reader classifies the row before they can find it, and neither list is in the order the question is asked in |
| C | One list, each row badged "ticked" or "deleted" | The badge is the classification again, moved from the heading onto every line — and it is the app's bookkeeping rather than anything the reader acts on. The Restore control does the right thing either way, so the badge tells them nothing they can use |
| D | One list, ordered by an `archived_at` written onto the op | A new field in the payload for something the fold can derive, and every older file would arrive without it |

`doneAt` is derived at the fold from the winning `set done`'s own `at`, in the way `deletedAt` and `parentSetAt` already
are — [sync-flow.md §4.9 The restore op](sync-flow.md#49-the-restore-op). That is what makes option A cost nothing at
the payload: no op changed, no file changed, and a row ticked by a build that predates the field dates itself the first
time this replica folds it. Compaction keeps the last writer of `done`, so the stamp survives the cut for the same
reason the value does.

One control follows from one list. `unarchive` clears the row's own tombstone, its own tick, or both — the two ops the
view already wrote, and both together for a row that was deleted while it was ticked, which would otherwise come back
and drop straight into the archive again.

### 13.2 What reopens it

An archive long enough to need finding rather than scanning. The answer then is a filter or a search over it — F-4
already reaches these rows by name — and not a second list: splitting by the reason a row left would still be splitting
by the thing the reader does not remember.

## 14. A note beside the list rather than instead of it

**One route draws two panes: the note, and the page of the nearest list above it. Above `lg` they are columns; below it
the note is a sheet over the list.**

A note was a full page from M1, which is the obvious reading of K-3 — "its own full-page editor" — and it was wrong for
the way the app is used. The tree is the thing on screen almost all of the time, and a note is the one kind of row that
is read rather than ticked; opening one to check a ferry time replaced the list and cost a breadcrumb to get back to
what was already there. The other two kinds do not have this problem: a folder *is* a list, so navigating to it is the
point, and a task never opens at all.

### 14.1 The options

| | Option | Cost |
| --- | --- | --- |
| A | **One route, two panes derived from it** — chosen | The left pane is a function of the right, so the parent has to be resolvable from the route — which T-6 already guarantees. Two node pages can be on screen at once, so anything that assumed one has to say which |
| B | A second route — `#/n/<list>/note/<id>` | The pair is stored where the derivation would have produced it anyway, and every existing link to `#/n/<id>` becomes a link to the old drawing. A route that carries redundant state is a route that can carry *wrong* state — a note under a list it does not belong to |
| C | The pane is device-local state beside the route | A deep link no longer says what is on screen (X-8), and the Back button stops closing the note. The peek's expansion *is* this option, applied to the one piece of state that genuinely is a gesture |
| D | Split every kind, not just notes | A folder beside a folder is the same drawing twice, one of which is always narrower — the argument T-10 already made against the sidebar carrying the whole tree |
| E | Keep the full page and add a preview popover to the row | A third rendering of a body, which B-3's transparent textarea makes expensive: the popover either cannot be edited, or is a second editor with its own K-7 debounce and its own S-20 emission |

Option A costs nothing at the payload and nothing at the layer below the views: no op, no field, no route, and `Session`
never learns that two nodes can be on screen. It stored nothing either, until
[§14.3 The divider — reopened and taken](#143-the-divider--reopened-and-taken) gave the pane a width. What it does cost
is that `data-testid` attributes on a node page are no longer unique on a note route, which is why the pane carries one
of its own and the smoke run scopes to it.

**The phone's peek is the same composition, not a second one.** X-1 has held since M1 — one markup, breakpoints only —
and a sheet is what "beside" becomes when there is no room beside. The 60% cap and the second tap are the two things the
narrow drawing needs that the wide one does not: the cap so the list stays visible behind it, and the tap because B-3's
always-mounted textarea would otherwise take a caret into text that is 60% on screen.

### 14.2 Which node the left pane draws

The first cut of option A read "the node it hangs under" literally, and said that a parent which is itself a note
renders as the list it is — two bodies on screen, honest because one is the page you are in and the other is the note
you opened out of it. Using it says otherwise. A note's children are in the pane (K-4), so opening a sub-note is a click
*inside the pane*, and the pane is the one thing on screen that should answer it; instead the left column was replaced
as well, by the very note whose list the click came from.

| | Option | Cost |
| --- | --- | --- |
| A | **The nearest ancestor that is not a note** — chosen | The left pane is no longer "the parent" but a walk, so `listAbove` is a second function beside `parentOf` and a nested note's *siblings* are only in the tree on the left rather than in a list of their own |
| B | The parent, whatever its kind — the first cut | A second body and a second editor, each with K-7's debounce and a caret, for a note nobody asked to edit; and the left column changes on every step down a chain of notes, which is exactly the movement X-23 was written to stop |
| C | The parent, with its body suppressed on the left | Keeps the movement and adds a rule: a node page that draws itself differently depending on who is beside it. `NodePage` is one drawing on its own route and on the left of a note's, and that is what makes the second pane free |

What A gives up is small because the tree does not stop at one level: the nested note is drawn, and highlighted, inside
the tree the left pane already shows — T-10's two levels are the sidebar's rule, not the tree's. What it buys is that
the left column moves when the *user* navigates it and at no other time.

### 14.3 The divider — reopened and taken

The predecessor of [§14.2 Which node the left pane draws](#142-which-node-the-left-pane-draws) said the pane's own width
would reopen when somebody actually dragged the divider, and somebody did. X-24 is X-20 a second time and shares its
component: the same pointer capture for T-14's reason, the same bounds in `view-state.svelte.ts` rather than at the
grip, the same `localStorage` key shape, and the same "above the breakpoint only" — below `lg` the pane is a sheet and
its width is the viewport's. The sign is the one difference, because the divider is the pane's *left* edge, and it is a
prop rather than a second file.

The bounds are absolute pixels rather than a share of the window, for X-20's reason: a stored width that meant something
different per window would drift from the pointer that set it. A person who drags the pane wide enough to squeeze the
list can drag it back, and the list column keeps `min-w-0` so it narrows rather than overflowing.

### 14.4 The caret opens the pane too

X-30 gives the pane a second way in, and it is not a link. The icon on a row navigates — that is what an icon that is an
`<a>` should do — and navigating means the left column becomes `listAbove` the note, which is the list the reader was on
only when the note is a child of it. A note two levels down is opened from a list and lands beside a *different* one.
That is right for a click on a link and wrong for a caret: putting the caret in a title is something done inside the
list already on screen, and moving that list out from under it is the movement X-23 exists to stop, now fired by typing.

| | Option | Cost |
| --- | --- | --- |
| A | **The caret raises the pane; the route does not move** — chosen | A pane that is device-local for as long as the caret holds it: a reload draws the route's pane and not the caret's, Back does not close it, and the ✕ needs a second meaning. A second way in that is not a link |
| B | The caret navigates, like the icon | One rule rather than two, and the left column jumps to the note's own parent every time the caret passes a nested note. Every keystroke of arrow-key navigation is then a history entry as well — F-5's argument against pushing per keystroke, applied to a list |
| C | A route carrying both — `#/n/<list>/n/<note>` | [§14.1 The options](#141-the-options)'s option B under a new name, refused for the reason it was refused then: a route that carries redundant state is a route that can carry wrong state |
| D | Remember the list beside the route | The stored pair A was chosen to avoid. It also has to be invalidated — a remembered list that a peer deleted is a left column pointing at nothing (T-7) |
| E | Leave the icon as the only way in | The row's own title is where the caret already is for every other edit, and a note is the one kind whose content does not fit in it. The reader types the title and then has to go and find the icon to see what is under it |

**A is [§14.1 The options](#141-the-options)'s option C at the size of a caret, and it costs what C costs.** A deep link
does not describe a caret-raised pane, and the Back button does not close one. C was refused because those are the wrong
prices for the *only* way to open a note; they are the right prices for a second way whose trigger is itself
device-local and does not survive a reload. Nothing is stored either way — the pane is derived from the route and the
focused row, and `RowFocus` was already there.

**The caret leaving the title is not the caret leaving the note.** The note is set when a title takes the caret and is
never cleared when it loses it, which reads like a bug and is what this needs: clicking into the note's body blurs the
row's title, and a pane that closed on blur would close under the click that was about to edit it.

**What a caret in a `folder` or a `task` does was the second cut, and it was wrong first.** The first reading derived
the pane from the row holding the caret, so a caret in anything that was not a note closed it. It is the simpler rule
and it is the wrong one: the pane flicked open and shut on every note an arrow-key walk passed, and clicking a folder to
collapse it took away a note nobody had asked to close.

| | Option | Cost |
| --- | --- | --- |
| A | **Only a note changes the pane** — chosen | The caret's note is remembered rather than derived from `RowFocus.id`, so there is one more field and one more thing the ✕ has to clear. A pane can outlive the caret being in it, which is why a navigation has to end it explicitly |
| B | Any row changes it, and a non-note closes it — the first cut | Every walk through a list is a pane opening and shutting, and the reader loses an open note to a click meant for a disclosure triangle |
| C | Any row changes it, and a non-note leaves the *last* note | A is this, written down: "leaves the last note" is a remembered note however it is phrased |

So `RowFocus` carries two things: the row holding the caret, which the keyboard model already needed, and the note that
caret is in, which only a note's title writes. The pane ends at the ✕ — the only place the two ways in differ, because a
caret-raised pane is on no route to leave — or at a navigation, which is the reader choosing what is on screen and hands
the question back to the route. Without that second one the note followed the reader onto the next page, where nothing
on screen explained why it was there.

**Below `lg` the caret does not raise it.** There the pane is X-22's sheet over the list, and a sheet raised by putting
a caret in a title would cover the row being typed into with the keyboard under it. The icon still opens the sheet,
because a tap on a link is somewhere the reader asked to go.

### 14.5 What reopens the rest

A device that is wide *and* touch-only, where the peek's tap-to-expand and the split's always-open pane disagree about
what a tap on a note means — the breakpoint answers that today by assuming width implies a pointer. The other opening is
a second kind worth splitting: D stays refused for folders, but a `task` that grew a body would be K-3's question again
rather than this one.

### 14.6 What the pane draws — X-31

The pane started as the note's page moved into a column, which meant it drew everything that page drew: breadcrumbs, the
title and flag, the tags, the body, the add line, and the note's own children under it. Two columns of content, and one
of them was drawn twice — the tree on the left already draws the whole subtree, so the note's children were on screen in
two lists at once. The body paid for it: a floor five lines tall, then the pane's remaining height left empty under a
list that mostly had nothing in it.

| | Option | Cost |
| --- | --- | --- |
| A | **The pane is the title, the tags and the body; the body fills it** — chosen | The add line adds to a list the pane does not draw, so the row it makes appears on the left rather than under the input. A note's children are reachable only through the tree, which means through the collapse state (T-8) |
| B | Leave it as the page's column | The complaint that opened X-31: a field five lines tall in a pane the reader opened to write in, under a duplicate of the list already beside it |
| C | Keep the children, give the body the space above them | The two lists still disagree — the same rows in two places, and a drag that means one thing in each. It also makes the body's height depend on how many children the note has, which is a measurement X-22 exists to avoid |
| D | Keep the children and drop the tree's nesting under a note instead | T-10 is the sidebar's rule and the tree has never had one; hiding a subtree in the list because a *different* view might draw it is a view deciding what the tree contains |

**The path went with them, and for the same reason.** The left column is where the note sits, drawn as the rows around
it. A breadcrumb over the pane is that in words, in the one place where following it can only take the reader away from
the note they opened — and T-9 is answered by the page on the left, which still carries its own.

**The add line stays.** Filing something under the note while reading it is the pattern K-4 exists for, and the line is
what makes it cost nothing. What moved is where it sits: the top row, which is the header the breadcrumbs vacated, and
is where the same group already sits on a phone (X-27) and at the head of a list page (K-10). Under the body is no
longer a place — the body ends where the pane does.

**What reopens it.** A note whose children are its point rather than its footnote — a heading with a checklist under it,
read as one thing — would be C's question again, and the answer would be a pane that can be told to show them rather
than a pane that always does.

## 15. A size for the sidebar's type

**Four steps on one multiplier, applied as a second attribute on the document root.** X-19 had already decided the
sidebar reads a fifth larger than the page, and had decided it once for every device. X-25 is the same question asked
per device, because the distance to the screen is not a property of the app: normal, a fifth under, a fifth over, two
fifths over.

### 15.1 What the setting moves

The first fork was what "size of the sidebar" means, and there were three readings.

| Option | The idea | Its cost | Would have won if |
| --- | --- | --- | --- |
| **A — the type only (chosen)** | Scale X-19's two rules and the icons beside them; the width is untouched | `maximal` in a narrow column truncates more titles, and the reader has to reach for X-20's grip to fix it | — |
| B — the width only | Four presets over the column's width | X-20 already drags the width, so this is a second control for one number — and the one that is not the pointer would lose every argument with the one that is. Below `md` the sidebar is a drawer, where a width takes room from nothing, so it would also do nothing on a phone | X-20 did not exist, and the width needed a control that was not a drag |
| C — both, as one scale | One multiplier over type and width together, so the column keeps its proportions | Same collision with X-20, plus the reader can no longer have big type in a narrow column or small type in a wide one — the two wants that are least alike are the ones it fuses | The sidebar had a fixed width, where "size" would have had exactly one meaning |

B and C both die on the same point: the width already has a gesture, and it is a *direct* one. A preset that fights a
drag is a preference the user has to re-assert every time they touch the grip. The type had no control at all, which is
what made it the half worth adding.

### 15.2 One multiplier rather than four sets of sizes

`--sidebar-type` is a number and X-19's rules multiply by it, so `small` is `[data-sidebar-size='small'] {
--sidebar-type: 0.8 }` and nothing else. The alternative was a rule per step per class — eight declarations to say what
one number says — and it fails the test X-19 set for itself: one rule rather than a size named per component. It is also
what let the icons in, which were `size-[1.2rem]` written out five times across the two sidebar components and are now
`.sidebar-icon`; without the multiplier each of those would have needed four variants to keep the column's proportions.

`normal` gets a block of its own even though it re-declares the `:root` default, for the reason `[data-theme='light']`
does: the settings screen previews each step by putting the attribute on the button, and a `normal` that inherited would
preview whatever the page is already wearing.

### 15.3 Why it is not a seventh theme, or a field in the theme

Folding it into `data-theme` would have been fewer files, and it is refused on
[requirements.md §10.1 Themes](requirements.md#101-themes)'s own terms: a theme is fourteen colour tokens and never
changes a layout, a size or a font. That rule is load-bearing rather than decorative — it is what lets the smoke run
assert that every palette renders the identical DOM, which is the check that catches a palette breaking a layout. A
theme that could resize things makes that check meaningless, and the six palettes would then be six layouts to test.

The two do share the boot line in `index.html`, and that is the whole overlap. Both are read before the module loads for
X-14's reason — a sidebar that renders at normal and jumps to maximal is the same flash a dark theme has, and it is one
more `try`/`getItem`/`setAttribute` to prevent.

### 15.4 What reopens it

A second surface wanting the same treatment. The setting is deliberately about the sidebar rather than about the app: a
global type scale is the browser's own zoom, which already works here and needs nothing from us. What we would have no
answer to is a *specific* second ask — the note body at a reading size while the tree stays dense — because at two
independent scales the question becomes a type system rather than a sidebar setting, and `--sidebar-type` would want to
become a set of named steps that several rules draw from.

A step beyond `maximal` is not a reopener; it is a catalog line and a CSS block, which is the property A was chosen for.

## 16. Retiring the cloud-app launcher

X-17 put a cloud client on the settings screen: a picker naming which of six apps keeps this device's folder in sync,
and a button that started it. The reasoning was a real failure — a row typed on the phone is in the folder and not yet
in the cloud, because the provider's client has not run — and the button was the shortest way from noticing that to
fixing it.

What it cost was out of proportion to one tap. `src/core/providers.ts` held six other people's Android package names and
six desktop command names, `src/app/provider.ts` stored the choice per device, `ShellActions` carried an `openApp` both
platform shells had to implement, the loopback helper grew an endpoint that resolves a command on `PATH` and starts a
process, and the Android manifest listed six packages in `<queries>` so Android 11 would admit they exist. Six places to
edit for a seventh provider, and a unit test whose only job was to keep two of those six lists in step.

None of it is reachable from anything else in the app, and that is the point rather than a defence: nothing in the
merge, the adapter or the file format may know which provider is under the folder —
[requirements.md §7.3 Fixed constraints](requirements.md#73-fixed-constraints) — so the catalog could never grow a
second reader. It was one button's worth of data wearing a module's clothes.

### 16.1 The options

| # | Option | What it costs |
| --- | --- | --- |
| A | **Remove it outright** — the catalog, the stored label, `openApp`, the helper's command runner, the manifest queries | The one tap goes back to the phone's launcher and the desktop's taskbar. A device that relied on the button has to leave the app to start an app |
| B | Keep the button, drop the picker, and infer the provider | Nothing to infer from: the folder is a granted SAF tree or a `--folder` path, and neither names the client that syncs it. Guessing from a path is a string match on directory names, which is worse than asking |
| C | A free-text command instead of a catalog | Removes the six-line list and keeps everything underneath it — the shell capability, the helper's process runner, the stored value — while handing the page the ability to name an arbitrary command. The narrow one it had was the only thing making the endpoint acceptable |
| D | Leave it alone | Six edit sites and a seam test held for a button that duplicates the operating system's own launcher |

**A was taken.** B and C both keep the expensive half — a page that can start processes — to save the cheap half, and
the expensive half is what the loopback helper is careful about
([architecture.md §4.1 Shell actions, beside the adapter](architecture.md#41-shell-actions-beside-the-adapter)). Losing
the endpoint means the helper opens exactly one thing, the folder it was launched with, which is a smaller thing to
argue about than a command allowlist.

The settings screen keeps what the section was for: what this device writes to, how to look inside it, whether anything
else has read it, and how to point it somewhere else — X-15, X-16 and X-18.

### 16.2 What reopens it

Evidence that the client not running is a recurring failure rather than a rare one, which is
[test.md §3.6 Platform](test.md#36-platform)'s to produce and has never been run. Even then the launcher is one answer
of several: the sidebar already warns when this device reaches no folder, and a line saying how long ago a peer's file
last changed would name the same failure without starting anything.

A shell that offers a *documented, provider-independent* "sync now" — an Android intent every client honours, say —
reopens it as a different feature. That is a capability of the shell rather than a catalog of apps, and it would arrive
with no list to keep in step.

## 17. The sidebar's second level

M6 cut the sidebar back to the top level — [§11 Retiring the `list` kind](#11-retiring-the-list-kind) was the same
milestone's other removal — and using it found what the cut had taken. The place a person goes back to is often one step
down: the project inside the folder, the packing list inside the trip. The nav could name only the container above it,
so every one of those trips was two clicks and a page nobody wanted to read on the way past. T-17 gives each top-level
row a disclosure and one level under it, closed until it is opened.

### 17.1 The options

| # | Option | What it costs |
| --- | --- | --- |
| A | **One fixed level under each top-level row, disclosed, closed by default** — chosen | A second drawing of one level of the tree, a triangle on the rows that have children of the right kinds, and one more piece of device-local state |
| B | The whole tree again, collapsed by default | M6's column with a lid on it. Depth is unlimited (T-1), so one opened branch runs the nav entries off the bottom exactly as before, and the state that keeps it shut is a second copy of T-8's, growing with the tree |
| C | The second level, but open by default | The first paint is the mirror M6 removed, on every device that never touches a triangle — and the column is longest exactly when the reader has learned least about it |
| D | Reuse T-8's collapse state, so a folder open on the page is open in the nav | One set rather than two, and two drawings that move each other: collapsing a folder while reading it would close it in the nav, and the nav's triangle would reach into the page. They answer different questions — what am I reading, and where do I go |
| E | Tasks at the second level as well | The second level becomes the bulk of the checklist, which is the argument that kept tasks out of the first (T-10) |

**A was taken, and the fixed depth is what makes it safe.** B's objection was never nesting as such — it was that the
column's length is a function of the tree's depth, so no amount of collapsing bounds it. Two levels is a bound: the
column is at most the top-level rows plus the children of the ones the reader opened, and both halves are things a
person chose to have.

D is the one worth stating twice, because it looks like a saving. The sidebar's disclosure means *show me what is in
there before I go*, and the tree's means *I am done with this part of the page*. Fusing them makes each gesture perform
the other one somewhere the reader is not looking. Two sets, two keys, and neither one ever reads the other.

### 17.2 What reopens it

A third level, if the two-click trip turns out to have moved down a step rather than gone away — the shape of the
complaint would be identical and the fix would be the same code with a depth of three. What would *not* reopen it is B:
a depth that is a function of the tree is the thing this design is built to avoid, and a bound that is unlimited is not
a bound.

## 18. Today and Tomorrow

Two lists that are not the tree, and one sentence to satisfy: an item put in Tomorrow is in Today a day later. The
question was never what the lists look like — it was what makes that sentence true on four devices that are rarely awake
at the same time.

### 18.1 What the two lists are

| # | Option | What it costs |
| --- | --- | --- |
| A | **A second root, `agenda`, holding rows that carry the day they are filed for** — chosen | One more parent that is not a node, one more field in the payload, and two views that read it. Every walk that stopped at `root` has to stop at two roots instead |
| B | Two folders at the top of the tree | They are in `All`, which is the one thing the lists are not, and they can be dragged into, renamed and deleted like any other row. Two devices that both create them make two of each, because a folder's id is minted by whoever made it |
| C | A `day` field on any tree row, with Today and Tomorrow as saved searches over it | The lists become a view of the tree rather than something separate — which is a good feature and is not the one asked for. It also puts a date on rows nobody dated, and every list in the app grows a second meaning |
| D | A file of their own beside the op log | A second format, a second merge and a second compaction rule, for rows that are already exactly the rows this format carries |

### 18.2 What makes the day turn

| # | Option | What it costs |
| --- | --- | --- |
| A | **Derive it: Today is `day <= today`, Tomorrow is `day > today`** — chosen | The lists are a read over a field, so nothing is stored about *which* list an item is in. An item's day is the truth and the two pages are two questions about it |
| B | A rollover that writes `move` ops at midnight | Every device has to run it; a device shut for three days runs it late; two devices awake at midnight both write it; and the order keys those moves mint raise C-3 rows for a move nobody made. A write nobody asked for is the one kind of write this application does not have |
| C | A rollover written by one elected device | An election, in an application whose entire safety argument is that no device ever writes another's file |

**The chosen pair is why almost nothing new exists.** An agenda item is an ordinary row: the same `create`, `set`,
`move`, `delete` and `restore`, the same merge, the same conflict rows, the same compaction. `agenda.ts` is a filter
over `childrenOf` and a date comparison, and the day turns because a computer's clock does.

### 18.3 What reopens it

Scheduling a row that is already in the tree — "this task, on Thursday" — which is option C above and a different
feature: it would keep the `day` field exactly as it is and add a second reader for it, and the two lists would then
show tree rows beside agenda items. What would *not* reopen it is B: a write fired by a clock rather than by a person is
what [requirements.md §7.3 Fixed constraints](requirements.md#73-fixed-constraints) exists to keep out.


## 19. Timely

A third list, for the check items that come back: water the plants every day, change the filter every five, pay the rent
every month. One sentence to satisfy, and it is not the one M9 satisfied: a ticked item has to *return*, on a day that
depends on when it was ticked rather than on when it was due.

### 19.1 What a tick writes

| # | Option | What it costs |
| --- | --- | --- |
| A | **Nothing new: the tick writes the day the item is next due, into G-2's `day`** — chosen | The two states are one comparison the app already makes — due is `day <= today`, waiting is `day > today` — so R-4's countdown is G-3's rollover with a third question asked of it. `done` is never written, which is what keeps a chore out of T-12's archive and out of T-11's filter for free |
| B | A `lastTicked` field, with the due day computed from it and the period at render time | A second field for the same fact, and every reader has to do the arithmetic. It also makes "bring it back" (R-6) a write of a date in the past rather than a write of today |
| C | `done` as usual, plus a job that un-ticks the item when its day comes | A write nobody made, fired by a clock — the thing [requirements.md §7.3 Fixed constraints](requirements.md#73-fixed-constraints) exists to keep out, and §18.2 B already refused for the same reason |
| D | A new op, `tick`, carrying the period | A fifth op for something four ops already express. The merge, compaction and the conflict rows would each learn a case, and the payload would stop being readable by a build that predates it |

**A is what makes R-5 true by construction.** The next due day is `now + period`, and the day the item was carrying is
not an input to the sum — so an item that was due on Monday and is ticked on Thursday is next due five days after
Thursday. Option B computes from the same clock and would have been equally correct here; what it costs is a second
field that can disagree with the first, and a reader that has to hold both to answer "is this due".

### 19.2 Where the period lives

| # | Option | What it costs |
| --- | --- | --- |
| A | **One field, `every`, as `<n>d` or `<n>m`** — chosen | One string, merged last-writer-wins like a tag or a flag. It is legible in D-4's log — `every 5d` — which is the same argument A-2 made for naming the four priorities rather than numbering them |
| B | Two fields, a count and a unit | Two fields that are one value: a device that wrote `5` and one that wrote `m` concurrently would merge into "every five months", which neither device asked for |
| C | An RFC 5545 recurrence rule | A grammar, a parser and a library, for a list of chores. "Every third Tuesday" is not what was asked for, and the rule would be the largest thing in the payload by an order of magnitude |
| D | A fixed ladder of presets, cycled by one control | It matches the shape A-2's flag has, and it is what the row's chip nearly became. What it cannot express is the arbitrary N the feature was asked for — "every five days" is only on the ladder if somebody put it there |

**Two units, and the second one is calendar arithmetic.** Days are addition; months are not, so `nextDue` adds months by
the calendar and clamps the day of the month, and "every month" on the 31st is the 30th in a month with thirty days. The
alternative — thirty days — makes "monthly" drift a day every other month, which is exactly the kind of quiet wrongness
a chore list is never checked closely enough to catch.

### 19.3 What reopens it

A period the two units cannot say: "every second Tuesday", "on the first of the month", "weekdays only". All three are
option C above, and all three are a recurrence grammar rather than a bigger number — the condition is a real use for one
rather than the observation that it is expressible. What does *not* reopen it is a longer ladder of presets: the chip
edits a count and a unit, so every N either unit can say is already reachable.

---

## 20. A picked colour, over the theme

X-13 shipped six palettes and the answer to "none of these" was "pick the nearest". The request was the other one: a
colour of one's own, and — separately — the colour the app is written in.
[requirements.md §10.1 Themes](requirements.md#101-themes) is the constraint the answer had to survive: a theme is
fourteen tokens, no component may ever name a colour, and switching one may not move anything.

### 20.1 How much of the palette a person picks

| # | Option | What it costs |
| --- | --- | --- |
| A | **Two picks — the accent and the ink — over the chosen theme, with `accent-soft`, `ink-muted` and `ink-faint` mixed from them** — chosen | Two controls, one CSS block, and no new palette. Light stays light and dark stays dark underneath, so the six themes keep doing the work of deciding a surface — which is the half of a palette nobody wants to pick and the half that decides whether the app is readable in a dark room |
| B | A picker per token — all fourteen | Fourteen colour decisions to make before the app looks like anything, and the two rules [requirements.md §10.1 Themes](requirements.md#101-themes) states — `ink` readable on `surface`, `danger` not reading as `accent` — become the user's problem in twelve more places than they were |
| C | A seventh theme the user owns, saved as a palette | A palette is a thing to name, store, edit, reset and eventually sync; and the moment it exists it is *instead of* the six rather than over them, so the reader who wanted a green accent on the dark surface has to rebuild the dark surface first |
| D | One seed colour, re-tinting surface, line, ink and accent by hue | The prettiest demo and the least controllable result: it takes the surface away from the theme that was chosen for it, and a hue that makes a pleasant accent makes a lurid page. It also cannot express the second half of what was asked — the text colour is not the accent's hue |

**What decided it is which half of a palette is a taste.** The accent is: it is the colour the app is *in*, it appears
on a link and a button, and it is the one thing a person points at when they say the app is blue. The surface is not —
it is a decision about the room, and light-versus-dark is the only question in it that anybody wants to answer. So the
themes keep the surface and the pick takes the accent, and the ink comes along because it was asked for and because it
is the one other token that is about the person rather than about the room: an ink a shade softer than the theme's is a
common and reasonable thing to want.

### 20.2 Why three tokens are mixed rather than picked

`accent-soft`, `ink-muted` and `ink-faint` are relationships, not colours — the argument
[requirements.md §10.1 Themes](requirements.md#101-themes) already makes about `scrim`, applied in the direction where
it *can* be expressed as arithmetic. Each is a step from a colour toward the surface behind it, so each is one
`color-mix` against the theme's own `surface`, and the same percentage is right under both a light palette and a dark
one because the thing it moves toward is what changed. That is what keeps a pick from needing a light variant and a dark
variant.

It is CSS rather than TypeScript for [§9 Theming](#9-theming)'s reason, unchanged: the app's colours are spelled in
`src/app.css` and nowhere else. A pick is one custom property on the document root and one attribute saying it is there;
`src/app.css` holds what the pick *means*. Nothing in TypeScript computes a colour — `src/core/colour.ts` only decides
whether a string is a colour at all, which is a parsing question rather than a colour one.

### 20.3 What reopens it

A third pick, if one is ever wanted for the same reason these two were: the argument above is about *which* tokens are a
taste, not about the number two. What does not reopen it is option B — the answer to "I want to set `line`" is that
`line` is a step away from `surface` and the surface is the theme's. Option C returns if a picked pair ever has to
travel: a palette a person made on the laptop and wants on the phone is a thing to store and to name, and X-14's
argument against syncing a preference is weaker for a colour somebody built than for one they chose off a list.
