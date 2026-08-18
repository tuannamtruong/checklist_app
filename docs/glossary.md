# Glossary

| Term | Definition |
| --- | --- |
| Device id | Eight hex characters, generated on a device's first run and never typed by the user. It names the file that device writes. It lives in `localStorage`, so it is per-origin: one machine reached through two origins is two devices. "Clear site data" in Browser resets it. |
| Folder adapter | Exactly three methods: `list()`, `read(name)`, `write(name, content)`. The only route from the logic layer to storage. |
| Local Folder | The folder on the device's own storage. The cloud provider's client mirrors its contents to the Sync Folder. The application reads and writes here. |
| Sync Folder | The one shared folder in the cloud provider's directory holding all of the application's state. No device writes to it directly. |
| Snapshot | A device's full replica of the shared state inside Local Folder, which syncs to Sync Folder. (TBD name convention) |
| Maximal set | The snapshots in the folder that no other snapshot strictly dominate. |
| Tombstone | A record that a node was deleted, retained rather than removed so that deletion stays distinguishable from absence. Deleting a node tombstones its whole subtree. |
| UI test mode | `?uitest` in the URL, or the button on the setup screen. Swaps in the in-memory adapter: no disk, no network. Reachable only by explicit opt-in. (TBD real implementation) |
| Version vector (`sClock`) | A map of device id to counter, carried by every snapshot. Comparing two vectors both ways classifies the relation between two devices: ahead, behind, equal or concurrent. |
| Windows bundle | An official embeddable Python staged on the Windows side plus a desktop shortcut to `pythonw.exe`. No `.exe` is produced deliberately, as a shortcut to Microsoft's own signed binary raises no SmartScreen warning: [architecture.md §7.1 The two Windows bundles](architecture.md#71-the-two-windows-bundles). |