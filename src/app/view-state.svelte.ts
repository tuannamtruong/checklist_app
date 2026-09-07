// Device-local view state — requirements.md §2.3. None of this is in the Sync
// Folder and none of it ever will be: which rows this device has collapsed says
// nothing about the checklist, and converging it would make one device's
// scrolling another device's problem.

import type { NodeId } from '../core/types';

const COLLAPSED_KEY = 'checklist.collapsed';
const DRAWER_KEY = 'checklist.drawer';
const TAG_FILTER_KEY = 'checklist.tagfilter';
const SIDEBAR_WIDTH_KEY = 'checklist.sidebarwidth';
const NOTE_WIDTH_KEY = 'checklist.notewidth';

/**
 * X-20. Bounds rather than a free drag: narrower than the first and a title is
 * a truncation, wider than the last and the sidebar is the page. The default is
 * the `w-64` the column had before it could be dragged, so a device that never
 * touches the grip sees exactly what it always saw.
 */
export const SIDEBAR_WIDTH = { min: 176, max: 480, default: 256 } as const;

/**
 * X-24. The pane's floor and where it starts — and, unlike X-20's, no fixed
 * ceiling: what stops the divider is the room in the window, because a number
 * that is generous on a laptop is a third of the screen on a monitor. The
 * default is the two fifths the pane was fixed at before it could be dragged.
 *
 * `listFloor` is what the list keeps whatever the note does, and it is
 * SIDEBAR_WIDTH.min for the same reason: narrower than that and a row's title
 * is a truncation rather than a title. It was 320 — a whole readable column —
 * and that was the wrong question. The list is *behind* the note here; what it
 * owes the reader is somewhere to click back to, not a second page. A note long
 * enough to want the width is exactly the note that could not have it.
 *
 * `ceiling` binds only when the window is not known, which is the one place it
 * is read — the pane is drawn nowhere but a browser, so it is the fallback for
 * a viewport nobody has reported rather than a bound on the drag. A window that
 * *is* known stops the divider with `listFloor` and nothing else, or the
 * strip the reader asked to keep would not be the strip they got.
 *
 * The *stored* width stays pixels. A share would mean something different on
 * every device that read it, which is the drift X-20 rejected; a pixel width
 * narrowed to fit a smaller window is one number the bigger window still has.
 */
export const NOTE_WIDTH = {
  min: 320,
  default: 416,
  listFloor: SIDEBAR_WIDTH.min,
  ceiling: 1600,
} as const;

/** What a draggable width needs: a floor, a ceiling and where it starts. */
type Bounds = { readonly min: number; readonly max: number; readonly default: number };

function loadWidth(storage: Storage, key: string, bounds: Bounds): number {
  const raw = Number(storage.getItem(key));
  return Number.isFinite(raw) && raw > 0 ? clampWidth(raw, bounds) : bounds.default;
}

function clampWidth(px: number, bounds: Bounds): number {
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, px)));
}

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
  /**
   * X-20, in pixels, and only above `md`: below it the sidebar is a drawer over
   * the page rather than a column beside it, so there is nothing for a width to
   * take room from.
   */
  sidebarWidth = $state<number>(SIDEBAR_WIDTH.default);
  /**
   * X-24, in pixels, as dragged. What is *drawn* is this clamped to the room
   * the window has, which is `notePaneWidth` — a width dragged on a monitor is
   * narrowed on a laptop rather than squeezing the list, and is still the
   * width the monitor gets back.
   */
  private noteWidth = $state<number>(NOTE_WIDTH.default);
  /** 0 until something tells us — see `setViewport`. */
  private viewport = $state(0);

  constructor(storage: Storage = window.localStorage) {
    this.storage = storage;
    this.collapsedIds = loadIds(storage, COLLAPSED_KEY);
    this.tags = loadIds(storage, TAG_FILTER_KEY);
    this.drawerOpen = storage.getItem(DRAWER_KEY) === 'open';
    this.sidebarWidth = loadWidth(storage, SIDEBAR_WIDTH_KEY, SIDEBAR_WIDTH);
    this.noteWidth = loadWidth(storage, NOTE_WIDTH_KEY, this.noteBounds);
    if (typeof window !== 'undefined') this.viewport = window.innerWidth;
  }

  /**
   * X-24. How wide the window is, told to us rather than read here: the class
   * is constructed once and a window is resized all day, so the app hands it
   * over on every resize and the pane's bound follows the screen it is on.
   */
  setViewport(px: number): void {
    this.viewport = Math.round(px);
  }

  /**
   * X-24. The widest the note may be *here*: everything the window has that is
   * not the sidebar and not the list's floor. It moves when the window is
   * resized and when the sidebar is dragged, which is the point — both take
   * their room from the same row.
   */
  get noteWidthMax(): number {
    if (this.viewport === 0) return NOTE_WIDTH.ceiling;
    const room = this.viewport - this.sidebarWidth - NOTE_WIDTH.listFloor;
    return Math.max(NOTE_WIDTH.min, Math.round(room));
  }

  private get noteBounds(): Bounds {
    return { min: NOTE_WIDTH.min, max: this.noteWidthMax, default: NOTE_WIDTH.default };
  }

  /** X-24, as drawn: the dragged width, narrowed to what this window can spare. */
  get notePaneWidth(): number {
    return clampWidth(this.noteWidth, this.noteBounds);
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

  /** X-20. Clamped here rather than at the grip, so every caller gets the bounds. */
  setSidebarWidth(px: number): void {
    const next = clampWidth(px, SIDEBAR_WIDTH);
    if (next === this.sidebarWidth) return;
    this.sidebarWidth = next;
    this.storage.setItem(SIDEBAR_WIDTH_KEY, String(next));
  }

  /** X-24, and the same rule: the grip reports a pointer, this decides a width. */
  setNotePaneWidth(px: number): void {
    const next = clampWidth(px, this.noteBounds);
    if (next === this.noteWidth) return;
    this.noteWidth = next;
    this.storage.setItem(NOTE_WIDTH_KEY, String(next));
  }

  setDrawer(open: boolean): void {
    this.drawerOpen = open;
    this.storage.setItem(DRAWER_KEY, open ? 'open' : 'shut');
  }
}
