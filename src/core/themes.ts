// The theme catalog — X-13, requirements.md §10.1. One list of ids, and
// `src/app.css` holds one palette per id in it. `themes.test.ts` reads both and
// fails if they ever drift, which is the cost of keeping the colours in CSS and
// the choice in TypeScript — past_decision.md §9.
//
// Nothing here reaches the document: a theme is applied by `src/app/theme.svelte.ts`,
// which is where `window` is allowed to exist.

export type ThemeId = 'light' | 'dark' | 'green' | 'orange' | 'yellow' | 'teal';

export interface ThemeChoice {
  id: ThemeId;
  /** What the button says. */
  label: string;
  /** Why someone would pick it, in one phrase rather than a colour name. */
  note: string;
}

/** What a device that has never chosen gets, and what an unreadable id falls back to. */
export const DEFAULT_THEME: ThemeId = 'light';

export const THEMES: readonly ThemeChoice[] = [
  { id: 'light', label: 'Light', note: 'The default' },
  { id: 'dark', label: 'Dark', note: 'For a dim room' },
  { id: 'green', label: 'Green', note: 'Cool, low contrast' },
  { id: 'teal', label: 'Teal', note: 'Cool, cooler still' },
  { id: 'orange', label: 'Orange', note: 'Warm' },
  { id: 'yellow', label: 'Yellow', note: 'Warm, paper-like' },
];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEMES.some((theme) => theme.id === value);
}

/**
 * X-14. A stored id is whatever an older build, another tab or a person with the
 * developer tools open left there, so it is read as untrusted rather than cast.
 */
export function themeOr(value: unknown, fallback: ThemeId = DEFAULT_THEME): ThemeId {
  return isThemeId(value) ? value : fallback;
}
