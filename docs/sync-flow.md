# Sync flow

What a device writes into the Sync Folder, and how devices agree on a tree from it.

The prototype proved the transport and the detection of races over a single text field; carrying that up to a tree of
nodes was the open piece of design, and it is the decision the rest of the application hangs off. It is now closed:
[§4.6 The decision](#46-the-decision) chooses option B, the append-only op log per device, which closes milestone M0 in
[requirements.md §17 Milestones](requirements.md#17-milestones) and unblocks
[requirements.md §2 Data model](requirements.md#2-data-model),
[requirements.md §8 Device management](requirements.md#8-device-management) and
[requirements.md §9 Conflict presentation](requirements.md#9-conflict-presentation).

[past_decision.md §3 State Management](past_decision.md#3-state-management) chose a Materialised State Store holding the
tree over a CRDT document, which settled a fifth option before the comparison started. Four candidates were weighed, and
that decision constrained two of them.

[§5 Sibling ordering](#5-sibling-ordering) and
[§6 Concurrent moves and cycle repair](#6-concurrent-moves-and-cycle-repair) are the two tree questions that do not wait
for the payload. The cycle-repair rule is decided and recorded in
[past_decision.md §1 Decision log](past_decision.md#1-decision-log); sibling ordering points at one candidate and owes
two details before it can close.

Terms carry the definitions in [glossary.md](glossary.md). For the layers around this — adapters, storage, packaging —
see [architecture.md](architecture.md).

---

## 1. What has to converge

Two things synchronise, and only one of them is ours.

**Files in the Sync Folder.** The provider's client moves bytes between devices. It happens while the app is closed, it
offers no completion signal, and the application has no code for it. The one rule the application obeys is that a device
writes only paths carrying its own device id, which means no two devices ever write one path and the provider's
conflict-copy behaviour never triggers.

**Application content.** The tree the user sees. This is where concurrent edits meet, and where the whole design
question lives.

## 2. What the prototype settled

Proven by `prototype/core/` and its tests, and carried as the `pt.` rows of
[requirements.md §7.1 Proven in the prototype](requirements.md#71-proven-in-the-prototype). These results hold whichever
payload is chosen, so they are stated over the *device file* — whatever a device writes under its own id. The
prototype's device file happened to be a snapshot, because its whole payload was one; the chosen payload's is a log
([§4.6 The decision](#46-the-decision)). Nothing below depends on which.

### 2.1 Version vectors detect races; nothing prevents them

Each device file carries an `sClock` — a map of device id to counter. A device's own counter records how many edits it
has made; every other counter is a receipt for what it has read from that device. A device absent from the vector counts
as zero, so a new device joins by writing a file, with no registration and no coordination.

Only a device may increment its own counter. Folding in a peer's edit joins the two vectors pointwise.

`dominates(a, b)` asks whether every one of `a`'s counters is at least `b`'s. Calling it both ways classifies the pair:

| `dominates(peer, ours)` | `dominates(ours, peer)` | Relation | Consequence |
| --- | --- | --- | --- |
| true | false | peer ahead | adopt the peer's content |
| false | true | peer behind | nothing |
| true | true | equal | nothing |
| false | false | concurrent | race |

### 2.2 The maximal set reduces the whole folder at once

Every device file in the folder is handled in one pass. Drop every one that another strictly dominates — it has already
been folded into that other one and carries nothing new. What survives is the maximal set.

| Maximal set | Consequence |
| --- | --- |
| one device file | adopt it |
| several, identical content | adopt it; the vector is the join of all of them |
| several, differing content | a genuine race between exactly those devices |

The count of devices never appears. Three devices with two of them racing take the same code path as two devices, and
only the racing devices' content is offered — a device whose vector is dominated is an ancestor and its content is not
part of the resolution.

### 2.3 Any device can settle any race

A resolution joins every racing vector and then bumps the resolver's own counter, which makes it strictly dominate all
of them. It becomes the new maximal set and every other device fast-forwards to it. No leader, no quorum, no membership,
no vote. Two devices resolving the same race independently are simply two more concurrent edits, settled the same way.

### 2.4 The cycle

Every 3 s and on window focus: `list()` the folder, `read()` every file, fold the peers into our own state, and write
our own file back **only if the fold changed something**. Writing after adopting a peer's content is not busywork — it
records that we have seen that edit. A device that adopted the content but not the vector would look, on its next edit,
like it had edited concurrently, and would raise a race that never happened.

The 3 s timer is the prototype's, not the production cadence: a fixed poll spends battery on the idle days that dominate
real use, and a browser throttles timers in a hidden tab anyway. Production drives the same cycle from activity instead
— see [§4.6 The decision](#46-the-decision) and S-19 in [requirements.md §7.2 Not built](requirements.md#72-not-built).

### 2.5 The stale-state trap

A browser restores what was in a text field when a tab reopens, and the naive page counts that as an edit — producing a
fresh vector wrapped around stale content, which every device then fast-forwards to. Three defences, all of which a
production editor still needs: opt out of restoration on every input, discard `input` events that arrive without focus
and re-render from application state, and treat a value equal to the stored one as no edit at all.

## 3. Why a snapshot does not scale to a tree

The prototype's unit of conflict is the whole file, and the file holds one string. Scale that to a tree and the unit of
conflict becomes the entire database: a user who ticks a box on the phone while renaming an unrelated folder on the
laptop is asked to choose between two whole trees, and one of the two edits is lost whichever they pick.

S-2 in [requirements.md §7.2 Not built](requirements.md#72-not-built) is the requirement this creates — a mutation shape
that merges at field granularity rather than whole-document — and S-15 is its encoding. Both are answered by
[§4.6 The decision](#46-the-decision): an op log, encoded as JSON Lines.

Three tree-specific requirements constrain any answer:

| ID | Requirement | What it demands of the payload |
| --- | --- | --- |
| T-5 | A move that would create a loop is refused | local validation before the write |
| T-6 | A Cyclic tree state from concurrent moves is repaired at read time by re-rooting, never by writing | the reader must tolerate a cyclic input and produce a tree anyway |
| T-7 | Deleting a node tombstones its whole subtree | deletion is not the absence of data; absence and deletion must be distinguishable |

T-6 is the sharp one. Two devices can concurrently move A under B and B under A, and both moves are individually legal.
No payload prevents it; the reader has to survive it.
[§6 Concurrent moves and cycle repair](#6-concurrent-moves-and-cycle-repair) is how.

## 4. Sync data model

Four are weighed here. A CRDT library document was the fifth and is not among them:
[past_decision.md §3 State Management](past_decision.md#3-state-management) chose a Materialised State Store over it, on
the ground that a binary document forfeits the readable folder. Every merge property that option would have supplied is
one a survivor here has to write and test.

**B and C inherit a constraint.** The same decision rejected a Log-Derived State — the log as the model, every read a
replay. A log payload is therefore allowed as what the *folder* holds, not as what the application thinks in: the store
materialises the tree once at load and keeps it there. This is a cheap rule to honour on day one and expensive to
retrofit, because a projection-per-read design does not become a materialised one by refactoring the views.

### 4.1 A — Whole-tree snapshot per device

`checklist.<device-id>.json` holds the entire tree plus one vector. Exactly the prototype, with a tree where the string
was.

| | |
| --- | --- |
| For | Already proven end to end, including the conflict UI and the multi-device scenarios. No growth problem and no compaction, ever. The folder is readable and hand-repairable. Cold start is one file read. |
| Against | Conflict granularity is the whole database, which is unusable for a real tree — see [§3 Why a snapshot does not scale to a tree](#3-why-a-snapshot-does-not-scale-to-a-tree). The full tree is rewritten and re-uploaded on every debounced edit. T-6 cannot arise, but only because concurrent moves are already a whole-tree conflict. |
| Verdict | Viable only as a deliberate first milestone, with the intent to replace it. |

### 4.2 B — Append-only op log per device

`checklist.<device-id>.ops.jsonl`, one op per line. A header line carries the full vector; each op carries its own
counter, and a receipt for a peer only when that receipt changes. State is the fold of every device's log.

```
{"v":1,"dev":"1111aaaa","clock":{"1111aaaa":13,"2222bbbb":4}}
{"op":"create","id":"n_7f3a","parent":"root","kind":"task","order":"a3","c":14,"at":1755500000}
{"op":"set","id":"n_7f3a","title":"Buy milk","c":15,"at":1755500042}
{"op":"move","id":"n_7f3a","parent":"n_2ab1","order":"a3f","c":16,"at":1755500310,"seen":{"2222bbbb":5}}
```

Every intermediate vector is reconstructible by replaying forward from the header, so carrying a full vector per line
would cost bytes and buy nothing — [§4.6 The decision](#46-the-decision).

| | |
| --- | --- |
| For | Conflict granularity is the field. Disjoint edits merge with no user involvement, which removes the conflict UI from the common path entirely. Appends are small, so a keystroke does not re-upload the database. Undo, history and per-device attribution come free. Diff-readable in the folder. Satisfies S-2 directly, and JSON Lines is the encoding S-15 already names as a candidate. |
| Against | The log grows without bound until compaction exists, and compaction across devices that may be offline for months is genuinely hard — S-14, milestone M3. Ops need a total order that every device derives identically. T-6 must be handled explicitly at read time. The store must materialise the tree rather than replay the log per read, per [§4 Sync data model](#4-sync-data-model). Most code to own of the four. |
| Verdict | **Chosen** — [§4.6 The decision](#46-the-decision), which defers compaction rather than solving it. |

### 4.3 C — Snapshot plus op tail

Each device writes a periodic full snapshot and appends ops since it. Readers load the newest snapshot and replay the
tails.

| | |
| --- | --- |
| For | Bounds log growth without a cross-device compaction protocol: each device compacts its own files on its own schedule, and no other device has to agree. Cold start is a snapshot read plus a short replay rather than a full history replay. Keeps every merge property of option B. |
| Against | Two formats that must mean the same thing, and a bug where they disagree is subtle. The cut point — when to snapshot, which ops become redundant — needs care when a peer is far behind. More moving parts than B on day one, fewer by month six. |
| Verdict | Where option B ends up anyway. Worth considering as the starting point rather than the destination. |

### 4.4 D — One file per node

`nodes/<node-id>.<device-id>.json`, or a directory tree mirroring the checklist. Each node carries its own vector.

| | |
| --- | --- |
| For | Conflict granularity is the node, with no merge log to fold. A write touches one small file, so the provider client syncs only what changed. The folder is browsable in the provider's own web UI — the checklist is visible as files. No growth problem. |
| Against | File count grows with the tree, and cloud clients degrade badly on thousands of small files: sync latency, per-file overhead, and `list()` cost on every cycle. Multi-node operations — a move, a subtree delete — stop being atomic, so a half-synced move is a state the reader must handle. Ordering among siblings needs its own representation. |
| Verdict | Attractive until the folder holds a few thousand nodes and the poll cycle starts costing seconds. |

### 4.5 Comparison

| Criterion | A snapshot | B op log | C snapshot + tail | D file per node |
| --- | --- | --- | --- | --- |
| Conflict granularity | whole tree | field | field | node |
| User sees a conflict | on any concurrent edit | rarely | rarely | on same-node edits |
| Bytes per edit | whole tree | one line | one line | one node |
| Files in the folder | one per device | one per device | two per device | one per node per device |
| Cold start | one read | full replay | snapshot + tail | read all |
| Unbounded growth | no | yes, until compaction | no | no |
| Folder readable by hand | yes | yes | yes | yes |
| Handles T-6 cycles | n/a — already a conflict | explicit read-time repair | explicit read-time repair | explicit read-time repair |
| Merge code to own | least | most | most | medium |
| Proven here | yes | no | no | no |

The T-6 row understates how much the four options share:
[§6 Concurrent moves and cycle repair](#6-concurrent-moves-and-cycle-repair) is one read-time function that serves all
four, and it asks only one thing of the payload in return — see [§6.4 What the payload owes](#64-what-the-payload-owes).
No row in this table is answered by a library; every one of them is code this project writes.

### 4.6 The decision

**Option B, the append-only op log per device.** Option C is not a rejected alternative but the planned evolution, with
the trigger stated below. Options A and D are out. The alternatives and the condition that reopens each are recorded in
[past_decision.md §4 Sync data model](past_decision.md#4-sync-data-model).

**Why B before C.** One person editing a checklist produces a handful of operations a day, and days pass between opening
the app on any one device. At that rate the log grows by kilobytes a month, so the one serious objection in
[§4.2 B — Append-only op log per device](#42-b--append-only-op-log-per-device) — unbounded growth — has a horizon
measured in years. C buys bounded growth and a fast cold start, both worth nothing until that horizon arrives, and it
charges for them immediately: two formats that must mean the same thing, and a truncation ordering that can lose data
outright.

Nothing is forfeited by waiting, because **C is a strict superset of B**. A device that never writes a snapshot is a B
device, byte for byte, so adding snapshots later is additive rather than a migration.

**When to add C.** When total log bytes exceed device count × serialised tree bytes — the point at which one snapshot
per device costs less than the history it replaces. Measure it rather than predict it: note bodies (K-3) make the rate
depend on how the application is used rather than on how many nodes exist.

**Why A and D are out.** A's own verdict was that it is viable only as a throwaway first milestone, and B removes the
reason to take it. D's case rests entirely on how a provider's client handles thousands of small files, which is the one
thing that cannot be measured before a Windows and an Android build exist — so deferring that observation rules D out
rather than leaving it neutral.

**Vectors are never pruned.** Dropping a device's counter once its edits are folded in looks like free housekeeping and
is not.
[§2.1 Version vectors detect races; nothing prevents them](#21-version-vectors-detect-races-nothing-prevents-them) makes
an absent counter mean zero, which is indistinguishable from never having seen that device at all, so two devices that
agree completely can read as concurrent:

| | `sClock` as written | how it reads |
| --- | --- | --- |
| X, having pruned D | `{X:10}` | `{X:10, D:0, Y:0}` |
| Y, unpruned | `{D:47, Y:8}` | `{X:0, D:47, Y:8}` |

`dominates(Y, X)` fails on X's own counter and `dominates(X, Y)` fails on D's, so the pair classifies as concurrent and
raises a race that never happened. An epoch attribute meaning "everything below this is folded in" does not rescue it:
advancing the epoch safely requires knowing that every device's edits are already folded, which is the vector floor —
the problem the pruning was meant to avoid. Claim the epoch without knowing, and the false conflict becomes silent data
loss instead, because the claimant's content is adopted over edits it never read.

The vector is already the minimal encoding of what a device has seen. Keeping it whole costs about twenty bytes per
device, forever.

**Ops carry a delta vector.** The saving pruning was reaching for is available losslessly and is larger. An op needs
only its own counter plus a receipt for a peer when that receipt changes; the full vector lives once in the file's
header line, and every intermediate vector is reconstructible by replaying forward. Nothing has to be agreed with anyone
for this to be safe.

**Concurrent writes to one field resolve automatically.** The fold applies ops per node and per field in `(at, device
id)` order, so the newest write to a field wins and disjoint fields never interact. `parentSetAt` is not a special case
— it is this rule's timestamp for the `parent` field, which [§6.2 The repair](#62-the-repair) happens to read.
Converting a row's kind (K-5) and ticking a box are settled the same way: a notice in the conflict nav, never a prompt.

**Note bodies, not task edits, drive growth.** K-3 gives a note a long free-text body and K-7 debounces its saves at 500
ms. A whole-body op is orders of magnitude larger than a tick or a rename, so a single editing session can outweigh a
month of checklist use. Two rules bound that without new machinery: the 500 ms debounce governs the in-memory store,
while an op is emitted only on blur, on navigating away, or after 60 s of continuous editing; and a body two devices
edited concurrently resolves by whole-body last-writer-wins, like every other field. Diffing a body against a checkpoint
and folding the diffs at compaction is option C applied to one field, and it waits for the same trigger.

**The cycle runs on activity, not on a timer.** The write path is the sync cycle — a debounced edit reads, folds and
writes in one pass, which S-1 already requires. After writing stops the cadence decays through 5 s, 15 s and 60 s and
then stops, leaving window focus and a manual refresh as the triggers. This is not only a battery argument: a browser
throttles timers in a hidden tab and freezes them when a PWA is backgrounded, so focus is the only idle trigger that can
be relied on at all. The cadence is a property of a device rather than of the data, so it is stored locally and never in
the Sync Folder.

**What must be right on day one.** Cheap now, awkward to retrofit — and none of it is the snapshot:

1. The op schema is complete enough to replay deterministically.
2. A total order over ops that every device derives identically.
3. `parentSetAt` on the parent field, separate from the vector —
   [§6.4 What the payload owes](#64-what-the-payload-owes).
4. The store materialises the tree once at load, never a projection per read.
5. Compaction, when it arrives, overwrites a device's own file in place. There is no `delete()` —
   [architecture.md §4 The folder adapter](architecture.md#4-the-folder-adapter) fixes the adapter at three methods — so
   versioned snapshot filenames would accumulate with nothing able to reap them.
6. A tail is never truncated below what the *previous* published snapshot covers. Snapshot and tail sync independently,
   and the ordering "old snapshot, new tail" silently loses ops.

## 5. Sibling ordering

Requirement T-2 wants children in a stable order every device agrees on, and T-3 and T-4 make that order something the
user sets by hand rather than something derived from a title or a timestamp. So order is data, it is edited
concurrently, and it has to converge like everything else.

This choice is independent of [§4 Sync data model](#4-sync-data-model). Order is a property of a node relative to its
siblings; every payload can carry it, and no payload supplies it.

### 5.1 What the environment demands

Four constraints come from decisions already made, and they eliminate more than the usual textbook comparison does.

**A skipped file is normal.**
[architecture.md §2 What the prototype settled](architecture.md#2-what-the-prototype-settled) establishes that the
provider's client can be mid-download when `read` lands, and that the reader skips a file it cannot parse and picks it
up whole next cycle. Any ordering that reads as a *chain* therefore breaks in a specific way: a missing link makes
everything behind it unreachable, so a transient half-sync silently truncates a list. An ordering that reads as a *sort*
degrades instead — the absent node is simply not there yet, and the rest keep their relative order.

**T-6 re-roots nodes at read time.** A node repaired out of a cycle arrives among siblings it was never ordered against.
Whatever ordering is chosen has to place it deterministically without a write, because T-6 forbids repairing by writing.

**T-7 tombstones subtrees.** If ordering depends on naming a neighbour, tombstones have to be retained as anchors
forever, and the tombstone stops being a deletion record and becomes load-bearing structure.

**The folder is meant to be readable.** A stated attraction of the whole design, and the reason
[past_decision.md §3 State Management](past_decision.md#3-state-management) rejected a CRDT document. An ordering nobody
can read by opening the file spends the same coin, on a smaller scale and without the compensation a library would have
offered.

### 5.2 The candidates

**1 — Array of child ids on the parent.** The parent holds `children: [id, ...]` and the order is literally that.

| | |
| --- | --- |
| For | No ordering algorithm at all. The order is visible as written, which is as readable as the folder gets. Natural under [§4.1 A — Whole-tree snapshot per device](#41-a--whole-tree-snapshot-per-device), where the whole tree is one field anyway. |
| Against | The list is one field, so two devices inserting into one parent conflict — the merge granularity collapses back to the sibling list however fine the payload is. Reintroduces the whole-document conflict of [§3 Why a snapshot does not scale to a tree](#3-why-a-snapshot-does-not-scale-to-a-tree), scoped to a parent. |
| Verdict | Only coherent with option A, and it inherits option A's verdict. |

**2 — Integer sequence numbers.** Each child carries `index: 0, 1, 2, …`.

| | |
| --- | --- |
| For | Obvious, readable, sorts trivially. |
| Against | Inserting in the middle renumbers every later sibling, so one insert is N writes. Two devices inserting concurrently produce duplicate indices, and their renumbering interleaves into an order neither intended. The naive answer, and the one that fails hardest under exactly the concurrency this project has. |
| Verdict | No. |

**3 — Fractional index.** Each child carries an order key — a base-62 string, so it can always be subdivided; real
numbers run out of float precision, strings do not. Inserting between two siblings mints a key strictly between theirs.

| | |
| --- | --- |
| For | One write, touching only the moved node, whatever the payload. Reading is a sort on a per-node field, so a skipped file costs that node and nothing else. A re-rooted node still sorts somewhere deterministic. Tombstones are not anchors. Keys are short strings that eyeball fine in the folder. |
| Against | Two devices inserting at the same position compute the *same* key, so the sort must be `(key, device id)` to stay total — see [§5.3 The tiebreak](#53-the-tiebreak). Repeatedly splitting one gap grows keys by roughly a character per split, so a rebalance exists as a rare operation, and a rebalance rewrites a whole sibling list. |
| Verdict | The only candidate that satisfies all four constraints in [§5.1 What the environment demands](#51-what-the-environment-demands). |

**4 — After-pointer, RGA-style.** Each child stores `after: <sibling id | null>`, and the order is the walk.

| | |
| --- | --- |
| For | One write per insert, like option 3. The position is expressed relative to a neighbour, which is what the user actually meant, so it survives unrelated concurrent inserts without interpretation. Well-trodden — this is the shape most list CRDTs use internally. |
| Against | Reading is a chain walk, so a half-synced file truncates the list rather than omitting a row. Deleting a predecessor orphans everything behind it, so T-7 tombstones must be kept forever as anchors. A re-rooted node's predecessor is in a different parent and means nothing. Concurrent inserts after one node still need the same tiebreak as option 3, so the tiebreak is not avoided, only the sort is lost. Order is not visible by reading the file. |
| Verdict | Pays option 3's costs and adds three of its own, all from being a chain rather than a sort. |

**5 — Let the CRDT own it.** A library list type — Yjs array, Automerge list.

| | |
| --- | --- |
| For | Correct by construction, including the interleaving cases that defeat hand-rolled schemes. Nothing to design. |
| Against | Available only inside a CRDT document, which [past_decision.md §3 State Management](past_decision.md#3-state-management) closed. |
| Verdict | **Unavailable.** Never an independent option, and its one carrier is gone. |

### 5.3 The tiebreak

Option 3's one real flaw has one standard fix, and it is worth stating precisely because it is where a hand-rolled
scheme usually goes wrong. Two devices inserting between the same neighbours derive the same midpoint key, so the key
alone is not a total order. Sorting on `(order key, creating device id)` restores it: device ids are unique, a device
never mints one key twice because it always sees its own writes, and every device computes the identical result from the
identical set. Node id as a final component costs nothing and makes totality unconditional.

The order this produces is stable and arbitrary — the two concurrently-inserted rows land in device-id order, not in the
order either user would have chosen. That is the correct outcome for this design: it is deterministic, it needs no
conflict UI, and it matches how [§2.3 Any device can settle any race](#23-any-device-can-settle-any-race) already treats
races.

The case that pins this down is "sibling ordering under concurrent insertion" in
[test.md §3.2 Scenario](test.md#32-scenario), which asserts that every device derives one order (T-2).

### 5.4 Comparison

| Criterion | 1 Array on parent | 2 Integer index | 3 Fractional index | 4 After-pointer | 5 CRDT list |
| --- | --- | --- | --- | --- | --- |
| Writes for one insert or move | the parent's whole list | every later sibling | the moved node | the moved node | the document |
| Concurrent insert at one position | conflict on one field | duplicate indices, order undefined | same key, broken by device id | same predecessor, broken by device id | correct by construction |
| Reading the order | as written | sort | sort | walk the chain | library |
| A skipped half-synced file | intact | intact | that node absent, rest correct | chain breaks, tail unreachable | intact |
| After a T-6 re-root | appended to the new parent | index means nothing | key still sorts | predecessor is in another parent | by construction |
| T-7 tombstones as anchors | not needed | not needed | not needed | required forever | library's problem |
| Order readable in the folder | yes, literally | yes | yes, once you know it sorts | no | no |
| Unbounded growth | no | no | key length, until a rebalance | tombstones | library-dependent |
| Suits payloads | A | none | A, B, C, D | B, C | none — its carrier is closed |

### 5.5 What this points to

**Fractional index with a device-id tiebreak.** No payload supplies ordering, so this chapter applies whichever of the
four survives. Option 3 is the only candidate that reads as a sort rather than a walk, which is what makes it tolerate
the half-synced file the transport guarantees; and it is the only one that works unchanged across all four payloads,
which matters while [§4 Sync data model](#4-sync-data-model) is still open.

Not yet decided, and two details are owed before it can be:

1. **Rebalancing policy.** When keys in one sibling list grow past some length, they are reissued. That rewrite is a
   whole-list write, so it is a conflict magnet and needs to happen rarely and as an ordinary edit rather than a special
   case. The trigger threshold and whether one device may rebalance a list another is editing are open.
2. **Key generation at the ends.** Appending and prepending are the common operations in a checklist — a new task at the
   bottom, a new one at the top — and a naive midpoint scheme grows keys on every prepend. Allocating a fresh digit
   beyond the end instead keeps both ends O(1) in key length, and only interior splits grow.

## 6. Concurrent moves and cycle repair

T-6 asks for a tree from an input that may not be one. Two devices concurrently move A under B and B under A; the merge
takes both writes, because each wrote only its own file and neither version dominates the other. The result is `A.parent
= B` and `B.parent = A` — a pair unreachable from the root, so a walk down never finds it and a walk up never
terminates.

Like [§5 Sibling ordering](#5-sibling-ordering), this is independent of [§4 Sync data model](#4-sync-data-model), with
the one exception in [§6.4 What the payload owes](#64-what-the-payload-owes).

Unlike sibling ordering, the rule here is decided: [past_decision.md §1 Decision log](past_decision.md#1-decision-log)
carries it, and [requirements.md §3 Tree structure and editing](requirements.md#3-tree-structure-and-editing) points
T-5, T-6 and T-7 at this chapter. What follows is the reasoning behind that row.

### 6.1 T-5 is not the loop defence

T-5 refuses a move that would create a loop, and it is worth being precise about what that buys. The check is a local
ancestor walk before the write, and against the state the writing device can see it is correct. It catches the
single-device case: a user dragging a folder into its own child.

It cannot catch the case above. Neither device performed an illegal move — both validated correctly against everything
they could see, and the cycle was created by the merge rather than by either write. Preventing it would need the two
devices to agree before writing, which is exactly what
[requirements.md §7.3 Fixed constraints](requirements.md#73-fixed-constraints) has permanently given up. T-5 is a few
lines and worth having; it is not what keeps the tree a tree.

### 6.2 The repair

Resolving a node's parent walks up with a seen-set. If a node repeats, the walk is inside a cycle, and one edge is
dropped: the one whose parent was set longest ago. That node renders at the root, every other node in the cycle keeps
its parent, and what remains is a valid tree.

The loser is the cycle member with the oldest `(parentSetAt, device id)`, where `parentSetAt` is the timestamp the move
carried when it was written. Two properties make that safe:

- **It is a pure function of merged state.** Every device reads the same `parentSetAt` values out of the same files and
  drops the same edge. Nothing in the repair may read the local clock — the same rule as
  [test.md §4 What the tests must not do](test.md#4-what-the-tests-must-not-do), where it is a testing convention. Here
  it is what convergence rests on.
- **It is total.** Device id breaks an exact timestamp collision, which two devices can produce, and node id after that
  costs nothing.

A version vector cannot do this job, which is worth stating because it is the natural thing to reach for. The two moves
in a cycle are concurrent by construction — if either dominated the other there would be no cycle — so the vector orders
them not at all. A separate scalar is unavoidable.

**Nothing is written.** T-6 requires that, and it is also what keeps the repair cheap: a write would be a fresh
concurrent edit made by every device that happened to render the tree, which is a race in place of a cycle.

**The repair is one shared function, not renderer code.** Breadcrumbs (T-9) and the T-7 tombstone walk climb the same
parent chain, and both hang on a cycle if they climb it themselves. Every ancestor walk in the application goes through
the resolved parent.

**It is self-healing.** The user sees the re-rooted node at the top level and moves it back. That corrective move is an
ordinary move — normal write, normal merge — and it breaks the cycle permanently for every device. There is no
resolve-conflict path to build or to test.

This is a different rule from [§5.3 The tiebreak](#53-the-tiebreak), which orders siblings by `(order key, device id)`.
Both are total and both are pure, and they answer different questions; they should not share a function or a name.

**What it was chosen over.** Two alternatives, both recorded in
[past_decision.md §1 Decision log](past_decision.md#1-decision-log). A stable non-temporal tiebreak — node id alone —
converges equally well and needs no `parentSetAt` field, but it re-roots a node for a reason no user can be told, where
"the newer move survives" is explicable. Preventing cycles structurally, by allowing only flat groups or a fixed
folder/list/item depth, trades [T-1](requirements.md#3-tree-structure-and-editing) away to delete one bounded read-time
function.

[test.md §3.2 Scenario](test.md#32-scenario) carries the cases: the A→B/B→A repair, moving the re-rooted node back
afterwards, and deleting a subtree that contains a cycle, which is where the T-7 tombstone walk has to climb the
resolved parent to terminate.

### 6.3 The user has to see it

A node silently teleporting to the top level reads as data loss, and the reaction to apparent data loss is to go looking
for what else broke. The repair needs a non-blocking notice that names what moved and offers to jump to it.

That belongs with the rest of [requirements.md §9 Conflict presentation](requirements.md#9-conflict-presentation), which
is unwritten; it is recorded here so it is not lost between the two documents.

### 6.4 What the payload owes

The parent field needs its own timestamp, separate from the document's version vector. Under
[§4.2 B — Append-only op log per device](#42-b--append-only-op-log-per-device) and
[§4.3 C — Snapshot plus op tail](#43-c--snapshot-plus-op-tail) that is free, since a `move` op already carries when it
happened. Under [§4.1 A — Whole-tree snapshot per device](#41-a--whole-tree-snapshot-per-device) and
[§4.4 D — One file per node](#44-d--one-file-per-node) it is a per-node field to add. A CRDT document is the one option
that would have owned the question itself, and
[past_decision.md §3 State Management](past_decision.md#3-state-management) closed it — so every candidate here owes the
field.

Cheap to specify now and awkward to retrofit, which is why it is written down before
[§4 Sync data model](#4-sync-data-model) closes rather than after.

### 6.5 Accepted limit

Device clocks skew, and there is no server to correct them. A phone running two minutes fast wins a move it should have
lost, so the node that re-roots is occasionally the one the user would rather have kept.

Convergence is unaffected — every device still drops the same edge, because every device is reading the same recorded
timestamp. Only the choice is wrong, and only against an intent that no data records. For one person with a handful of
devices the cost is dragging a node back, and that is accepted rather than designed around —
[requirements.md §7.3 Fixed constraints](requirements.md#73-fixed-constraints) carries it as a standing constraint
rather than a defect.

## 7. What is still open

Questions the payload decision does not answer, listed so they are not mistaken for settled:

1. **The compaction cut rule.** Deferred rather than solved: [§4.6 The decision](#46-the-decision) gives the trigger and
   S-14 stays at milestone M3. What is open is the rule itself when it arrives — which ops become redundant, and how far
   a tail must overlap the previous snapshot to stay safe for a peer that is months behind.
2. **Sibling-order rebalancing.** [§5.5 What this points to](#55-what-this-points-to) owes two details: the key length
   at which a sibling list is reissued, and whether one device may rebalance a list another is editing. Allocating a
   fresh digit beyond the end keeps appends and prepends O(1) in key length, so the interior split that grows keys is
   the rare case in a checklist and the threshold can be generous.
3. **Tombstone retention.** T-7 tombstones are the majority of the node count after a year of use, and dropping one
   safely needs the same cross-device floor that vector pruning needed. Keeping them is the same trade
   [§4.6 The decision](#46-the-decision) makes: bytes in exchange for no coordination problem. An archive view that
   hides finished and deleted rows is a read-time filter over `done` and age — derived rather than stored, so it needs
   no sync and no writes — and it belongs with M3.
4. **Retiring a device.** No longer a correctness question. A dead device's file is dominated by every live one, so
   [§2.2 The maximal set reduces the whole folder at once](#22-the-maximal-set-reduces-the-whole-folder-at-once) drops
   it from the maximal set as an ancestor and it never joins a resolution again. What remains is presentation, and one
   real subtlety: the device id lives in `localStorage`, so it is per-origin, and
   [architecture.md §7.1 The two Windows bundles](architecture.md#71-the-two-windows-bundles) makes one Windows machine
   two devices when it is used through both the hosted PWA and the loopback bundle. Whether the second origin adopts the
   existing id or joins as a peer is open. S-16, and it belongs with
   [requirements.md §8 Device management](requirements.md#8-device-management) rather than here.
5. **Provider behaviour.** The prototype was exercised against a folder on this machine. Each provider's client has its
   own latency, its own partial-file behaviour and its own opinion about many small files. Deliberately deferred until a
   Windows and an Android build exist to observe it with — which is also what removed option D, since D was the only
   candidate whose viability *was* that observation.
