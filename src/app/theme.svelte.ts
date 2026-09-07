// X-14. The chosen theme, applied to the document root and remembered on this
// device — requirements.md §10.1. It is `localStorage` beside the collapse state
// for the same reason T-8 is: a preference that converged across devices would
// be one the user has to fight on whichever device they are not holding.
//
// The catalog and the fallback live in `src/core/themes.ts`; this file is the
// half that is allowed to touch `window`.

import { DEFAULT_THEME, themeOr, type ThemeId } from '../core/themes';

/** Read by the boot line in `index.html` too, which is why it is spelled twice. */
const THEME_KEY = 'checklist.theme';

/**
 * Sets the attribute every `[data-theme]` palette in `app.css` keys on, then
 * brings the PWA's status-bar colour with it — an Android home-screen launch
 * paints that strip from the meta tag, and a dark app under a light strip looks
 * like a rendering failure.
 *
 * The colour is read back out of the computed style rather than kept in a table
 * here, so the palettes stay spelled in exactly one place.
 */
function applyTheme(id: ThemeId): void {
  const root = document.documentElement;
  root.dataset.theme = id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const surface = getComputedStyle(root).getPropertyValue('--color-surface').trim();
  if (surface) meta.setAttribute('content', surface);
}

export class Theme {
  current = $state<ThemeId>(DEFAULT_THEME);
  private storage: Storage;

  constructor(storage: Storage = window.localStorage) {
    this.storage = storage;
    this.current = themeOr(this.read());
    // The boot line has already set the attribute; this is what makes the two
    // agree when storage was unreadable or held an id this build has dropped.
    applyTheme(this.current);
  }

  set(id: ThemeId): void {
    this.current = id;
    applyTheme(id);
    try {
      this.storage.setItem(THEME_KEY, id);
    } catch (error) {
      // A full or blocked quota costs the choice on the next launch and nothing
      // in this session, so it is reported rather than raised at the user.
      console.warn(`theme: ${id} could not be stored`, error);
    }
  }

  private read(): string | null {
    try {
      return this.storage.getItem(THEME_KEY);
    } catch (error) {
      console.warn('theme: storage unreadable, using the default', error);
      return null;
    }
  }
}
