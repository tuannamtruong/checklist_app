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
