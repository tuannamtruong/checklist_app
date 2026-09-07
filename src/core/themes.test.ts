import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, isThemeId, THEMES, themeOr } from './themes';

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

describe('themes', () => {
  it('holds every id exactly once', () => {
    const ids = THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('offers the default', () => {
    expect(THEMES.some((theme) => theme.id === DEFAULT_THEME)).toBe(true);
  });

  // X-13. The catalog is TypeScript and the palettes are CSS, which is the one
  // seam this design has — past_decision.md §9. This is what closes it.
  it('has a palette in app.css for every id', () => {
    for (const theme of THEMES) {
      expect(css, theme.id).toContain(`[data-theme='${theme.id}']`);
    }
  });

  it('has no palette in app.css that the catalog does not name', () => {
    const declared = [...css.matchAll(/\[data-theme='([^']+)'\]/g)].map((match) => match[1]);
    for (const id of declared) {
      expect(isThemeId(id), id).toBe(true);
    }
  });

  // §10.1: every theme re-points the same ten roles. One that left a role out
  // would inherit it from the light palette, which is how a dark theme ends up
  // with white text on white.
  it('gives every theme every token the light palette declares', () => {
    const blocks = new Map<string, string>();
    for (const match of css.matchAll(/\[data-theme='([^']+)'\]\s*\{([^}]*)\}/g)) {
      blocks.set(match[1]!, match[2]!);
    }
    const roles = [...(blocks.get('light') ?? '').matchAll(/--color-([\w-]+):/g)].map((m) => m[1]!);
    expect(roles.length).toBeGreaterThan(0);
    for (const [id, body] of blocks) {
      for (const role of roles) {
        expect(body, `${id} is missing --color-${role}`).toContain(`--color-${role}:`);
      }
    }
  });

  it('reads a stored id as untrusted', () => {
    expect(themeOr('teal')).toBe('teal');
    expect(themeOr('chartreuse')).toBe(DEFAULT_THEME);
    expect(themeOr(null)).toBe(DEFAULT_THEME);
    expect(themeOr(undefined, 'dark')).toBe('dark');
  });
});
