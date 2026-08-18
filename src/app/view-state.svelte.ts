// Device-local view state — requirements.md §2.3. None of this is in the Sync
// Folder and none of it ever will be: which rows this device has collapsed says
// nothing about the checklist, and converging it would make one device's
// scrolling another device's problem.

import type { NodeId } from '../core/types';

const COLLAPSED_KEY = 'checklist.collapsed';
const DRAWER_KEY = 'checklist.drawer';

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

/** T-8. Collapse and expand, remembered on this device only. */
export class ViewState {
  private storage: Storage;
  private collapsedIds = $state<Set<NodeId>>(new Set());
  /** Below `md` the sidebar is a drawer, and the drawer starts shut — X-2. */
  drawerOpen = $state(false);

  constructor(storage: Storage = window.localStorage) {
    this.storage = storage;
    this.collapsedIds = loadIds(storage, COLLAPSED_KEY);
    this.drawerOpen = storage.getItem(DRAWER_KEY) === 'open';
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
