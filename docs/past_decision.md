# Past decisions

History of project's decision. The situation, its options and resolution.

## 1. Decision log

| Decision | Chosen | Over | 
| --- | --- | --- | 
| [Tech stack](#2-tech-stack) | Vite + TypeScript + Svelte, in a browser | Kotlin, Dart, Rust, Go, C#/.NET, React Native; and vanilla ESM, React, Lit | 
| [T-6 Cyclic tree state](sync-flow.md#62-the-repair) | Drop the cycle edge with the oldest `(parentSetAt, device id)` at read time, never written | - non-temporal tiebreak (node id)<br>- Prevention by limitting hierarchy level (flat groups)<br> -pre-defined hierarchy folder->list->item |
| [Sync data model](#4-sync-data-model) |  append-only op log per device | -  whole-tree snapshot per device<br>-  snapshot plus op tail<br>-  one file per node |  
| [State Management](#3-state-management) |  Materialised State Store, reactive views | -  prototype logic, scaled up<br>-  local database, folder as a sync target<br>-  event-driven<br>-  CRDT document | 

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