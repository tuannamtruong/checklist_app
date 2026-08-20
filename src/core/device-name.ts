// D-5 — the name a device gives itself before anybody types one.
//
// requirements.md §8. Two lookups over a user-agent string and four digits of
// the device id, and that is the whole feature: what comes out goes into the
// same header field D-1's typed name goes into, written by the same single
// writer, so neither the merge nor the file format learns anything new.
//
// The tables are ordered and the first match wins, because the strings nest:
// every Edge says Chrome, every Chrome says Safari, and every Android says
// Linux. Nothing here reads a version and nothing may — a version is the part
// of a user-agent string that lies, and a name is worth a guess rather than a
// parser.

/** Up to five characters, and what a person would call the machine. */
const PLATFORMS: readonly (readonly [RegExp, string])[] = [
  [/Android/, 'Andro'],
  [/CrOS/, 'CrOS'],
  [/iPhone|iPod/, 'iOS'],
  [/iPad/, 'iPad'],
  [/Windows/, 'Win'],
  [/Macintosh|Mac OS X/, 'Mac'],
  [/Linux|X11/, 'Linux'],
];

/** Up to four. */
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  // The Android bundle's WebView — architecture.md §7. It says Chrome like
  // everything else on the phone, and it is the one entry here that is not a
  // browser anybody chose, so it is the one that has to be asked about first.
  [/;\s*wv\)/, 'App'],
  [/Edg[A-Za-z]*\//, 'Edge'],
  [/OPR\/|Opera\//, 'Oper'],
  [/SamsungBrowser\//, 'Sams'],
  [/Firefox\/|FxiOS\//, 'Fire'],
  // No word boundary in front of Chrome, deliberately: a headless Chromium says
  // `HeadlessChrome/`, and the smoke run that drives this app is one.
  [/CriOS\/|Chrome\/|Chromium\//, 'Chro'],
  [/Safari\//, 'Safa'],
];

/** Neither table matched. A guess this module is allowed to lose. */
const UNKNOWN = 'Web';

/**
 * `Win-Chro-a3f1`. The platform, the browser, and the first four digits of the
 * device id — the id rather than a fresh random, so the name is stable across
 * restarts and can be matched to the file in the folder by eye.
 */
export function autoDeviceName(userAgent: string, deviceId: string): string {
  return [firstMatch(PLATFORMS, userAgent), firstMatch(BROWSERS, userAgent), suffixOf(deviceId)].join(
    '-',
  );
}

function firstMatch(table: readonly (readonly [RegExp, string])[], userAgent: string): string {
  return table.find(([pattern]) => pattern.test(userAgent))?.[1] ?? UNKNOWN;
}

/**
 * An id is eight hex digits — `app/device.ts` mints nothing else — but this
 * takes whatever it is given, because a name that came out four characters
 * short is a worse failure than a name padded with a zero.
 */
function suffixOf(deviceId: string): string {
  return deviceId
    .toLowerCase()
    .replace(/[^0-9a-z]/g, '')
    .slice(0, 4)
    .padEnd(4, '0');
}
