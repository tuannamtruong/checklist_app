import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLOUR_PICKS, hexFromCss, normaliseHex } from './colour';

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

describe('normaliseHex', () => {
  it('takes the three shapes a person types', () => {
    expect(normaliseHex('#3B6FD4')).toBe('#3b6fd4');
    expect(normaliseHex('3b6fd4')).toBe('#3b6fd4');
    expect(normaliseHex('  #ABC ')).toBe('#aabbcc');
  });

  it('reads a half-typed or stored value as untrusted rather than throwing', () => {
    expect(normaliseHex('#3b6f')).toBeNull();
    expect(normaliseHex('rebeccapurple')).toBeNull();
    expect(normaliseHex('')).toBeNull();
    expect(normaliseHex(null)).toBeNull();
    expect(normaliseHex(42)).toBeNull();
  });
});

describe('hexFromCss', () => {
  it('reads the sRGB spellings a browser computes', () => {
    expect(hexFromCss('rgb(59, 111, 212)')).toBe('#3b6fd4');
    expect(hexFromCss('rgba(59, 111, 212, 0.5)')).toBe('#3b6fd4');
    expect(hexFromCss('rgb(59 111 212 / 50%)')).toBe('#3b6fd4');
    expect(hexFromCss('color(srgb 0.2314 0.4353 0.8314)')).toBe('#3b6fd4');
    expect(hexFromCss('#3B6FD4')).toBe('#3b6fd4');
  });

  it('clamps a channel the display gamut cannot hold', () => {
    expect(hexFromCss('color(srgb 1.4 -0.2 0.5)')).toBe('#ff0080');
  });

  it('leaves a spelling it does not know alone', () => {
    expect(hexFromCss('oklch(52% 0.14 250)')).toBeNull();
    expect(hexFromCss('rgb(59, 111)')).toBeNull();
    expect(hexFromCss('transparent')).toBeNull();
  });
});

// X-35. The pick is a custom property and what it *means* is a block in
// `app.css` — the same seam `themes.test.ts` closes for the palettes.
describe('the picks', () => {
  it('names each role once', () => {
    const ids = COLOUR_PICKS.map((pick) => pick.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has a rule in app.css for every pick, and a token for its swatch', () => {
    for (const pick of COLOUR_PICKS) {
      expect(css, pick.id).toContain(`:root[data-${pick.id}-pick]`);
      expect(css, pick.id).toContain(`--${pick.id}-pick`);
      expect(css, pick.token).toContain(`${pick.token}:`);
    }
  });

  it('mixes every derived token with the theme’s own surface', () => {
    for (const match of css.matchAll(/:root\[data-\w+-pick\]\s*\{([^}]*)\}/g)) {
      const body = match[1]!;
      for (const line of body.split(';')) {
        if (!line.includes('color-mix')) continue;
        expect(line, line).toContain('var(--color-surface)');
      }
    }
  });
});
