// X-35. The two colours picked over the chosen theme, applied to the document
// root and remembered on this device — requirements.md §10.1, past_decision.md
// §20. It is `localStorage` beside the theme itself for X-14's reason: a
// preference that converged across devices would be one the user has to fight on
// whichever device they are not holding.
//
// A pick reaches the page as one custom property and one attribute, and that is
// deliberately all it is: `src/app.css` holds what a pick *means* — the token it
// re-points and the three mixed out of it — so no colour is ever computed here.
// The parser and the catalog live in `src/core/colour.ts`; this file is the half
// that is allowed to touch `window`.

import { COLOUR_PICKS, hexFromCss, normaliseHex, type ColourRole } from '../core/colour';

/** Read by the boot line in `index.html` too, which is why they are spelled twice. */
const COLOUR_KEY: Record<ColourRole, string> = {
  accent: 'checklist.colour.accent',
  ink: 'checklist.colour.ink',
};

export class ThemeColours {
  /** The pick per role, or `null` where the theme's own colour still stands. */
  picks = $state<Record<ColourRole, string | null>>({
    accent: null,
    ink: null,
  });
  private storage: Storage;

  constructor(storage: Storage = window.localStorage) {
    this.storage = storage;
    for (const pick of COLOUR_PICKS) {
      // The boot line has already applied whatever was stored; this is what
      // makes the two agree when storage was unreadable or held a colour that
      // is not one.
      this.write(pick.id, normaliseHex(this.read(pick.id)));
    }
  }

  /**
   * Takes a colour in any shape a person types it, and reports whether it was
   * one. A half-typed hex code is refused rather than applied — the field keeps
   * what was typed and says so, which is the only thing that can be done with
   * three characters of six.
   */
  set(role: ColourRole, value: string): boolean {
    const hex = normaliseHex(value);
    if (!hex) return false;
    this.write(role, hex);
    return true;
  }

  /** Back to whatever the chosen theme says, which is the absence of a pick. */
  clear(role: ColourRole): void {
    this.write(role, null);
  }

  private write(role: ColourRole, hex: string | null): void {
    this.picks[role] = hex;
    apply(role, hex);
    try {
      if (hex) this.storage.setItem(COLOUR_KEY[role], hex);
      else this.storage.removeItem(COLOUR_KEY[role]);
    } catch (error) {
      // A full or blocked quota costs the choice on the next launch and nothing
      // in this session, so it is reported rather than raised at the user.
      console.warn(`colour: ${role} could not be stored`, error);
    }
  }

  private read(role: ColourRole): string | null {
    try {
      return this.storage.getItem(COLOUR_KEY[role]);
    } catch (error) {
      console.warn('colour: storage unreadable, using the theme', error);
      return null;
    }
  }
}

/**
 * The property `src/app.css` reads, and the attribute its `:root[…-pick]` block
 * keys on. The value is on both: the attribute is the switch, and carrying the
 * colour on it as well is what lets the smoke run see a pick without reading an
 * inline style — `scripts/ui-smoke.mjs`.
 */
function apply(role: ColourRole, hex: string | null): void {
  const root = document.documentElement;
  if (hex) {
    root.style.setProperty(`--${role}-pick`, hex);
    root.setAttribute(`data-${role}-pick`, hex);
  } else {
    root.style.removeProperty(`--${role}-pick`);
    root.removeAttribute(`data-${role}-pick`);
  }
}

/**
 * What the page is actually wearing, read off an element that carries the role —
 * so the picker opens on the current colour rather than on black, whether that
 * colour came from a pick or from the theme under it. `.colour-swatch` is what
 * makes the computed value readable; `null` leaves the picker where it was.
 */
export function wornColour(element: Element): string | null {
  return hexFromCss(getComputedStyle(element).backgroundColor);
}
