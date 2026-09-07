// This device's op log: the one write path every mutation goes through — S-1.
//
// The adapter has no append, so a write is the whole file: the header line
// carrying the vector, then every op this device has ever written. Writes are
// therefore debounced and serialised — a burst of typing must not turn into a
// burst of whole-file writes, and two writes must never be in flight at once,
// or the shorter one can land last.

import { compactOps } from '../core/compact';
import { receiptDelta } from '../core/merge';
import {
  cleanDeviceName,
  clockOf,
  decodeLog,
  deviceFileName,
  encodeLog,
  LOG_VERSION,
} from '../core/op-log';
import { dominates, join } from '../core/sclock';
import type { FolderAdapter } from '../core/folder';
import type { DeviceId, Op, SClock } from '../core/types';

/** Long enough to swallow a burst of keystrokes, short enough to survive a tab close. */
const WRITE_DEBOUNCE_MS = 250;

export interface DeviceLogEvents {
  onError?: (error: unknown) => void;
  /** Lines the folder held that could not be read as ops — worth telling someone. */
  onSkipped?: (count: number) => void;
}

export class DeviceLog {
  readonly device: DeviceId;
  private readonly folder: FolderAdapter;
  private readonly events: DeviceLogEvents;
  private entries: Op[] = [];
  private counter = 0;
  /** Peers' counters this device has folded in — sync-flow.md §4.2. */
  private receipts: SClock = {};
  /** The receipts as of the last op appended, so `seen` can carry only the delta. */
  private receipted: SClock = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private pending = false;
  /** D-1. What this device calls itself, as its own header line carries it. */
  private label = '';
  /** The bytes this file last cost, which is what the S-14 trigger weighs. */
  private bytes = 0;

  private constructor(folder: FolderAdapter, device: DeviceId, events: DeviceLogEvents) {
    this.folder = folder;
    this.device = device;
    this.events = events;
  }

  /**
   * Reads this device's own file, and only ever this one. Every other file in
   * the folder is a peer's and belongs to `FolderSync`, which reads them and
   * never writes one — the one-writer-per-file rule, S-3.
   */
  static async open(
    folder: FolderAdapter,
    device: DeviceId,
    events: DeviceLogEvents = {},
  ): Promise<{ log: DeviceLog; ops: readonly Op[] }> {
    const log = new DeviceLog(folder, device, events);
    try {
      const text = await folder.read(deviceFileName(device));
      const decoded = text === null ? null : decodeLog(text);
      if (decoded !== null) {
        log.entries = decoded.ops;
        log.counter = clockOf(decoded.ops)[device] ?? 0;
        log.label = decoded.header.name ?? '';
        log.bytes = text?.length ?? 0;
        // Our own receipts, as we last wrote them. Reloading without them would
        // make every peer edit already folded in look new again on the next
        // write, and every one of our ops would carry a `seen` for it.
        const peers: Record<DeviceId, number> = { ...decoded.header.clock };
        delete peers[device];
        log.receipts = peers;
        log.receipted = peers;
        if (decoded.skipped > 0) events.onSkipped?.(decoded.skipped);
      } else if (text !== null) {
        // A file that does not parse is skipped whole and picked up next cycle
        // — S-7. Here there is no next cycle and no peer to recover from, so
        // say so rather than silently starting from an empty tree.
        events.onError?.(
          new Error(`device ${device}: ${deviceFileName(device)} did not parse as an op log`),
        );
      }
    } catch (error) {
      events.onError?.(error);
    }
    return { log, ops: log.entries };
  }

  /** Every op this device has ever written, in the order it wrote them. */
  get ops(): readonly Op[] {
    return this.entries;
  }

  /** What this file cost on disk the last time it was written or read. */
  get byteLength(): number {
    return this.bytes;
  }

  /**
   * D-4. The vector this file's header carries — this device's own counter
   * joined with every receipt it has recorded. Derived here rather than held,
   * because `flush` derives the same line the same way, and two spellings of one
   * header is how a display and a file drift apart.
   */
  get clock(): SClock {
    return join(clockOf(this.entries), this.receipts);
  }

  /** D-1. Empty until somebody names this device on this device. */
  get name(): string {
    return this.label;
  }

  /**
   * D-1. A device names only itself, so this writes the header of the one file
   * this device owns and no op at all — the name is not tree data and has no
   * merge rule, because there is exactly one writer of it.
   */
  rename(name: string): void {
    const cleaned = cleanDeviceName(name);
    if (cleaned === this.label) return;
    this.label = cleaned;
    this.schedule();
  }

  /**
   * S-14. Drops this device's superseded ops and rewrites its own file —
   * sync-flow.md §4.8. Answers whether anything was actually dropped, so a
   * caller can leave the trigger alone rather than rewriting the file to say
   * that nothing changed.
   */
  compact(): boolean {
    const compacted = compactOps(this.entries);
    // By size rather than by count: a `set` that carried two fields and keeps
    // one is retained and still shrinks the file. Stringifying twice is
    // affordable because this runs when the trigger fires, not per write.
    if (JSON.stringify(compacted).length >= JSON.stringify(this.entries).length) return false;
    this.entries = compacted;
    this.schedule();
    return true;
  }

  /** This device's counter. Only an op that is actually written may take one. */
  nextCounter(): number {
    return ++this.counter;
  }

  /**
   * Records what has been folded in from peers. The file is rewritten even when
   * nothing else changed, because the header line is the receipt: a device that
   * adopted a peer's edit without recording it would look, on its next edit,
   * like it had edited concurrently — sync-flow.md §2.4.
   */
  noteReceipts(clock: SClock): void {
    const next = join(this.receipts, clock);
    if (dominates(this.receipts, next)) return;
    this.receipts = next;
    this.schedule();
  }

  append(ops: readonly Op[]): void {
    if (ops.length === 0) return;
    // Only the delta, and only on the first op of the batch. The full vector is
    // in the header; replaying the file forward reconstructs the rest.
    const delta = receiptDelta(this.receipted, this.receipts);
    const carried =
      Object.keys(delta).length === 0 ? ops : [{ ...ops[0]!, seen: delta }, ...ops.slice(1)];
    this.receipted = this.receipts;
    this.entries.push(...carried);
    this.schedule();
  }

  private schedule(): void {
    this.pending = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), WRITE_DEBOUNCE_MS);
  }

  /** Writes now. Called on a timer, and on the way out of the page. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending) return this.writing;
    this.pending = false;
    const snapshot = [...this.entries];
    const receipts = this.receipts;
    const name = this.label;
    this.writing = this.writing.then(async () => {
      try {
        const clock = join(clockOf(snapshot), receipts);
        // D-2's `lastSeen` is stamped here because here is where "this device
        // was running" is actually true. It is advisory and nothing reads it
        // but the device list, which is what keeps D-3 structural.
        const content = encodeLog(
          { v: LOG_VERSION, dev: this.device, clock, ...(name ? { name } : {}), at: Date.now() },
          snapshot,
        );
        this.bytes = content.length;
        await this.folder.write(deviceFileName(this.device), content);
      } catch (error) {
        // Keep the ops queued: the next edit rewrites the whole file anyway, so
        // a failed write costs nothing as long as it is not forgotten.
        this.pending = true;
        this.events.onError?.(error);
      }
    });
    return this.writing;
  }
}
