# Prototype

Prototype for syncing one single text field in a web application across multiple devices.

The prototype answering these questions:

1. Does folder-based sync between a windows 11 laptop and an android actually work?
2. What storage does it need on these devices?
3. How to handle race-condition when the devices makes Write op offline?
4. Can it works in all browsers (Chromium, Firefox)?

The design contains **no**: database engine, API, OAuth, account, network code.
The app reads and writes files in an folder, that resides in a Cloud Provider.
The client of the Cloud Provider is needed to be installed for synchronisation
of multiple devices.

Which cloud provider should makes no differences. The app needs three operations:
`list`, `read`, `write`. Every provider grants those by just being a folder.

## Glossary

Sync folder: a specific shared folder in the cloud provider directory, which contains all items of the application.

Replica Item: checklist.<device-id>.json files inside sync folder.
It is device's replica of the shared state. Every device holds a full replica, which is what makes the app work offline .

Windows bundle: an official embeddable Python staged on the Windows side plus a desktop shortcut to `pythonw.exe`.
No `.exe` is produced deliberately, because a shortcut to Microsoft's own signed binary raises no SmartScreen warning.

Demo mode: `?demo` in the URL, running the whole app against an in-memory folder with no disk and no network, with `window.__injectPeer(id, text, clock)` to fake a peer (`adapters/memory-folder.mjs`).

## Validation Procedure

### Install

**Laptop - Bundle for Windows**

Creating and install the bundle

```bash
python3 install/make_windows_bundle.py
```

To also pass the sync folder while install

```bash
python3 install/make_windows_bundle.py --folder "C:\Dropbox\checklist"
```

**Laptop - running with CLI inside WSL**

Picking folder in UI

```bash
npm run proto
```

Folder as parameter

```bash
npm run proto -- --folder ~/Dropbox/checklist
```

**Android - APK**

All dependencies to build the APK are in Docker container: JDK, Android SDK, Gradle.
The first run builds the image (~2.4 GB), after that only the APK is rebuilt.

```bash
make proto_android
```

Gradle task pulls `public/`, `core/` and `adapters/` from `prototype/` at build time,
so there is one copy of the sync core and the phone cannot drift from the laptop.

### Running

The webapp will be located in `http://localhost:38531/`

Picking the folder in the page (if not specified during install)
Click **Choose folder…** for choosing folder.

On Android there is no localhost and no picker in the page: the app boots
straight to **Choose folder…**, which opens the _system_ picker (Storage Access
Framework). The grant is kept across restarts, so the folder is picked once.

## Logic

### Replica Item

A synced folder gives no locking and no conditional write. Each device writes a distinct `checklist.<device-id>.json` file to the sync folder.
1111aaaa: device-id of the laptop
2222bbbb: device-id of the phone

```
Sync-Folder/
  checklist.1111aaaa.json     <- only the laptop ever writes this
  checklist.2222bbbb.json     <- only the phone ever writes this
```

Each device **writes one Replica Item and reads all Replica Items**. No concurrent write of Replica Item will happens.

Fields in Replica Item

```json
{
  "device": "1111aaaa",
  "label": "laptop",
  "author": "1111aaaa",
  "text": "Buy milk",
  "clock": { "1111aaaa": 3, "2222bbbb": 1 },
  "updatedAt": "2026-08-12T10:14:00Z"
}
```

| Field     | Description                                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| device    | A generated 8-hex-character id that names the replica file and never changes.                                                                                                                                       |
| label     | The human name for a device, display only, carried inside the file and never in its name.                                                                                                                           |
| author    | The device whose edit produced the current text, which is not always the device that owns the file. A device that adopts a peer's text keeps that peer as `author`.                                                 |
| text      | Value of the text field, specific for the prototype.                                                                                                                                                                |
| clock     | Version vector. One counter per device recording how many edits by that device. It is a receipt for what has been read, not a claim about time.                                                                     |
| updatedAt | A wall-clock timestamp used only to pick the newest among snapshots that already agree on the text, and to show a human when something changed. It never decides what happened; clock skew makes it unfit for that. |

### Multi-device change awareness

A synced folder never tells a device that something happened.
There is no notification, no callback, no server pushing an event — files just quietly appear and change under the folder while the app is not looking.
Awareness is therefore not received but **derived**: on every cycle a device reads the Replica Items it finds and compares each one's `clock` against its own (`core/merge.mjs`).

The rule that makes those counters comparable is a single one:

**Only the owner of a slot ever increments it, and only when the user typed on that device.**
Folding in a peer's edit joins the two vectors instead — pointwise max, no bump (`join`, `bump` in `core/merge.mjs`).
So a vector reads in two directions at once: our own slot counts edits we made, every other slot is a receipt for what we have read from that device.
A device that has never appeared in the folder is simply absent from the vector and counts as `0`, so a third device joins with no registration step and no coordination.

Comparing two vectors answers the only question worth asking about a peer's file:

| Relation to our clock | Meaning                                             | Consequence                                                |
| --------------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| peer dominates ours   | The peer has seen everything we have, and then some | Its text is newer — adopt it                               |
| ours dominates peer   | The peer is behind; it has not read our file yet    | Nothing to learn — our own file already carries the answer |
| equal                 | Same knowledge on both sides                        | Nothing to do                                              |
| neither dominates     | Both edited without seeing the other                | A genuine race — raise a conflict                          |

With more than two devices the comparison is not pairwise.
`reconcile()` takes every snapshot in the folder, ours included, and keeps the **maximal** ones — those nothing else strictly dominates.
One surviving text means every other snapshot is an ancestor of it and there is nothing to ask anybody about; two surviving texts is the conflict case, and no merge rule can settle it alone.

Worked through the scenario in `test/scenario.mjs`, with `1111aaaa` the laptop and `2222bbbb` the phone:

| Step                                    | Laptop clock                 | Phone clock                  | Relation              |
| --------------------------------------- | ---------------------------- | ---------------------------- | --------------------- |
| Laptop types "Buy milk"                 | `{1111aaaa: 1}`              | —                            | laptop ahead          |
| Phone syncs and adopts it               | `{1111aaaa: 1}`              | `{1111aaaa: 1}`              | equal                 |
| Phone types "Buy milk and eggs"         | `{1111aaaa: 1}`              | `{1111aaaa: 1, 2222bbbb: 1}` | phone ahead           |
| Laptop syncs and adopts it              | `{1111aaaa: 1, 2222bbbb: 1}` | `{1111aaaa: 1, 2222bbbb: 1}` | equal                 |
| Laptop goes offline, types "…and bread" | `{1111aaaa: 2, 2222bbbb: 1}` | `{1111aaaa: 1, 2222bbbb: 1}` | laptop ahead          |
| Phone types "Buy oat milk" meanwhile    | `{1111aaaa: 2, 2222bbbb: 1}` | `{1111aaaa: 1, 2222bbbb: 2}` | **concurrent**        |
| Laptop reconnects and the user resolves | `{1111aaaa: 3, 2222bbbb: 2}` | `{1111aaaa: 1, 2222bbbb: 2}` | laptop dominates both |

The last row is why resolving joins the racing clocks before bumping: the result strictly dominates every version that raced, so the phone reads it as plainly newer and fast-forwards instead of raising the same conflict again.

Note what the wall clock does **not** do here.
`updatedAt` never decides what happened — two devices with a few seconds of skew would silently hand every race to whichever one has the faster clock, and the loser's edit would disappear with no conflict raised.
It is used only to pick among snapshots that already agree on the text, and to show a human when something changed.

Adopting a peer's text obliges us to write our own file back, even though the user did nothing (`changed` in `applyPeers`).
Taking the text without recording the clock would leave us looking, on our next local edit, as though we had edited concurrently — a conflict that never happened.
Reading is part of the state, so it has to be published like any other change.

What the user sees of all this: the current `author` resolved to a device label, our own clock, the file list with our file marked, and a log line for each incoming edit (`picked up "…" from laptop`).
Labels are not copied around — each device declares its own inside its own file, so the folder as a whole is the lookup table and `labelFor()` reads it (`core/device.mjs`).
A rename is display only: no clock bump, nothing to converge, and peers pick it up on their next read.

### The sync cycle

`core/folder-sync.mjs` generic over the folder it is handed.

Every 3 s and on window focus, a full sync cycle starts:

- `list()` the folder
- `read()` every file (its own is skipped),
- `reconcile()` them against own snapshot (`core/merge.mjs`).
- Write own file back, if something happend during merge.

### Race conditions

Two of them, at different layers.

**A half-written file.** The cloud client may be mid-download when we list the
folder. A file that does not parse is skipped and picked up whole on the next
cycle; our own writes go through write-then-rename
(`adapters/node-folder.mjs`, `install/serve.py`) so no client ever observes a
partial file of ours.

**Two devices edited without seeing each other.** Detecting this is what the
vector above is for; what follows is what the app does once it has.

On a concurrent pair the device holds its own text and shows both sides.
**Nothing is written to the folder while a conflict is open**, so the other
device never learns there was one — the conflict is local and stays local.

Resolving joins every racing clock and then bumps our own, producing a version
that strictly dominates all of them. The other device sees a snapshot newer than
everything it knows and fast-forwards to it: no second conflict, no ping-pong.

**Only one device may resolve.** A resolution is itself an edit, so two devices
resolving the same conflict independently are just two more concurrent edits,
and they chase each other indefinitely. Fine for one person holding one device
at a time; a real hazard if this ever became multi-user.

## Build pipeline

One command builds both bundles:

```bash
make proto_all
```

Or either half on its own:

```bash
make proto_exe_win FOLDER='C:\Users\Nam\Dropbox\checklist'
make proto_android
make proto_clean
```

Neither installs a toolchain on this machine. The Windows target downloads an
official embeddable Python and stages it on the Windows side — no installer, no
pip, no admin rights — which is what the stdlib-only rule in `serve.py` buys.
The Android target does everything inside Docker.

No `.exe` is produced, deliberately: a shortcut to Microsoft's own signed
`pythonw.exe` raises no SmartScreen warning, an unsigned executable does. The
prototype is not copied to the Windows side either — the shortcut points at
`serve.py` where it already lives (over `\\wsl.localhost` under WSL), so there
is one copy of the code and git keeps working.

`android/Dockerfile` doubles as a Jenkins agent: the SDK licences are accepted
in the image rather than in someone's home directory, the Gradle daemon is off
so no state survives a run, and the container runs as the invoking user so
artifacts are not written to the workspace as root. A pipeline step is the same
`docker run` that `build.sh` already issues.

## Storage

### On the device

| Where          | Holds                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sync folder    | The shared state. Every device's copy is a full replica, so local-first is automatic — the app reads its own folder whether or not the internet exists |
| `localStorage` | The device id and label only (`proto.deviceId`, `proto.label`). Synchronous and ~5 MB — wrong for list data                                            |
| IndexedDB      | What the real app already uses via Dexie. For a prototype syncing one sentence it earns nothing, so this does not use it                               |

Note what the folder model removes: there is no outbox and no pending queue. An
offline edit is just a written file. The cloud client uploads it when it can,
and its retry logic is code you do not write, test or own.

### In the cloud

`list`, `read`, `write` on a folder is the whole requirement, so the provider
can be chosen on price or on which client is already installed. The one thing
worth measuring per provider is how aggressively its client uploads a small file
that changes often — that sets how long "a few seconds" actually is.

Android is the exception, and it is the weakest part of the design: it needs an
app that maintains a **genuine local folder**. The Dropbox, Drive and OneDrive
Android apps are on-demand browsers for cloud files and do not mirror a folder
onto the device the way their desktop clients do. Syncthing, FolderSync/Dropsync
and Nextcloud do.

## Browser interaction

This is the real constraint the prototype turned up, and it decides how the app
gets built.

| Browser                | `showDirectoryPicker` | How it reaches the folder                     |
| ---------------------- | --------------------- | --------------------------------------------- |
| Chrome / Edge desktop  | Yes                   | Either: pick in the page, or the local helper |
| **Firefox**            | **No, deliberately**  | The local helper (`--folder`)                 |
| **Safari**             | **No**                | The local helper (`--folder`)                 |
| Any browser on Android | No                    | Neither — and no local helper can run there   |

Mozilla objected to the File System Access API. Hence the two ways for setting the sync folder in Laptop.
