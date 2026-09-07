import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROVIDERS, isProviderId, providerOr } from './providers';

const manifest = readFileSync(
  new URL('../../packaging/android/app/src/main/AndroidManifest.xml', import.meta.url),
  'utf8',
);

describe('providers', () => {
  it('holds every id exactly once', () => {
    const ids = PROVIDERS.map((provider) => provider.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // X-17. Android 11 hides a package the manifest has not named, and
  // `getLaunchIntentForPackage` then answers null — which reads exactly like
  // "not installed". This is the same seam themes.test.ts closes for the
  // palettes: the catalog is TypeScript and the shell is XML.
  it('names every android package in the manifest queries', () => {
    for (const provider of PROVIDERS) {
      expect(manifest, provider.id).toContain(`android:name="${provider.android}"`);
    }
  });

  // The helper resolves a command on PATH and runs it with no arguments —
  // architecture.md §4.1 — and refuses anything with a separator in it.
  it('names a desktop command the helper will accept', () => {
    for (const provider of PROVIDERS) {
      expect(provider.command, provider.id).toMatch(/^[A-Za-z0-9._-]{1,40}$/);
    }
  });

  it('reads a stored id as untrusted', () => {
    expect(providerOr('mega')?.label).toBe('MEGA');
    expect(providerOr('sneakernet')).toBe(null);
    expect(providerOr(null)).toBe(null);
    expect(isProviderId('dropbox')).toBe(true);
    expect(isProviderId(7)).toBe(false);
  });
});
