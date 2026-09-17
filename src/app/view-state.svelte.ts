// Device-local view state — requirements.md §2.3. None of this is in the Sync
// Folder and none of it ever will be: which rows this device has collapsed says
// nothing about the checklist, and converging it would make one device's
// scrolling another device's problem.

import type { NodeId } from '../core/types';

const COLLAPSED_KEY = 'checklist.collapsed';
const DRAWER_KEY = 'checklist.drawer';
const TAG_FILTER_KEY = 'checklist.tagfilter';

function loadIds(storage: Storage, key: string): Set<NodeId> {
  try {
    const raw = storage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((id) => typeof id === 'string')) : new Set();
  } catch (error) {
    console.warn(`view state: ${key} unreadable, starting fresh`, error);
    return new Set();
  }
}

/** T-8 and A-5. Collapse, the drawer and the tag filter, on this device only. */
export class ViewState {
  private storage: Storage;
  private collapsedIds = $state<Set<NodeId>>(new Set());
  /**
   * A-5. Which tags the tree is filtered by. It persists, because a filter that
   * cleared itself on every reload would be a filter nobody could rely on — and
   * the bar says what is on for as long as it is on, so a filtered tree is never
   * mistaken for an empty one.
   */
  private tags = $state<Set<string>>(new Set());
  /** Below `md` the sidebar is a drawer, and the drawer starts shut — X-2. */
  drawerOpen = $state(false);

  constructor(storage: Storage = window.localStorage) {
    this.storage = storage;
    this.collapsedIds = loadIds(storage, COLLAPSED_KEY);
    this.tags = loadIds(storage, TAG_FILTER_KEY);
    this.drawerOpen = storage.getItem(DRAWER_KEY) === 'open';
  }

  /** A-4. The selection, as the filter and the bar both read it. */
  get tagFilter(): ReadonlySet<string> {
    return this.tags;
  }

  isFiltering(tag: string): boolean {
    return this.tags.has(tag);
  }

  toggleTagFilter(tag: string): void {
    const next = new Set(this.tags);
    if (!next.delete(tag)) next.add(tag);
    this.setTagFilter(next);
  }

  clearTagFilter(): void {
    this.setTagFilter(new Set());
  }

  private setTagFilter(next: Set<string>): void {
    this.tags = next;
    this.storage.setItem(TAG_FILTER_KEY, JSON.stringify([...next]));
  }

  isCollapsed(id: NodeId): boolean {
    return this.collapsedIds.has(id);
  }

  toggleCollapsed(id: NodeId): void {
    const next = new Set(this.collapsedIds);
    if (!next.delete(id)) next.add(id);
    this.collapsedIds = next;
    this.storage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
  }

  expand(id: NodeId): void {
    if (!this.collapsedIds.has(id)) return;
    this.toggleCollapsed(id);
  }

  setDrawer(open: boolean): void {
    this.drawerOpen = open;
    this.storage.setItem(DRAWER_KEY, open ? 'open' : 'shut');
  }
}
