// One pass over the folder: list it, read every peer's file, keep what is new
// — sync-flow.md §4.7.
//
// It reads peers and never writes one. The file this device writes belongs to
// `DeviceLog`, which is the only thing that spells its own name, and that split
// is the one-writer-per-file rule (S-3) made structural rather than remembered.
//
// Nothing here folds or resolves. This object's whole job is deciding which
// bytes in the folder are worth believing; what they mean is core/merge.ts's.

import type { DeviceOps } from '../core/merge';
import type { DeviceHeader } from '../core/devices';
import type { FolderAdapter } from '../core/folder';
import { clockOf, decodeLog, deviceOfFileName } from '../core/op-log';
import type { DeviceId, Op } from '../core/types';

export interface FolderSyncEvents {
  onError?: (error: unknown) => void;
  /** Lines inside a peer's file that did not parse — one op lost, not a file. */
  onSkipped?: (name: string, lines: number) => void;
}

export interface SyncResult {
  /** Peer files seen in the folder this cycle, ours excluded. */
  peers: number;
  /** Files that could not be believed this cycle and will be re-read next — S-7. */
  skipped: string[];
  /** True when a peer brought ops this device did not have. */
  changed: boolean;
  /**
   * True when a peer's header moved without its ops doing — a rename (D-1) or a
   * fresh `lastSeen` (D-2). It changes what the device list shows and nothing
   * the merge reads, which is the distinction D-3 asks for.
   */
  described: boolean;
}

export class FolderSync {
  private readonly folder: FolderAdapter;
  private readonly device: DeviceId;
  private readonly events: FolderSyncEvents;
  private readonly held = new Map<DeviceId, readonly Op[]>();
  /** D-1 and D-2's advisory fields, kept beside the ops they arrived with. */
  private readonly headers = new Map<DeviceId, DeviceHeader>();
  /** What each peer's file cost, which is the S-14 trigger's other input. */
  private readonly sizes = new Map<DeviceId, number>();

  constructor(folder: FolderAdapter, device: DeviceId, events: FolderSyncEvents = {}) {
    this.folder = folder;
    this.device = device;
    this.events = events;
  }

  /** Every peer's ops, as the fold wants them. */
  get logs(): DeviceOps[] {
    return [...this.held].map(([device, ops]) => ({ device, ops }));
  }

  /** Every peer's header, for the device list — never for the merge, per D-3. */
  get peerHeaders(): DeviceHeader[] {
    return [...this.headers.values()];
  }

  /** Bytes every peer's file costs, summed — sync-flow.md §4.8.3. */
  get peerBytes(): number {
    let total = 0;
    for (const size of this.sizes.values()) total += size;
    return total;
  }

  async cycle(): Promise<SyncResult> {
    let names: string[];
    try {
      names = await this.folder.list();
    } catch (error) {
      this.events.onError?.(error);
      return { peers: 0, skipped: [], changed: false, described: false };
    }

    const skipped: string[] = [];
    let peers = 0;
    let changed = false;
    let described = false;

    for (const name of names) {
      const device = deviceOfFileName(name);
      if (device === null || device === this.device) continue;
      peers++;
      const read = await this.readPeer(name, device, skipped);
      if (read.changed) changed = true;
      if (read.described) described = true;
    }

    return { peers, skipped, changed, described };
  }

  private async readPeer(
    name: string,
    device: DeviceId,
    skipped: string[],
  ): Promise<{ changed: boolean; described: boolean }> {
    const nothing = { changed: false, described: false };
    let text: string | null;
    try {
      text = await this.folder.read(name);
    } catch (error) {
      // A read that throws is the provider's client holding the file, not a bug
      // here. Next cycle, on the same terms as a file that half-arrived.
      this.events.onError?.(error);
      skipped.push(name);
      return nothing;
    }
    if (text === null) {
      skipped.push(name);
      return nothing;
    }

    const decoded = decodeLog(text);
    if (decoded === null) {
      skipped.push(name);
      return nothing;
    }
    if (decoded.skipped > 0) this.events.onSkipped?.(name, decoded.skipped);

    // The file only ever grows, so a read that came back with fewer of the
    // peer's own ops than are already held is a partial download wearing a
    // valid header. Keeping what we have is strictly safer than adopting it.
    // S-14 makes this check load-bearing in a way M2 did not need. A peer that
    // compacted holds *fewer lines* than before while its top counter is
    // unchanged, which is exactly why sync-flow.md §4.8.2 forbids compaction
    // from lowering that counter — the comparison is counters, never lines.
    const arrived = clockOf(decoded.ops)[device] ?? 0;
    const known = clockOf(this.held.get(device) ?? [])[device] ?? 0;
    if (arrived < known) {
      skipped.push(name);
      return nothing;
    }

    const before = this.headers.get(device);
    // Built field by field rather than from `undefined`s: a file M2 wrote
    // carries neither, and "absent" is the state D-1 and D-2 both start in.
    const header: DeviceHeader = { dev: device };
    if (decoded.header.name !== undefined) header.name = decoded.header.name;
    if (decoded.header.at !== undefined) header.at = decoded.header.at;
    this.headers.set(device, header);
    this.sizes.set(device, text.length);
    // A peer seen for the first time is news to the device list even when it
    // has named itself nothing — D-1's list is "who is in this folder" before
    // it is "what are they called".
    const described =
      before === undefined || before.name !== header.name || before.at !== header.at;

    if (arrived === known) return { changed: false, described };

    this.held.set(device, decoded.ops);
    return { changed: true, described };
  }
}
