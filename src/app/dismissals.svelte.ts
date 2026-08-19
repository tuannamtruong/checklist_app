// Conflict rows this device has been told about — C-6.
//
// The rows themselves are derived every cycle and never stored. Only the
// dismissals persist, and only here: acknowledging a notice by writing a file
// would be a fresh concurrent edit, which is a conflict raised to record that a
// conflict was read.
//
// They are pruned against the rows that still derive, so an id whose conflict
// has been settled by an ordinary edit stops costing bytes.

const DISMISSED_KEY = 'checklist.conflicts.dismissed';

export class Dismissals {
  private readonly storage: Storage;
  private ids = $state<ReadonlySet<string>>(new Set());

  constructor(storage: Storage = window.localStorage) {
    this.storage = storage;
    this.ids = this.load();
  }

  private load(): Set<string> {
    try {
      const raw = this.storage.getItem(DISMISSED_KEY);
      if (!raw) return new Set();
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? new Set(parsed.filter((id) => typeof id === 'string')) : new Set();
    } catch (error) {
      console.warn('conflicts: dismissals unreadable, starting fresh', error);
      return new Set();
    }
  }

  private save(ids: ReadonlySet<string>): void {
    this.ids = ids;
    this.storage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  dismiss(id: string): void {
    if (this.ids.has(id)) return;
    this.save(new Set([...this.ids, id]));
  }

  restore(id: string): void {
    if (!this.ids.has(id)) return;
    const next = new Set(this.ids);
    next.delete(id);
    this.save(next);
  }

  /** Drop dismissals for rows that no longer derive from merged state. */
  prune(live: Iterable<string>): void {
    const known = new Set(live);
    const kept = [...this.ids].filter((id) => known.has(id));
    if (kept.length === this.ids.size) return;
    this.save(new Set(kept));
  }
}
