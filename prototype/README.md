# Sync prototype — one sentence, two devices, a shared cloud folder

Throwaway code answering three questions before the real app commits to
anything:

1. Does folder-based sync between a laptop and a phone actually work?
2. What storage does it need — on the device, and in the cloud?
3. What does an offline edit that raced look like to the person holding the
   phone?

**There is no server anywhere in this design.** No API, no OAuth, no account,
no network code in the app at all. The app reads and writes files in an
ordinary folder. Whatever cloud client is already installed — Dropbox,
OneDrive, Google Drive, Syncthing, iCloud — carries those files between
devices, over each device's own internet connection. The two devices never
address each other and never need to be on the same network.

That is also why the provider does not matter. The app needs three operations
from a folder — `list`, `read`, `write` — and every provider gives you those by
just being a folder.

## Run it

**Laptop (Windows or Linux, Chrome or Edge):**

```bash
npm run proto          # serves the app on 127.0.0.1:5175 — this device only
```

Open <http://localhost:5175>, name the device, click **Choose folder…** and pick
a folder inside your cloud drive, e.g. `C:\Users\you\Dropbox\checklist`. Type.
Your text lands in `checklist.<device>.json`.

`install/serve.mjs` binds to `127.0.0.1` and is not reachable from the network.
It exists only because browsers refuse folder access over `file://`; it is the
"install the app" step, and it is per-device forever.

**From a terminal, against a real folder** — the quickest way to convince
yourself before trusting any UI:

```bash
node prototype/install/cli.mjs ~/Dropbox/checklist laptop "Buy milk"
node prototype/install/cli.mjs ~/Dropbox/checklist laptop --watch
```

**The tests:**

```bash
npm run proto:test     # two devices, a simulated cloud client, headless
npm run proto:ui       # the browser shell (server must be running)
```

## 1. Testing on the phone today, without building anything

The file format is deliberately plain JSON, and that is not only for debugging:

```json
{
  "device": "laptop",
  "author": "laptop",
  "text": "Buy milk",
  "clock": { "laptop": 3, "phone": 1 },
  "updatedAt": "2026-08-12T10:14:00Z"
}
```

So the phone half is testable **right now with no app at all**:

1. On the laptop, write a sentence into a folder inside your cloud drive.
2. On the phone, open the Dropbox/Drive/OneDrive app, find
   `checklist.laptop.json`, and read it. The sentence is there — that is the
   laptop → phone direction proven.
3. Edit `checklist.phone.json` in any Android text editor, bumping
   `clock.phone` by one and leaving the other numbers alone.
4. On the laptop, `--watch` picks it up. That is the phone → laptop direction.

Tedious by hand, obviously — bumping a counter is exactly the bookkeeping an app
should do for you. But it proves the transport end to end before a single line
of Android code exists, and if it fails, it fails somewhere you can see.

## 2. How it works

### One file per device — the whole safety argument

A synced folder gives no locking and no conditional write. Two devices writing
one file is how you get `checklist (nam's conflicted copy).json`, and it is the
single biggest reason folder sync gets a bad reputation.

So no two devices ever write the same path:

```
Dropbox/checklist/
  checklist.laptop.json     <- only the laptop ever writes this
  checklist.phone.json      <- only the phone ever writes this
```

Each device **writes one file and reads all of them**. The provider never sees a
concurrent write, so its conflict-copy behaviour cannot trigger. Everything
below is downstream of that one rule. (`test/scenario.mjs` §8 asserts it holds.)

### Version vectors — ordering without a server

With no server and no ETag, ordering has to come from the data. Each snapshot
carries a vector counting, per device, how many edits _by that device_ it has
incorporated:

- `{laptop: 2, phone: 1}` vs `{laptop: 3, phone: 1}` — the second has seen
  everything the first has, plus more. **Newer.** Take it silently.
- `{laptop: 2, phone: 1}` vs `{laptop: 1, phone: 2}` — each knows something the
  other does not. **Concurrent.** Nothing can order these, so ask the user.

That distinction is the entire point. A timestamp cannot tell the difference
between "later" and "at the same time on a device with a fast clock"; a vector
can, and it needs no synchronised clocks between devices that may not have
spoken in days.

Adopting a peer's text also means adopting its clock — recording that we have
_seen_ that edit. A device that took the text but not the clock would look, on
its very next edit, like it had edited concurrently, and raise a conflict that
never happened. `core/device.mjs` calls this out.

### The conflict is local, and it stays local

When two vectors are concurrent, the device holds its own text and shows both
sides. Nothing is written to the folder while a conflict is open — so the other
device learns nothing about it, which is precisely what "shown in the local
device only" requires.

Resolving joins both clocks and bumps our own, producing a version that strictly
dominates both. The other device sees a snapshot newer than everything it knows
and fast-forwards to it — no second conflict, no ping-pong.

One finding from the property test worth stating plainly: **only one device may
resolve.** A resolution is itself an edit, so two devices resolving the same
conflict independently are just two more concurrent edits, and they chase each
other indefinitely. Fine for one person holding one device at a time; a real
hazard if this ever became multi-user.

## 3. Storage

### On the device

| Option                       | Verdict                                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The synced folder itself** | Where the shared state lives. Every device's copy is a full replica, so "local first" is automatic — the app reads its own folder whether or not the internet exists |
| `localStorage`               | Only for device identity and UI preferences here. Synchronous, ~5 MB — wrong for list data                                                                           |
| **IndexedDB**                | What the real app already uses via Dexie. For a prototype syncing one sentence it earns nothing, so this does not use it                                             |

Note what the folder model removes: there is no separate "outbox" or pending
queue. An offline edit is just a written file. The cloud client uploads it when
it can, and its retry logic is code you do not write, test, or own.

### In the cloud

The app needs `list`, `read`, `write` on a folder. That is all. Which means:

| Provider         | Works  | Notes                                                                                               |
| ---------------- | ------ | --------------------------------------------------------------------------------------------------- |
| **Dropbox**      | Yes    | Best-behaved desktop client; conflicted copies are visible when they happen (they should not, here) |
| **OneDrive**     | Yes    | Preinstalled on Windows — likely the least-friction option on your laptop                           |
| **Google Drive** | Yes    | Desktop client mounts as a drive; Android side is a first-class app                                 |
| **Syncthing**    | Yes    | No cloud account at all, device-to-device. Also proves the design needs nothing from a provider     |
| **iCloud Drive** | Partly | Fine on Apple devices; poor Windows story                                                           |

The single-writer rule is what makes this list boring, and boring is the result.
Any of them works, so the choice can be made on price, on which client is
already installed, or on which folder you would rather look at.

**The one thing to check per provider** is how aggressively the client syncs a
small file that changes often — some batch, some throttle background uploads.
That sets how long "a few seconds" actually is, and it is the number worth
measuring on your own accounts.

## 4. Windows and Android are not symmetric

This is the real constraint the prototype turned up, and it decides how the app
gets built.

|                              | Laptop (Windows)                                | Phone (Android)                                           |
| ---------------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| Folder access from a browser | **Yes** — File System Access API in Chrome/Edge | **No.** `showDirectoryPicker` is desktop-only             |
| What it needs                | The static app + a localhost server             | An installed app using Android's Storage Access Framework |

So the laptop half is a browser app and works today. The phone half **cannot be
a plain web page** — a browser on Android cannot be granted a folder. It needs
an installed app that asks for the folder through SAF and hands it to the same
core.

That is exactly what you described, and it is the honest reading of the
constraint rather than a preference.

**What is built:** `core/` is pure and adapter-agnostic; `adapters/` has three
implementations of the same three methods (Node fs, browser File System Access,
in-memory). A WebView wrapper needs to supply a fourth — `list`, `read`, `write`
over a SAF tree URI — and nothing else changes.

**What is not built:** the APK. There is no Android SDK on this machine, and
building one is a bigger piece of work than a prototype should smuggle in. The
path is a Capacitor or TWA shell around `public/` plus a SAF folder plugin. Note
this also contradicts _"PWA, not native"_ in `CLAUDE.md` — folder sync on
Android is a genuine reason to revisit that decision, so it should be revisited
deliberately, not by accident.

## 5. What is proved, and what is assumed

`npm run proto:test` runs the full story headlessly — two devices, each with its
own folder, and a `deliver()` step that models what a cloud client does in the
background (upload mine, download theirs). Being offline is simply not calling
it. Every assertion below passes, including a randomised 4-device, 300-step
convergence test that settles on every seed tried:

- Laptop edits → phone starts up and sees it.
- Phone edits → laptop sees it, no conflict, because it was causally later.
- Laptop offline: the edit is durable locally and the cloud is untouched.
- Both edited blind → **the laptop raises a conflict, the phone knows nothing**,
  and the laptop writes nothing while it is open.
- Resolving on the laptop propagates; the phone fast-forwards without a conflict
  of its own.
- Every file in the cloud folder was written only by its owner.

Assumed, not proved, and worth testing on your own accounts:

- **A real provider has not been in the loop.** Delivery is simulated by copying
  files. What that skips is real-world timing, partial downloads, and each
  client's own idea of when to upload. Write-then-rename in
  `adapters/node-folder.mjs` guards against a client uploading a half-written
  file, but that guard is untested against an actual client.
- **One sentence, not a list.** Whole-file last-writer-wins is fine for one
  field. For a real checklist it would mean editing item 3 on the phone
  clobbering item 40 on the laptop — per-item granularity is not optional, and
  that is what the op-log design in `docs/sync-flow.md` already provides.
- **Polling.** A synced folder has no change notification, so the app re-lists
  every 3 s. Fine on a desktop; on a phone that has to back off in the
  background.

## 6. What this suggests for the real app

The folder model composes with `docs/sync-flow.md` rather than competing with
it — both rest on the same single-writer rule, and that is the load-bearing
idea in each. Two things transfer:

1. **The conflict UI is probably not worth building.** Every conflict this
   prototype raised was one field racing itself. At checklist granularity, the
   op log's per-field LWW resolves the same situations silently and correctly,
   and the surviving cases are rare enough for one user that `sync-flow.md` is
   right to skip the dialog. Keep the _detection_ if you want a "this was
   overwritten" affordance later; skip the modal.
2. **Version vectors are the cheap way to know what a peer has seen.** The op
   log currently tracks per-file cursors. A vector per device answers "has this
   device seen my edit yet?" directly, which is what a sync-status UI actually
   wants to display.
