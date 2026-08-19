// When the sync cycle runs — S-19.
//
// Not a poll. A fixed timer spends battery on the idle days that dominate real
// use, and a browser throttles timers in a hidden tab and freezes them outright
// when a PWA is backgrounded, so a poll is unreliable exactly when it is the
// only thing running. Activity drives it instead: an edit resets the cadence,
// which then decays and stops, leaving focus and the refresh button.
//
// The cadence is a property of this device rather than of the data, so nothing
// here is ever written to the folder — sync-flow.md §4.6.

/** After the last edit: a cycle 5 s later, then 15 s after that, then 60 s, then idle. */
const DECAY_MS: readonly number[] = [5_000, 15_000, 60_000];

export class SyncCadence {
  private readonly run: () => Promise<unknown>;
  private step = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private again = false;

  constructor(run: () => Promise<unknown>) {
    this.run = run;
  }

  /** A cycle now, then the decay. Startup, window focus and the refresh button. */
  refresh(): void {
    this.step = 0;
    void this.fire();
  }

  /** An edit happened: the folder is worth reading again soon, but not now. */
  activity(): void {
    this.step = 0;
    this.arm();
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.step = DECAY_MS.length;
  }

  private arm(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const delay = DECAY_MS[this.step];
    if (delay === undefined) return;
    this.step++;
    this.timer = setTimeout(() => void this.fire(), delay);
  }

  /**
   * One cycle at a time. Two overlapping passes would read the folder twice and
   * could adopt the older read last, so a request arriving mid-cycle is
   * remembered and served by one more pass afterwards.
   */
  private async fire(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      await this.run();
    } finally {
      this.running = false;
    }
    if (this.again) {
      this.again = false;
      this.step = 0;
      void this.fire();
      return;
    }
    this.arm();
  }
}
