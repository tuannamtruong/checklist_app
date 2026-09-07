// The sidebar's type size — X-25, requirements.md §10.4. X-19 decided the
// sidebar reads a fifth larger than the page beside it; this is that decision
// made per device, because how far the screen is from the reader is not a
// property of the app.
//
// It is deliberately *not* a theme. requirements.md §10.1 holds a theme to
// fourteen colour tokens and to never changing a layout, a size or a font, and
// that rule is what lets the smoke run assert every palette draws the identical
// DOM — past_decision.md §15.3. So this is a catalog of its own, keyed on an
// attribute of its own.
//
// Nothing here reaches the document: the attribute is set by
// `src/app/sidebar-size.svelte.ts`, which is where `window` is allowed to exist.

export type SidebarSizeId = 'small' | 'normal' | 'large' | 'maximal';

export interface SidebarSizeChoice {
  id: SidebarSizeId;
  /** What the button says. */
  label: string;
  /** How it differs from normal, in the terms the requirement was asked in. */
  note: string;
  /**
   * What `--sidebar-type` becomes. `src/app.css` spells the same number in the
   * `[data-sidebar-size='…']` block, and `sidebar-size.test.ts` fails if the two
   * ever drift — the same seam `themes.test.ts` closes for the palettes.
   */
  scale: number;
}

/** X-19's size, and what a device that has never chosen gets. */
export const DEFAULT_SIDEBAR_SIZE: SidebarSizeId = 'normal';

export const SIDEBAR_SIZES: readonly SidebarSizeChoice[] = [
  { id: 'small', label: 'Small', note: 'A fifth smaller', scale: 0.8 },
  { id: 'normal', label: 'Normal', note: 'The default', scale: 1 },
  { id: 'large', label: 'Large', note: 'A fifth larger', scale: 1.2 },
  { id: 'maximal', label: 'Maximal', note: 'Two fifths larger', scale: 1.4 },
];

export function isSidebarSizeId(value: unknown): value is SidebarSizeId {
  return typeof value === 'string' && SIDEBAR_SIZES.some((size) => size.id === value);
}

/**
 * A stored id is whatever an older build, another tab or a person with the
 * developer tools open left there, so it is read as untrusted rather than cast —
 * X-14's rule, which X-25 inherits along with the boot line.
 */
export function sidebarSizeOr(
  value: unknown,
  fallback: SidebarSizeId = DEFAULT_SIDEBAR_SIZE,
): SidebarSizeId {
  return isSidebarSizeId(value) ? value : fallback;
}
