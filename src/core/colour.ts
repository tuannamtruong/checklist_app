// X-35. Whether a string is a colour, and what colour it is — requirements.md
// §10.1, past_decision.md §20.
//
// This module computes nothing *from* a colour. What a picked colour means —
// the accent it becomes, and the `accent-soft`, `ink-muted` and `ink-faint`
// mixed out of it — is spelled in `src/app.css`, where every other colour in
// this app is spelled, and that is the whole of §9 Theming's argument applied to
// a pick. What is left over is a parsing question: a hex code somebody typed, or
// one read back out of `localStorage`, or the colour the page turned out to be
// wearing. Parsing is the logic layer's own work and has no `window` in it.

/** The one shape a pick is stored, written and handed to a picker in. */
const HEX = /^#?(?:([0-9a-f])([0-9a-f])([0-9a-f])|([0-9a-f]{6}))$/i;

export type ColourRole = 'accent' | 'ink';

export interface ColourPick {
  id: ColourRole;
  /** What the row says. */
  label: string;
  /** Where it lands, in the terms the requirement was asked in. */
  note: string;
  /**
   * The role the swatch beside the picker wears, so it shows the colour the app
   * is actually in whether or not anything has been picked. It is a role rather
   * than a colour — §10.1's rule holds here as everywhere else.
   */
  token: string;
}

export const COLOUR_PICKS: readonly ColourPick[] = [
  {
    id: 'accent',
    label: 'Theme colour',
    note: 'Links, the open list, the add button',
    token: '--color-accent',
  },
  {
    id: 'ink',
    label: 'Text colour',
    note: 'Every word the app writes',
    token: '--color-ink',
  },
];

/**
 * `#abc`, `abc`, `#AABBCC` and anything else that is one of those with spaces
 * around it, all as `#aabbcc`. Anything else is `null` rather than a throw: a
 * stored pick is whatever an older build or a person with the developer tools
 * open left there, and a typed one is half-finished for as long as it is being
 * typed — X-14's rule about a stored id, applied to a colour.
 */
export function normaliseHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = HEX.exec(value.trim());
  if (!match) return null;
  const [, r, g, b, six] = match;
  const hex = six ?? `${r}${r}${g}${g}${b}${b}`;
  return `#${hex.toLowerCase()}`;
}

/**
 * A computed colour, back to a hex code. The browser hands back whatever it
 * likes — `rgb(…)`, `color(srgb …)` — and `<input type="color">` takes
 * `#rrggbb` and nothing else, so something has to sit between them. Only the
 * sRGB spellings are read: `.colour-swatch` in `src/app.css` paints through
 * sRGB precisely so that an `oklch` palette never reaches here, and a spelling
 * this does not know is `null`, which leaves the picker on the last colour it
 * had rather than on a wrong one.
 */
export function hexFromCss(value: string): string | null {
  const text = value.trim().toLowerCase();
  const direct = normaliseHex(text);
  if (direct) return direct;
  const srgb = /^color\(\s*srgb\s+([^)]+)\)$/.exec(text);
  if (srgb) return channels(srgb[1]!, 1);
  const rgb = /^rgba?\(([^)]+)\)$/.exec(text);
  if (rgb) return channels(rgb[1]!, 255);
  return null;
}

/** Three channels out of a colour function's body, on `scale`, alpha dropped. */
function channels(body: string, scale: number): string | null {
  const parts = body
    .split('/')[0]!
    .trim()
    .split(/[,\s]+/);
  if (parts.length < 3) return null;
  let hex = '#';
  for (const part of parts.slice(0, 3)) {
    const raw = part.endsWith('%') ? Number(part.slice(0, -1)) / 100 : Number(part) / scale;
    if (!Number.isFinite(raw)) return null;
    const byte = Math.round(Math.min(1, Math.max(0, raw)) * 255);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}
