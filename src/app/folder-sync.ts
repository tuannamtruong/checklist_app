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
}

export class FolderSync {
  private readonly folder: FolderAdapter;
  private readonly device: DeviceId;
  private readonly events: FolderSyncEvents;
  private readonly held = new Map<DeviceId, readonly Op[]>();

  constructor(folder: FolderAdapter, device: DeviceId, events: FolderSyncEvents = {}) {
    this.folder = folder;
    this.device = device;
    this.events = events;
  }

  /** Every peer's ops, as the fold wants them. */
  get logs(): DeviceOps[] {
    return [...this.held].map(([device, ops]) => ({ device, ops }));
  }

  async cycle(): Promise<SyncResult> {
    let names: string[];
    try {
      names = await this.folder.list();
    } catch (error) {
      this.events.onError?.(error);
      return { peers: 0, skipped: [], changed: false };
    }

    const skipped: string[] = [];
    let peers = 0;
    let changed = false;

    for (const name of names) {
      const device = deviceOfFileName(name);
      if (device === null || device === this.device) continue;
      peers++;
      if (await this.readPeer(name, device, skipped)) changed = true;
    }

    return { peers, skipped, changed };
  }

  private async readPeer(name: string, device: DeviceId, skipped: string[]): Promise<boolean> {
    let text: string | null;
    try {
      text = await this.folder.read(name);
    } catch (error) {
      // A read that throws is the provider's client holding the file, not a bug
      // here. Next cycle, on the same terms as a file that half-arrived.
      this.events.onError?.(error);
      skipped.push(name);
      return false;
    }
    if (text === null) {
      skipped.push(name);
      return false;
    }

    const decoded = decodeLog(text);
    if (decoded === null) {
      skipped.push(name);
      return false;
    }
    if (decoded.skipped > 0) this.events.onSkipped?.(name, decoded.skipped);

    // The file only ever grows, so a read that came back with fewer of the
    // peer's own ops than are already held is a partial download wearing a
    // valid header. Keeping what we have is strictly safer than adopting it.
    const arrived = clockOf(decoded.ops)[device] ?? 0;
    const known = clockOf(this.held.get(device) ?? [])[device] ?? 0;
    if (arrived < known) {
      skipped.push(name);
      return false;
    }
    if (arrived === known) return false;

    this.held.set(device, decoded.ops);
    return true;
  }
}
