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

**Laptop — any browser:**

```bash
npm run proto -- --folder ~/Dropbox/checklist
```

Open <http://localhost:5175> and type. The local helper hands the folder to the
page, so this works in Firefox, Safari, Chrome and Edge alike.

**Laptop — Chrome or Edge, picking the folder in the page:**

```bash
npm run proto          # no --folder
```

Then click **Choose folder…**. Same result; the folder is chosen in the browser
instead of on the command line.

`install/serve.py` binds to `127.0.0.1` and is not reachable from the network.
It is not a sync server — it is one device's own file bridge, and the other
device never touches it. Two devices can use different bridges, or none, and
sync identically, because the only shared thing is the folder.

**Python 3 stdlib only, no pip, ever.** That constraint is what lets the Windows
launcher stage an embeddable Python and run the app with no installer — the
approach `cooking_app` already proves. It also opens the browser for you, defers
to an instance that is already running rather than failing to bind, and stops on
`POST /api/quit`.

Its folder API is deliberately `RemoteStore`-shaped (`src/sync/remote-store.ts`)
— `list(prefix)` returning `FileMeta`, plus `read`/`write`/`remove` over nested
paths and bytes — rather than the three flat methods the prototype needs today.
`adapters/http-folder.mjs` shims between the two. Writing the helper to the
smaller interface would have bought a rewrite the moment the op log arrives.

**From a terminal, against a real folder** — the quickest way to convince
yourself before trusting any UI:

```bash
node prototype/install/cli.mjs ~/Dropbox/checklist laptop "Buy milk"
node prototype/install/cli.mjs ~/Dropbox/checklist laptop --watch
```

**The tests:**

```bash
npm run proto:test     # two devices, a simulated cloud client, headless
npm run proto:ui       # the browser shell (helper must be running)
npm run proto:bridge   # the any-browser path, against a real folder on disk
npm run proto:android  # the Android code path, with the Java bridge stubbed
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

## 4. Who can open a folder, and who cannot

This is the real constraint the prototype turned up, and it decides how the app
gets built.

| Browser                | `showDirectoryPicker` | How it reaches the folder                     |
| ---------------------- | --------------------- | --------------------------------------------- |
| Chrome / Edge desktop  | Yes                   | Either: pick in the page, or the local helper |
| **Firefox**            | **No, deliberately**  | The local helper (`--folder`)                 |
| **Safari**             | **No**                | The local helper (`--folder`)                 |
| Any browser on Android | No                    | Neither — and no local helper can run there   |

Firefox has not merely "not got round to" the File System Access API — Mozilla
objected to it, on the grounds that handing a web page a real folder on disk is
a lot of authority to grant from a page. That position is unlikely to move, so
depending on the API alone would have been a mistake regardless of Android.

Hence the two ways in. The picker is a convenience where it exists; the helper
is the portable path, and it is what an installed app would do anyway. Which one
a device uses is local and invisible to sync — `test/bridge.mjs` runs a browser
with `showDirectoryPicker` deleted, alongside a CLI device on the Node adapter,
in one folder, and asserts they converge.

Firefox does have OPFS (`navigator.storage.getDirectory()`), sometimes offered
as the answer here. It is not: OPFS is an origin-private sandbox no cloud client
can see, so nothing written there ever leaves the device.

### The phone is still the hard part

|                              | Laptop (Windows)                    | Phone (Android)                                               |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------------- |
| Folder access from a browser | Yes — picker, or the local helper   | **No.** No File System Access API, and no local helper either |
| What it needs                | The static app + a localhost helper | An installed app using Android's Storage Access Framework     |

So the laptop half is a browser app and works today. The phone half **cannot be
a plain web page** — a browser on Android cannot be granted a folder. It needs
an installed app that asks for the folder through SAF and hands it to the same
core.

That is exactly what you described, and it is the honest reading of the
constraint rather than a preference.

`core/` is pure and adapter-agnostic; `adapters/` holds five implementations of
the same three methods — Node fs, browser File System Access, the loopback
bridge, in-memory, and Android SAF. The Android app is the fifth, and it is the
only one that is a real application rather than a few lines of glue.

Note this contradicts _"PWA, not native"_ in `CLAUDE.md`. Folder sync on Android
is a genuine reason to revisit that decision — it should be revisited
deliberately, not by accident.

## 5. The Android app

`android/` is a real Android project producing a real APK. It is about 300 lines
of Java around the same web app the laptop runs:

| Piece                     | Job                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `MainActivity`            | A WebView, loading the bundled page over `https://appassets.androidplatform.net`                           |
| `MimeCorrectAssetHandler` | Serves `.mjs` as `text/javascript`. Without it every module is refused and the app boots to a blank screen |
| `FolderStore`             | Keeps the SAF grant across restarts, so the folder is picked once                                          |
| `FolderBridge`            | `list` / `read` / `write` exposed to the page as `window.AndroidFolder`                                    |

The web app is **not** copied into the Android project. A Gradle task pulls
`public/`, `core/` and `adapters/` from `prototype/` at build time, so there is
one copy of the sync core and the phone cannot drift from the laptop.

Two things worth noticing in the manifest:

- **No `INTERNET` permission.** The app cannot reach the network even in
  principle. It is not a sync client — it edits files in a folder you grant it.
- **No storage permission either.** SAF grants access to one folder you chose;
  there is no All Files Access and no permission prompt beyond the picker.

### Building it

```bash
cd prototype/android
./build.sh                 # -> out/checklist-sync.apk
```

Everything happens inside a container. The host needs Docker and nothing else —
no JDK, no Android SDK, no Gradle. The first run builds the image (~2.4 GB,
several minutes); after that only the APK is rebuilt. `./build.sh clean` removes
the build output and the Gradle cache.

Copy the APK to the phone and open it. Android will ask once for permission to
install from that source.

### On the phone

Start the app, tap **Choose folder…**, and pick the folder your sync app keeps.
That is the one real constraint: **Android needs an app that maintains a genuine
local folder.** The Dropbox, Drive and OneDrive Android apps are on-demand
browsers for cloud files — they do not mirror a folder onto the device the way
their desktop clients do. What works:

| Approach                      | Notes                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Syncthing**                 | Syncs a real folder, no cloud account, direct between devices. Best fit                                                                                                                     |
| **FolderSync** / **Dropsync** | Mirrors a local folder to Dropbox/Drive/OneDrive on a schedule                                                                                                                              |
| **Nextcloud**                 | Its Android app can auto-sync folders                                                                                                                                                       |
| A provider's SAF location     | The picker shows any DocumentsProvider on the phone, so a cloud folder can be selected directly — but then reads and writes go over the network on demand, and behaviour varies by provider |

This is the part of the design that is weakest on Android, and it is worth
knowing before building anything larger on it.

## 6. Jenkins later

The image is the agent, and the build is one `docker run`. A pipeline step is
the same command `build.sh` already issues:

```groovy
pipeline {
    agent any
    stages {
        stage('APK') {
            steps {
                dir('prototype/android') {
                    sh 'docker build -t checklist-android-builder .'
                    sh '''docker run --rm \
                        -u $(id -u):$(id -g) \
                        -v $WORKSPACE/prototype:/workspace \
                        -v $WORKSPACE/.gradle-cache:/gradle-home \
                        -e GRADLE_USER_HOME=/gradle-home \
                        -e ANDROID_USER_HOME=/gradle-home/.android \
                        -e HOME=/gradle-home \
                        -w /workspace/android \
                        checklist-android-builder \
                        gradle --no-daemon assembleDebug'''
                }
            }
        }
    }
    post {
        success {
            archiveArtifacts 'prototype/android/app/build/outputs/apk/debug/*.apk'
        }
    }
}
```

Four things were done with this in mind: the SDK licences are accepted in the
`Dockerfile` rather than in someone's home directory, the daemon is off so no
state survives between runs, `GRADLE_USER_HOME` is a mounted volume so a cache
can be kept without baking it into the image, and the container runs as the
invoking user so artifacts are not written to the workspace as root.

`HOME` has to be set explicitly: running as a UID with no home directory in the
image makes the Android Gradle plugin try to write `/.android` during
configuration, and it fails the build rather than degrading.

A release build would additionally need a signing key, which should come from
Jenkins credentials and never from the repository.

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

### The Android app specifically

`npm run proto:android` drives the real `adapters/android-folder.mjs` and the
real startup branch in `app.js`, with the Java bridge replaced by a synchronous
in-page stub of the same shape. It asserts the app boots without a picker, never
probes the loopback helper, writes valid snapshots through the bridge, picks up a
laptop's file, raises a conflict on a concurrent one, writes nothing while it is
open, and calls the _system_ picker on first run. 18 checks.

The APK itself was verified by inspection, not by running it: package
`dev.checklist.proto`, minSdk 24 / target 34, launcher activity present, all
eleven web assets bundled, and `aapt2 dump permissions` returns **nothing at
all** — the no-network claim is confirmed rather than asserted.

**Not verified: every line of Java, and the MIME handling.** There is no
accelerated emulator available here (`/dev/kvm` exists but the build user is not
in the `kvm` group), so nothing has executed on an Android runtime. The most
likely failure on first launch is a blank screen, which would mean
`MimeCorrectAssetHandler` is not doing its job and the module scripts are being
refused. `adb logcat | grep -i chromium` will say so plainly.

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
