# Glossary

| Term | Definition |
| --- | --- |
| Device id | Eight hex characters, generated on a device's first run and never typed by the user. It names the file that device writes. It lives in `localStorage`, so it is per-origin: one machine reached through two origins is two devices. "Clear site data" in Browser resets it. |
| Folder adapter | Exactly three methods: `list()`, `read(name)`, `write(name, content)`. The only route from the logic layer to storage. |
| Local Folder | The folder on the device's own storage. The cloud provider's client mirrors its contents to the Sync Folder. The application reads and writes here. |
| Sync Folder | The one shared folder in the cloud provider's directory holding all of the application's state. No device writes to it directly. |
| Device file | What one device writes into Local Folder, named with its own device id: `checklist.<device-id>.ops.jsonl`. |
| Op log | A type of device file. It contains the full sClock as header. Body: each line contains an operation done in a device. |
| Snapshot | A full serialisation of the tree at one moment. |
| Replica | Combination of one device's snapshot and op log. <br> Fold of every device's replica represent the application state. |
| Maximal set | The device files in the folder that no other device file strictly dominates. |
| Tombstone | A record that a node was deleted, retained rather than removed so that deletion stays distinguishable from absence. Deleting a node tombstones its whole subtree. |
| Compaction | A device rewriting **its own** device file with the ops that a later op of its own has not already overwritten. The fold of what is left is identical to the fold of what it replaced, so it needs no agreement with any peer — [sync-flow.md §4.8 The compaction cut](sync-flow.md#48-the-compaction-cut). Never touches a peer's file, and never lowers this device's top counter. |
| Restore | The op that reverses a `delete`, clearing one node's own tombstone. An inherited tombstone is not its to clear, so restoring the top of a deleted run brings the whole subtree back — [sync-flow.md §4.9 The restore op](sync-flow.md#49-the-restore-op). |
| Device name | What a device calls itself, carried in the header line of the file it already writes. One writer per file means one writer per name, so names need no merge rule at all — and a device can only be renamed from itself. |
| UI test mode | `?uitest` in the URL. Swaps in the in-memory adapter: no disk, no network. Reachable only by explicit opt-in, because a folder that forgets everything on reload is a bug anywhere else — `src/app/folder-choice.ts`. |
| Receipt | One peer's counter inside a device's own vector: how far this device has read that peer's file. It is earned only from that peer's own file, never copied out of a third device's header — [sync-flow.md §4.2 B — Append-only op log per device](sync-flow.md#42-b--append-only-op-log-per-device). |
| Sync cycle | One pass over the folder: list it, read every peer's file, re-fold, and write our own back if anything changed. Driven by activity rather than a timer — `src/app/folder-sync.ts`, `src/app/sync-cadence.ts`. |
| Version vector (`sClock`) | A map of device id to counter, carried by every device file. Comparing two vectors both ways classifies the relation between two devices: ahead, behind, equal or concurrent. |
| Windows bundle | An official embeddable Python staged on the Windows side plus a desktop shortcut to `pythonw.exe`. No `.exe` is produced deliberately, as a shortcut to Microsoft's own signed binary raises no SmartScreen warning: [architecture.md §7.1 The two Windows bundles](architecture.md#71-the-two-windows-bundles). |