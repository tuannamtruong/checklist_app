// This device's op log: the one write path every mutation goes through — S-1.
//
// The adapter has no append, so a write is the whole file: the header line
// carrying the vector, then every op this device has ever written. Writes are
// therefore debounced and serialised — a burst of typing must not turn into a
// burst of whole-file writes, and two writes must never be in flight at once,
// or the shorter one can land last.

import { receiptDelta } from '../core/merge';
import { clockOf, decodeLog, deviceFileName, encodeLog, LOG_VERSION } from '../core/op-log';
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
    this.writing = this.writing.then(async () => {
      try {
        const clock = join(clockOf(snapshot), receipts);
        const content = encodeLog({ v: LOG_VERSION, dev: this.device, clock }, snapshot);
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
