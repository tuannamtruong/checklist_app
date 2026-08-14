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
| Device-id      | A random generated on first run in a device and persisted in the meta table under key deviceId. Reset after "Clear site data" in DevTools.                                                                           |
| Snapshot       | `checklist.<device-id>.json` files inside the sync folder. Each file is a device's replica of the shared state; every device holds a full replica, which enables the app to work offline.                            |

## Synchronisation Logic

There are two parts to synchronize:

1. Files and directories in Sync Folder.
2. Application Content: Values shown in the app's presentation layer for the end user.

### 1. File and folder in Sync Folder

Each device **writes only its own one Snapshot file** in the Sync Folder, as long the device-id is unique,
it's impossible for race condition can happen for items inside Sync Folder.

The Sync Folder never tells a device that something happened. The files are quietly synchronized also when the app is
not running. Sync of content inside the folder will be handled by the cloud provider. The application has no logic for
this.

### 2. Application content synchronisation

#### 2.1. Snapshot

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
  "sClock": { "1111aaaa": 3, "2222bbbb": 1 },
  "updatedAt": "2026-08-12T10:14:00Z"
}
```

| Field     | Description                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| device    | A generated 8-hex-character id that names the replica file and never changes.                                                                                                                                                                                                                                                                                                                                                   |
| label     | The human name for a device, display only, carried inside the file and never in its name.                                                                                                                                                                                                                                                                                                                                       |
| author    | The device that produced the current text, which is not always the device that owns the file. A device that adopts a peer's text keeps that peer as `author`.                                                                                                                                                                                                                                                                   |
| updatedAt | A timestamp for when the text was last authored. `author` and `updatedAt` are one pair. <br> It is stamped by the author's device, not by the device that owns the file. <br>It does not effect the sync process.                                                                                                                                                                                                               |
| text      | Value of the text field, specific for the prototype.                                                                                                                                                                                                                                                                                                                                                                            |
| sClock    | **Version vector**. It has 2 directions. <br> One counter for recording the version of its own device: `"1111aaaa": 3`.<br> Other counter(s) is a receipt for what this device `1111aaaa` have read from other device `2222bbbb`: `"2222bbbb": 1`.<br>A device that has never appeared in the folder is simply absent from the vector and counts as `0`, so a third device joins with no registration step and no coordination. |

Change awareness is not received but derived. On every cycle a device reads the snapshots it finds and compares each
snapshot's `sClock` vector against its own.

**Only a device may increment its own counter.** Folding in a peer's edit joins the two vectors.

#### 2.2. Relation determination

Sync works by comparing two `sClock` against each other: `ours`, from this device's snapshot, and `peer`, from the
peer's snapshot.

`dominates(a, b)` answers if `a`'s counter is at least `b`'s. By calling it twice in both directions, the Relation between the two can be determinded.

| `dominates(peer, ours)` | `dominates(ours, peer)` | Relation    | Consequence       |
| ----------------------- | ----------------------- | ----------- | ----------------- |
| true                    | false                   | peer ahead  | Adopt peer's text |
| false                   | true                    | peer behind | Nothing           |
| true                    | true                    | equal       | Nothing           |
| false                   | false                   | concurrent  | Race condition    |

#### 2.3. Race condition handle

When race condition happens, any device awares of it can resolve by creating the most up-to-date application content. In turn, a **maximal set** is created
with dominating `sClock` values, that aheads all its `peer`.

The app doesn't prevent races, but detect them afterwards. The detection works by deriving the relation between version vectors of multiple snapshots.

#### 2.4. Maximal set

Every snapshot in the Sync Folder are handled all at once. In each sync cycle a device does two steps:

1. **Drop every ancestor.** A snapshot that another snapshot strictly dominates has already been folded into that other
   one, so it carries nothing new. What survives is the maximal set.
2. **Look at the texts that are left.**

| Maximal set after step 1   | Consequence                                                                   |
| -------------------------- | ----------------------------------------------------------------------------- |
| one snapshot               | Adopt its text                                                                |
| several, all the same text | Adopt it; the sClock is the join of all of them                               |
| several, different texts   | Race condition between exactly those snapshots, raise conflict inside the app |

#### 2.5. Sync between two devices

The `test/scenario.mjs` demonstrates all relation between two devices, which is shown in the next table.

Each cell contains one device's partial snapshot: application content, vector, author and updatedAt.
**Bold** marks what changed for that device since the last event.
`1111aaaa`: device-id of the laptop
`2222bbbb`: device-id of the phone

| Event                               | Laptop                                                                                                                          | Phone                                                                                                                           | Relation       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Start state                         | `"Water the plants"`<br>`{1111aaaa: 14, 2222bbbb: 2}`<br>by `1111aaaa` at `10:00Z`                                              | `"Water the plants"`<br>`{1111aaaa: 14, 2222bbbb: 2}`<br>by `1111aaaa` at `10:00Z`                                              | equal          |
| Laptop writes a new text            | **`"Buy milk"`**<br><code>{1111aaaa: <b>15</b>, 2222bbbb: 2}</code><br>by `1111aaaa` at **`10:01Z`**                            | `"Water the plants"`<br>`{1111aaaa: 14, 2222bbbb: 2}`<br>by `1111aaaa` at `10:00Z`                                              | laptop ahead   |
| Phone syncs and adopts it           | `"Buy milk"`<br>`{1111aaaa: 15, 2222bbbb: 2}`<br>by `1111aaaa` at `10:01Z`                                                      | **`"Buy milk"`**<br><code>{1111aaaa: <b>15</b>, 2222bbbb: 2}</code><br>by `1111aaaa` at **`10:01Z`**                            | equal          |
| Phone adds `" and eggs"`            | `"Buy milk"`<br>`{1111aaaa: 15, 2222bbbb: 2}`<br>by `1111aaaa` at `10:01Z`                                                      | <code>"Buy milk <b>and eggs</b>"</code><br><code>{1111aaaa: 15, 2222bbbb: <b>3</b>}</code><br>by **`2222bbbb`** at **`10:02Z`** | phone ahead    |
| Laptop syncs and adopts it          | <code>"Buy milk <b>and eggs</b>"</code><br><code>{1111aaaa: 15, 2222bbbb: <b>3</b>}</code><br>by **`2222bbbb`** at **`10:02Z`** | `"Buy milk and eggs"`<br>`{1111aaaa: 15, 2222bbbb: 3}`<br>by `2222bbbb` at `10:02Z`                                             | equal          |
| Laptop goes offline and update text | **`"Buy milk, eggs and bread"`**<br><code>{1111aaaa: <b>16</b>, 2222bbbb: 3}</code><br>by **`1111aaaa`** at **`10:03Z`**        | `"Buy milk and eggs"`<br>`{1111aaaa: 15, 2222bbbb: 3}`<br>by `2222bbbb` at `10:02Z`                                             | laptop ahead   |
| Phone rewrites the line meanwhile   | `"Buy milk, eggs and bread"`<br>`{1111aaaa: 16, 2222bbbb: 3}`<br>by `1111aaaa` at `10:03Z`                                      | **`"Buy oat milk"`**<br><code>{1111aaaa: 15, 2222bbbb: <b>4</b>}</code><br>by `2222bbbb` at **`10:04Z`**                        | **concurrent** |

Any device can resolve the race condition, for this example, it's the laptop.
In all 3 following cases, the laptop set the lastest version of the text, which increases the version vector. A maximal set is then created. The phone can now fast-forward for equal relation.

**A: the user keeps the laptop's text.**

| Event                          | Laptop                                                                                                                  | Phone                                                                                                                    | Relation     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------ |
| Laptop reconnects and resolves | `"Buy milk, eggs and bread"`<br><code>{1111aaaa: <b>17</b>, 2222bbbb: <b>4</b>}</code><br>by `1111aaaa` at **`10:05Z`** | `"Buy oat milk"`<br>`{1111aaaa: 15, 2222bbbb: 4}`<br>by `2222bbbb` at `10:04Z`                                           | laptop ahead |
| Phone syncs and fast-forwards  | `"Buy milk, eggs and bread"`<br>`{1111aaaa: 17, 2222bbbb: 4}`<br>by `1111aaaa` at `10:05Z`                              | **`"Buy milk, eggs and bread"`**<br><code>{1111aaaa: <b>17</b>, 2222bbbb: 4}</code><br>by **`1111aaaa`** at **`10:05Z`** | equal        |

**B: the user keeps the phone's text.**

| Event                          | Laptop                                                                                                          | Phone                                                                                                    | Relation     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------ |
| Laptop reconnects and resolves | **`"Buy oat milk"`**<br><code>{1111aaaa: <b>17</b>, 2222bbbb: <b>4</b>}</code><br>by `1111aaaa` at **`10:05Z`** | `"Buy oat milk"`<br>`{1111aaaa: 15, 2222bbbb: 4}`<br>by `2222bbbb` at `10:04Z`                           | laptop ahead |
| Phone syncs and fast-forwards  | `"Buy oat milk"`<br>`{1111aaaa: 17, 2222bbbb: 4}`<br>by `1111aaaa` at `10:05Z`                                  | `"Buy oat milk"`<br><code>{1111aaaa: <b>17</b>, 2222bbbb: 4}</code><br>by **`1111aaaa`** at **`10:05Z`** | equal        |

**C: the user combines them by hand.**

| Event                          | Laptop                                                                                                                                              | Phone                                                                                                                              | Relation     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Laptop reconnects and resolves | <code>"Buy milk, eggs<b>, bread and oat milk</b>"</code><br><code>{1111aaaa: <b>17</b>, 2222bbbb: <b>4</b>}</code><br>by `1111aaaa` at **`10:05Z`** | `"Buy oat milk"`<br>`{1111aaaa: 15, 2222bbbb: 4}`<br>by `2222bbbb` at `10:04Z`                                                     | laptop ahead |
| Phone syncs and fast-forwards  | `"Buy milk, eggs, bread and oat milk"`<br>`{1111aaaa: 17, 2222bbbb: 4}`<br>by `1111aaaa` at `10:05Z`                                                | **`"Buy milk, eggs, bread and oat milk"`**<br><code>{1111aaaa: <b>17</b>, 2222bbbb: 4}</code><br>by **`1111aaaa`** at **`10:05Z`** | equal        |

#### 2.6. Sync with more than 2 devices

There is **no**:

- different in code path compare to the sync of 2 devices
- count of total existing snapshots/devices
- leader, quorum, membership, vote

It's the same, any device may resolve a given conflict (§4). If there are `n` amount of devices with `n` race conditions happening.
It stills means, that with `1` edit will create a dominating `sClock`, the new maximal set solves the race condition in all devices.

##### Sync when a third device joins

- 1111aaaa: device-id of a laptop
- 2222bbbb: device-id of a phone
- 3333cccc: device-id of a tablet

| State               | Laptop                                                                                                                                     | Phone                                                                                      | Tablet                                                                                                                                     | Relation         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| Start state         | `"Buy milk, eggs and bread"`<br>`{1111aaaa: 17, 2222bbbb: 4}`<br>by `1111aaaa` at `10:05Z`                                                 | `"Buy milk, eggs and bread"`<br>`{1111aaaa: 17, 2222bbbb: 4}`<br>by `1111aaaa` at `10:05Z` | _no file yet_                                                                                                                              | all equal        |
| Tablet's first sync | `"Buy milk, eggs and bread"`<br>`{1111aaaa: 17, 2222bbbb: 4}`<br>by `1111aaaa` at `10:05Z`                                                 | `"Buy milk, eggs and bread"`<br>`{1111aaaa: 17, 2222bbbb: 4}`<br>by `1111aaaa` at `10:05Z` | **`"Buy milk, eggs and bread"`**<br>**`{1111aaaa: 17, 2222bbbb: 4}`**<br>by **`1111aaaa`** at **`10:05Z`**                                 | all equal        |
| Tablet adds `jam`   | `"Buy milk, eggs and bread"`<br>`{1111aaaa: 17, 2222bbbb: 4}`<br>by `1111aaaa` at `10:05Z`                                                 | `"Buy milk, eggs and bread"`<br>`{1111aaaa: 17, 2222bbbb: 4}`<br>by `1111aaaa` at `10:05Z` | **`"Buy milk, eggs, bread and jam"`**<br><code>{1111aaaa: 17, 2222bbbb: 4, <b>3333cccc: 1</b>}</code><br>by **`3333cccc`** at **`10:10Z`** | tablet ahead all |
| Laptop syncs        | **`"Buy milk, eggs, bread and jam"`**<br><code>{1111aaaa: 17, 2222bbbb: 4, <b>3333cccc: 1</b>}</code><br>by **`3333cccc`** at **`10:10Z`** | `"Buy milk, eggs and bread"`<br>`{1111aaaa: 17, 2222bbbb: 4}`<br>by `1111aaaa` at `10:05Z` | `"Buy milk, eggs, bread and jam"`<br>`{1111aaaa: 17, 2222bbbb: 4, 3333cccc: 1}`<br>by `3333cccc` at `10:10Z`                               | phone behind all |

##### Three devices, two racing

The phone has been offline since `10:05Z` and never saw the `jam` from the tablet.

| State                                                | Laptop                                                                                                                                             | Phone                                                                                                        | Tablet                                                                                                       | Relation                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Phone rewrites the <br>line while offline            | `"Buy milk, eggs, bread and jam"`<br>`{1111aaaa: 17, 2222bbbb: 4, 3333cccc: 1}`<br>by `3333cccc` at `10:10Z`                                       | **`"Buy oat milk"`**<br><code>{1111aaaa: 17, 2222bbbb: <b>5</b>}</code><br>by **`2222bbbb`** at **`10:12Z`** | `"Buy milk, eggs, bread and jam"`<br>`{1111aaaa: 17, 2222bbbb: 4, 3333cccc: 1}`<br>by `3333cccc` at `10:10Z` | phone **concurrent** with both                                            |
| Laptop adds `coffee`                                 | **`"Buy milk, eggs, bread, jam and coffee"`**<br><code>{1111aaaa: <b>18</b>, 2222bbbb: 4, 3333cccc: 1}</code><br>by **`1111aaaa`** at **`10:13Z`** | `"Buy oat milk"`<br>`{1111aaaa: 17, 2222bbbb: 5}`<br>by `2222bbbb` at `10:12Z`                               | `"Buy milk, eggs, bread and jam"`<br>`{1111aaaa: 17, 2222bbbb: 4, 3333cccc: 1}`<br>by `3333cccc` at `10:10Z` | laptop ahead of tablet, **concurrent** with phone                         |
| All devices upload their <br>snapshot to Sync Folder | `"Buy milk, eggs, bread, jam and coffee"`<br>`{1111aaaa: 18, 2222bbbb: 4, 3333cccc: 1}`<br>by `1111aaaa` at `10:13Z`                               | `"Buy oat milk"`<br>`{1111aaaa: 17, 2222bbbb: 5}`<br>by `2222bbbb` at `10:12Z`                               | `"Buy milk, eggs, bread and jam"`<br>`{1111aaaa: 17, 2222bbbb: 4, 3333cccc: 1}`<br>by `3333cccc` at `10:10Z` | Race condition in Laptop and Tablet. <br> All devices are awared of this. |

Three snapshots in Sync Folder and two of them race.

The same as 2 races in 2 devices: Any of the three devices can solve the concurrent for all devices by creating new maximal set.

Difference: **Only the text from a device that is in the race are compared.** Not every entry from all devices will be in merge resolution.
The conflict set is only between laptop and phone. The tablet's vector `{17, 4, 1}` is overtaken by the vector in Laptop `{18, 4, 1}`, so its text won't be a part of the merge resolution.

Besides this example, a third device can add a third side. If there are three devices race, then all three texts will be in the conflict resolution.

Similar logic to solving race condition in 2.5. Any device can pick a version of any device or making a combination of them all, which introduce a dominated version vector i.e. maximal set.
All devices can fast-forward then.

If the tablet takes both the content from laptop and phone.

| State                                  | Laptop                                                                                                                                                | Phone                                                                                                                                                 | Tablet                                                                                                                                                       | Relation         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| Tablet resolves                        | `"Buy milk, eggs, bread, jam and coffee"`<br>`{1111aaaa: 18, 2222bbbb: 4, 3333cccc: 1}`<br>by `1111aaaa` at `10:13Z`                                  | `"Buy oat milk"`<br>`{1111aaaa: 17, 2222bbbb: 5}`<br>by `2222bbbb` at `10:12Z`                                                                        | **`"Buy oat milk, eggs, bread and jam"`**<br><code>{1111aaaa: <b>18</b>, 2222bbbb: <b>5</b>, 3333cccc: <b>2</b>}</code><br>by **`3333cccc`** at **`10:15Z`** | tablet ahead all |
| Laptop and phone sync and fast-forward | **`"Buy oat milk, eggs, bread and jam"`**<br><code>{1111aaaa: 18, 2222bbbb: <b>5</b>, 3333cccc: <b>2</b>}</code><br>by **`3333cccc`** at **`10:15Z`** | **`"Buy oat milk, eggs, bread and jam"`**<br><code>{1111aaaa: <b>18</b>, 2222bbbb: 5, 3333cccc: <b>2</b>}</code><br>by **`3333cccc`** at **`10:15Z`** | `"Buy oat milk, eggs, bread and jam"`<br>`{1111aaaa: 18, 2222bbbb: 5, 3333cccc: 2}`<br>by `3333cccc` at `10:15Z`                                             | all equal        |

### 3. The sync cycle

`core/folder-sync.mjs` generic over the folder it is handed.

Every 3 s and on window focus, a full sync cycle starts:

- `list()` the folder
- `read()` every file (its own is skipped),
- `reconcile()` them against own snapshot (`core/merge.mjs`).
- Write own file back, if something happend during merge.

### 4. Race conditions

1. File and folder in Sync Folder
   There can be no race condition when writing file into the sync folder.
   If the snapshot file is synching by the cloud provider client, it won't be read.

2. Application content
   Only one device needs to resolve the conflict of application's data.
   When the race condition happens between 2 or more device, no quorum is needed to resolve.
   The version vector only detetects that a race condition has happened. There is no preventation method in the app.

When merge conflict, only content from concurrent devices are choosen. If the tablet's vector is `{17, 4, 1}` and the laptop's vector is `{18, 4, 1}`, then tablet's text won't be a part of the merge resolution.

Resolving conflict create a maximal set, so every devices can fast-forward to.

A resolution is itself an edit, so two devices resolving the same conflict independently are just two more concurrent edits

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

Neither installs a toolchain on this machine. The Windows target downloads an official embeddable Python and stages it
on the Windows side — no installer, no pip, no admin rights — which is what the stdlib-only rule in `serve.py` buys. The
Android target does everything inside Docker.

No `.exe` is produced, deliberately: a shortcut to Microsoft's own signed `pythonw.exe` raises no SmartScreen warning,
an unsigned executable does. The prototype is not copied to the Windows side either — the shortcut points at `serve.py`
where it already lives (over `\\wsl.localhost` under WSL), so there is one copy of the code and git keeps working.

`android/Dockerfile` doubles as a Jenkins agent: the SDK licences are accepted in the image rather than in someone's
home directory, the Gradle daemon is off so no state survives a run, and the container runs as the invoking user so
artifacts are not written to the workspace as root. A pipeline step is the same `docker run` that `build.sh` already
issues.

## Storage

### On the device

| Where          | Holds                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sync folder    | The shared state. Every device's copy is a full replica, so local-first is automatic — the app reads its own folder whether or not the internet exists |
| `localStorage` | The device id and label only (`proto.deviceId`, `proto.label`). Synchronous and ~5 MB — wrong for list data                                            |
| IndexedDB      | What the real app already uses via Dexie. For a prototype syncing one sentence it earns nothing, so this does not use it                               |

Note what the folder model removes: there is no outbox and no pending queue. An offline edit is just a written file. The
cloud client uploads it when it can, and its retry logic is code you do not write, test or own.

### In the cloud

`list`, `read`, `write` on a folder is the whole requirement, so the provider can be chosen on price or on which client
is already installed. The one thing worth measuring per provider is how aggressively its client uploads a small file
that changes often — that sets how long "a few seconds" actually is.

Android is the exception, and it is the weakest part of the design: it needs an app that maintains a **genuine local
folder**. The Dropbox, Drive and OneDrive Android apps are on-demand browsers for cloud files and do not mirror a folder
onto the device the way their desktop clients do. Syncthing, FolderSync/Dropsync and Nextcloud do.

## Browser interaction

This is the real constraint the prototype turned up, and it decides how the app gets built.

| Browser                | `showDirectoryPicker` | How it reaches the folder                     |
| ---------------------- | --------------------- | --------------------------------------------- |
| Chrome / Edge desktop  | Yes                   | Either: pick in the page, or the local helper |
| **Firefox**            | **No, deliberately**  | The local helper (`--folder`)                 |
| **Safari**             | **No**                | The local helper (`--folder`)                 |
| Any browser on Android | No                    | Neither — and no local helper can run there   |

Mozilla objected to the File System Access API. Hence the two ways for setting the sync folder in Laptop.
