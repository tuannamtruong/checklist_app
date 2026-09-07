import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIDEBAR_SIZE,
  isSidebarSizeId,
  SIDEBAR_SIZES,
  sidebarSizeOr,
} from './sidebar-size';

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

describe('sidebar size — X-25', () => {
  it('holds every id exactly once', () => {
    const ids = SIDEBAR_SIZES.map((size) => size.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('offers the default, and the default is X-19s own size', () => {
    const fallback = SIDEBAR_SIZES.find((size) => size.id === DEFAULT_SIDEBAR_SIZE);
    expect(fallback).toBeDefined();
    // A device that has never chosen has to see exactly what X-19 shipped.
    expect(fallback!.scale).toBe(1);
  });

  // The requirement is the four steps by name: normal, a fifth under, a fifth
  // over, two fifths over — requirements.md §10.4.
  it('is the four steps the requirement asked for', () => {
    expect(SIDEBAR_SIZES.map((size) => `${size.id}:${size.scale}`)).toEqual([
      'small:0.8',
      'normal:1',
      'large:1.2',
      'maximal:1.4',
    ]);
  });

  // The catalog is TypeScript and the multipliers are CSS, which is the same
  // seam `themes.test.ts` closes for the palettes — past_decision.md §15.2.
  it('has a multiplier in app.css for every id, and it is the catalogs', () => {
    for (const size of SIDEBAR_SIZES) {
      const block = new RegExp(
        `\\[data-sidebar-size='${size.id}'\\]\\s*\\{\\s*--sidebar-type:\\s*([\\d.]+);`,
      ).exec(css);
      expect(block, size.id).not.toBeNull();
      expect(Number(block![1]), size.id).toBe(size.scale);
    }
  });

  it('has no multiplier in app.css that the catalog does not name', () => {
    const declared = [...css.matchAll(/\[data-sidebar-size='([^']+)'\]/g)].map((match) => match[1]);
    expect(declared.length).toBe(SIDEBAR_SIZES.length);
    for (const id of declared) {
      expect(isSidebarSizeId(id), id).toBe(true);
    }
  });

  // §10.4: one multiplier, and X-19's rules multiply by it. A rule that spelled
  // a literal size again would be the step that stopped scaling.
  it('leaves no sidebar type rule that does not read the multiplier', () => {
    for (const rule of ['.sidebar-text', '.sidebar-note', '.sidebar-icon']) {
      const body = new RegExp(`\\${rule}\\s*\\{([^}]*)\\}`).exec(css);
      expect(body, rule).not.toBeNull();
      expect(body![1], rule).toContain('var(--sidebar-type)');
      expect(body![1], rule).not.toMatch(/:\s*[\d.]+rem;/);
    }
  });

  // §10.1 and past_decision.md §15.3: a theme is fourteen colours and never a
  // size. This is the half of that boundary a test can hold — the multiplier
  // must not appear inside any palette block.
  it('is not a theme, and no palette declares it', () => {
    for (const match of css.matchAll(/\[data-theme='([^']+)'\]\s*\{([^}]*)\}/g)) {
      expect(match[2], match[1]).not.toContain('--sidebar-type');
    }
  });

  it('reads a stored id as untrusted', () => {
    expect(sidebarSizeOr('large')).toBe('large');
    expect(sidebarSizeOr('enormous')).toBe(DEFAULT_SIDEBAR_SIZE);
    expect(sidebarSizeOr(null)).toBe(DEFAULT_SIDEBAR_SIZE);
    expect(sidebarSizeOr(undefined, 'small')).toBe('small');
  });
});
