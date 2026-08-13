# Prototype

Prototype for syncing one single text field in a web application across multiple devices.

The goal of the prototype to solves these questions:

1. How synchronisation between a windows 11 laptop and an android smartphone work?
2. How to handle race-condition?
3. What storage does it need on these devices?
4. Which browser can host the app?

The design contains **no**: database engine, API, OAuth, account, network code. The app reads and writes files in an
folder, that resides in a Cloud Provider. The client of the Cloud Provider is needed to be installed for synchronisation
of multiple devices.

Which cloud provider should makes no differences. The app needs three operations: `list`, `read`, `write`. Every
provider grants those by just being a folder.


## Setup

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

All dependencies to build the APK are in Docker container: JDK, Android SDK, Gradle. The first run builds the image
(~2.4 GB), after that only the APK is rebuilt.

```bash
make proto_android
```

Gradle task pulls `public/`, `core/` and `adapters/` from `prototype/` at build time, so there is one copy of the sync
core and the phone cannot drift from the laptop.

### Running

The webapp will be located in `http://localhost:38531/`

Picking the folder in the page (if not specified during install): click **Choose folder…**.

On Android there is no localhost and no picker in the page: the app boots straight to **Choose folder…**, which opens
the _system_ picker (Storage Access Framework). The grant is kept across restarts, so the folder is picked once.


## Glossary

| Term           | Definition                                                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sync folder    | A specific shared folder in the cloud provider directory, which contains all items of the application.                                                                                                               |
| Windows bundle | An official embeddable Python staged on the Windows side plus a desktop shortcut to `pythonw.exe`. No `.exe` is produced deliberately, as a shortcut to Microsoft's own signed binary raises no SmartScreen warning. |
| Demo mode      | `?demo` in the URL, running the app against an in-memory folder with no disk and no network.                                                                                                                         |
| Device-id       | A random generated on first run in a device and persisted in the meta table under key deviceId. Reset after "Clear site data" in DevTools.|
| Snapshot       | `checklist.<device-id>.json` files inside the sync folder. Each file is a device's replica of the shared state; every device holds a full replica, which enables the app to work offline.                            |


In this document:
- 1111aaaa: device-id of a laptop
- 2222bbbb: device-id of a phone

## Snapshot

The synced folder has no locking or conditional write. Each device writes a distinct snapshot `checklist.<device-id>.json`, that describes its state to the sync folder.

```
Sync-Folder/
  checklist.1111aaaa.json     <- only the laptop ever writes this
  checklist.2222bbbb.json     <- only the phone ever writes this
```

Each device **writes one Snapshot** (specific for its own device) and reads all Snapshots in Sync Folder. No concurrent write of Snapshot can happens.

Snapshot content

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

| Field     | Description                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| device    | A generated 8-hex-character id that names the replica file and never changes.                                                                                                                                                                                                                                                                                                                                               |
| label     | The human name for a device, display only, carried inside the file and never in its name.                                                                                                                                                                                                                                                                                                                                   |
| author    | The device that produced the current text, which is not always the device that owns the file. A device that adopts a peer's text keeps that peer as `author`.                                                                                                                                                                                                                                                               |
| updatedAt | A timestamp for when the text was last authored. `author` and `updatedAt` are one pair. <br> It is stamped by the author's device, not by the device that owns the file. <br>It does not effect the sync process.                                                                                                                                                                                                           |
| text      | Value of the text field, specific for the prototype.                                                                                                                                                                                                                                                                                                                                                                        |
| clock     | Version vector. It has 2 directions. <br> One counter for recording the version of its own device: `"1111aaaa": 3`.<br> Other counter(s) is a receipt for what this device `1111aaaa` have read from other device `2222bbbb`: `"2222bbbb": 1`.<br>A device that has never appeared in the folder is simply absent from the vector and counts as `0`, so a third device joins with no registration step and no coordination. |


Change awareness is not received but derived. On every cycle a device reads the snapshots it finds and compares each
snapshot's `clock` vector against its own.

**Only a device may increment its own counter.** Folding in a peer's edit joins the two vectors.

## Synchronisation Logic

There are two parts of synchronisation:
1. Files and directories in Sync Folder.
2. Application Content: Values shown in the app's presentation layer for the end user.

### 1. File and folder in Sync Folder

Each device **writes only its own one Snapshot file** in the Sync Folder, as long the device-id is unique,
it's impossible for race condition can happen for items inside Sync Folder.

The Sync Folder never tells a device that something happened. The files are quietly synchronized also when the app is
not running. Sync of content inside the folder will be handled by the cloud provider. The application has no logic for
this.

Consider:
`1111aaaa`: device-id of the laptop
`2222bbbb`: device-id of the phone

### 2. Application content synchronisation 
#### 2.1. Application content synchronisation between a pair of devices

Comparing two vectors solves:

| Relation to our clock | `dominates(peer, ours)` | `dominates(ours, peer)` | Consequence                                   |
| --------------------- | ----------------------- | ----------------------- | --------------------------------------------- |
| peer ahead            | true                    | false                   | Adopt peer's text                             |
| peer behind           | false                   | true                    | Nothing to do                                 |
| equal                 | true                    | true                    | Nothing to do                                 |
| concurrent            | false                   | false                   | Race condition, raise conflict inside the app |

Consider this race condition scenario in `test/scenario.mjs`:

Each cell is one device's whole snapshot: the text, the clock, then `author` and `updatedAt` (abbreviated to the time of
day). **Bold** marks what changed for that device since the row above — and in A, B and C, since the last row of this
table. Note that `author` and `updatedAt` travel **with the text**, not with the file — a device that adopts a peer's
text copies both unchanged, so they record when the text was authored and by whom, never when this device last wrote its
own file.

| Step                                | Laptop                                                                                                                          | Phone                                                                                                                           | Relation       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Start state                         | `"Water the plants"`<br>`{1111aaaa: 14, 2222bbbb: 2}`<br>by `1111aaaa` at `10:00Z`                                              | `"Water the plants"`<br>`{1111aaaa: 14, 2222bbbb: 2}`<br>by `1111aaaa` at `10:00Z`                                              | equal          |
| Laptop writes a new text            | **`"Buy milk"`**<br><code>{1111aaaa: <b>15</b>, 2222bbbb: 2}</code><br>by `1111aaaa` at **`10:01Z`**                            | `"Water the plants"`<br>`{1111aaaa: 14, 2222bbbb: 2}`<br>by `1111aaaa` at `10:00Z`                                              | laptop ahead   |
| Phone syncs and adopts it           | `"Buy milk"`<br>`{1111aaaa: 15, 2222bbbb: 2}`<br>by `1111aaaa` at `10:01Z`                                                      | **`"Buy milk"`**<br><code>{1111aaaa: <b>15</b>, 2222bbbb: 2}</code><br>by `1111aaaa` at **`10:01Z`**                            | equal          |
| Phone adds `" and eggs"`            | `"Buy milk"`<br>`{1111aaaa: 15, 2222bbbb: 2}`<br>by `1111aaaa` at `10:01Z`                                                      | <code>"Buy milk <b>and eggs</b>"</code><br><code>{1111aaaa: 15, 2222bbbb: <b>3</b>}</code><br>by **`2222bbbb`** at **`10:02Z`** | phone ahead    |
| Laptop syncs and adopts it          | <code>"Buy milk <b>and eggs</b>"</code><br><code>{1111aaaa: 15, 2222bbbb: <b>3</b>}</code><br>by **`2222bbbb`** at **`10:02Z`** | `"Buy milk and eggs"`<br>`{1111aaaa: 15, 2222bbbb: 3}`<br>by `2222bbbb` at `10:02Z`                                             | equal          |
| Laptop goes offline and update text | **`"Buy milk, eggs and bread"`**<br><code>{1111aaaa: <b>16</b>, 2222bbbb: 3}</code><br>by **`1111aaaa`** at **`10:03Z`**        | `"Buy milk and eggs"`<br>`{1111aaaa: 15, 2222bbbb: 3}`<br>by `2222bbbb` at `10:02Z`                                             | laptop ahead   |
| Phone rewrites the line meanwhile   | `"Buy milk, eggs and bread"`<br>`{1111aaaa: 16, 2222bbbb: 3}`<br>by `1111aaaa` at `10:03Z`                                      | **`"Buy oat milk"`**<br><code>{1111aaaa: 15, 2222bbbb: <b>4</b>}</code><br>by `2222bbbb` at **`10:04Z`**                        | **concurrent** |

Rows 3 and 5 are the ones to read twice: the adopting device rewrites its own file, yet keeps the peer's `author` and
`updatedAt`. The clock is what moves.

The race condition happens in Laptop, and the resolution needs to be handled by Laptop side.

**A: the user keeps the laptop's text.**

| Step                           | Laptop                                                                                                                  | Phone                                                                                                                    | Relation     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------ |
| Laptop reconnects and resolves | `"Buy milk, eggs and bread"`<br><code>{1111aaaa: <b>17</b>, 2222bbbb: <b>4</b>}</code><br>by `1111aaaa` at **`10:05Z`** | `"Buy oat milk"`<br>`{1111aaaa: 15, 2222bbbb: 4}`<br>by `2222bbbb` at `10:04Z`                                           | laptop ahead |
| Phone syncs and fast-forwards  | `"Buy milk, eggs and bread"`<br>`{1111aaaa: 17, 2222bbbb: 4}`<br>by `1111aaaa` at `10:05Z`                              | **`"Buy milk, eggs and bread"`**<br><code>{1111aaaa: <b>17</b>, 2222bbbb: 4}</code><br>by **`1111aaaa`** at **`10:05Z`** | equal        |

The laptop's text did not change — it resolved onto what it already had. Only the clock moved, and that is what
makes the phone fast-forward.

**B: the user keeps the phone's text.**

| Step                           | Laptop                                                                                                          | Phone                                                                                                    | Relation     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------ |
| Laptop reconnects and resolves | **`"Buy oat milk"`**<br><code>{1111aaaa: <b>17</b>, 2222bbbb: <b>4</b>}</code><br>by `1111aaaa` at **`10:05Z`** | `"Buy oat milk"`<br>`{1111aaaa: 15, 2222bbbb: 4}`<br>by `2222bbbb` at `10:04Z`                           | laptop ahead |
| Phone syncs and fast-forwards  | `"Buy oat milk"`<br>`{1111aaaa: 17, 2222bbbb: 4}`<br>by `1111aaaa` at `10:05Z`                                  | `"Buy oat milk"`<br><code>{1111aaaa: <b>17</b>, 2222bbbb: 4}</code><br>by **`1111aaaa`** at **`10:05Z`** | equal        |

Case B is the one that surprises: the phone's _text_ wins, but the laptop is the `author` — resolving is itself an edit,
and the laptop is the device that made it. `author` names who produced the snapshot's current text, not who first
thought of the wording. On the last row the phone's text is the only thing that does _not_ change.

**C: the user combines them by hand.**

| Step                           | Laptop                                                                                                                                              | Phone                                                                                                                              | Relation     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Laptop reconnects and resolves | <code>"Buy milk, eggs<b>, bread and oat milk</b>"</code><br><code>{1111aaaa: <b>17</b>, 2222bbbb: <b>4</b>}</code><br>by `1111aaaa` at **`10:05Z`** | `"Buy oat milk"`<br>`{1111aaaa: 15, 2222bbbb: 4}`<br>by `2222bbbb` at `10:04Z`                                                     | laptop ahead |
| Phone syncs and fast-forwards  | `"Buy milk, eggs, bread and oat milk"`<br>`{1111aaaa: 17, 2222bbbb: 4}`<br>by `1111aaaa` at `10:05Z`                                                | **`"Buy milk, eggs, bread and oat milk"`**<br><code>{1111aaaa: <b>17</b>, 2222bbbb: 4}</code><br>by **`1111aaaa`** at **`10:05Z`** | equal        |

#### 2.2 Application content between more than 2 devices


### 3. The sync cycle

`core/folder-sync.mjs` generic over the folder it is handed.

Every 3 s and on window focus, a full sync cycle starts:

- `list()` the folder
- `read()` every file (its own is skipped),
- `reconcile()` them against own snapshot (`core/merge.mjs`).
- Write own file back, if something happend during merge.

### 4. Race conditions

Two of them, at different layers.

**A half-written file.** The cloud client may be mid-download when we list the folder. A file that does not parse is
skipped and picked up whole on the next cycle; our own writes go through write-then-rename (`adapters/node-folder.mjs`,
`install/serve.py`) so no client ever observes a partial file of ours.

**Two devices edited without seeing each other.** Detecting this is what the vector above is for; what follows is what
the app does once it has.

On a concurrent pair the device holds its own text and shows both sides. **Nothing is written to the folder while a
conflict is open**, so the other device never learns there was one — the conflict is local and stays local.

Resolving joins every racing clock and then bumps our own, producing a version that strictly dominates all of them. The
other device sees a snapshot newer than everything it knows and fast-forwards to it: no second conflict, no ping-pong.

**Only one device may resolve.** A resolution is itself an edit, so two devices resolving the same conflict
independently are just two more concurrent edits, and they chase each other indefinitely. Fine for one person holding
one device at a time; a real hazard if this ever became multi-user.

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
