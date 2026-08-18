// This device's op log: the one write path every mutation goes through — S-1.
//
// The adapter has no append, so a write is the whole file: the header line
// carrying the vector, then every op this device has ever written. Writes are
// therefore debounced and serialised — a burst of typing must not turn into a
// burst of whole-file writes, and two writes must never be in flight at once,
// or the shorter one can land last.

import { clockOf, decodeLog, deviceFileName, encodeLog, LOG_VERSION } from '../core/op-log';
import type { FolderAdapter } from '../core/folder';
import type { DeviceId, Op } from '../core/types';

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
  private ops: Op[] = [];
  private counter = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private pending = false;

  private constructor(folder: FolderAdapter, device: DeviceId, events: DeviceLogEvents) {
    this.folder = folder;
    this.device = device;
    this.events = events;
  }

  /**
   * Reads this device's own file. M1 has one device, so that is the whole
   * folder; M2 widens this to every `checklist.*.ops.jsonl` in it and folds
   * them together, which is why the fold already takes ops from any device.
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
        log.ops = decoded.ops;
        log.counter = clockOf(decoded.ops)[device] ?? 0;
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
    return { log, ops: log.ops };
  }

  /** This device's counter. Only an op that is actually written may take one. */
  nextCounter(): number {
    return ++this.counter;
  }

  append(ops: readonly Op[]): void {
    if (ops.length === 0) return;
    this.ops.push(...ops);
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
    const snapshot = [...this.ops];
    this.writing = this.writing.then(async () => {
      try {
        const clock = clockOf(snapshot);
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
