// requirements.md §8, D-5. A table of real user-agent strings, because the only
// way this module is wrong is by matching the wrong row of its own table: every
// Chromium string says Safari, every Edge string says Chrome, and the WebView
// the Android bundle runs in says Chrome twice and is not a browser at all.

import { describe, expect, it } from 'vitest';
import { autoDeviceName } from './device-name';

const ID = 'a3f19c02';

const AGENTS: readonly (readonly [string, string, string])[] = [
  [
    'Win-Chro',
    'Windows, Chrome',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  ],
  [
    'Win-Edge',
    'Windows, Edge — says Chrome and Safari as well',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  ],
  [
    'Win-Fire',
    'Windows, Firefox — the bundle browser X-18 exists for',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  ],
  [
    'Mac-Safa',
    'macOS, Safari',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  ],
  [
    'Linux-Fire',
    'Linux, Firefox — the machine this was built on',
    'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  ],
  [
    'Andro-Chro',
    'Android, Chrome — Android before Linux, which the string also says',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  ],
  [
    'Andro-App',
    'Android, the bundle WebView — architecture.md §7',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36',
  ],
  [
    'Andro-Sams',
    'Android, Samsung Internet — says Chrome too',
    'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
  ],
  [
    'iOS-Safa',
    'iPhone, Safari',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ],
  [
    'iOS-Chro',
    'iPhone, Chrome — which is Safari underneath and says CriOS',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1',
  ],
  [
    'iPad-Safa',
    'iPad, Safari — the strings that still say iPad',
    'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ],
  [
    'Linux-Chro',
    'Linux, headless Chromium — the string `npm run ui-smoke` arrives with',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
  ],
  [
    'CrOS-Chro',
    'ChromeOS, Chrome — CrOS before Linux, which the string also says',
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  ],
];

describe('autoDeviceName', () => {
  for (const [expected, what, agent] of AGENTS) {
    it(`names ${what}`, () => {
      expect(autoDeviceName(agent, ID)).toBe(`${expected}-a3f1`);
    });
  }

  it('carries the first four digits of the device id, so the name is stable', () => {
    // The same device, twice, and on a string it has never seen: what makes the
    // name stable across restarts is that nothing in it is random at all.
    expect(autoDeviceName('anything', ID)).toBe(autoDeviceName('anything', ID));
    expect(autoDeviceName('anything', ID).endsWith(ID.slice(0, 4))).toBe(true);
  });

  it('guesses Web rather than failing on a string it does not know', () => {
    // A wrong guess is still eleven characters better than eight hex ones, and
    // this is the string a headless run and a new engine both arrive with.
    expect(autoDeviceName('some-crawler/1.0', ID)).toBe('Web-Web-a3f1');
    expect(autoDeviceName('', ID)).toBe('Web-Web-a3f1');
  });

  it('pads an id too short to fill the suffix', () => {
    expect(autoDeviceName('', 'b7')).toBe('Web-Web-b700');
  });

  it('fits the field D-1 already had', () => {
    // 64 characters, `cleanDeviceName` — and the longest name this can produce
    // is fifteen, five plus four plus four and two hyphens, so the trim can
    // never see one of these.
    for (const [, , agent] of AGENTS) expect(autoDeviceName(agent, ID).length).toBeLessThan(16);
  });
});
