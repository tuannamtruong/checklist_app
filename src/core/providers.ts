// The cloud clients this app knows how to *launch* — X-17, requirements.md
// §10.2. Data only, and deliberately inert: nothing in the merge, the adapter
// or the file format knows which provider is under the folder, because a
// provider is a folder and the folder is all that syncs — §7.3.
//
// So this catalog buys exactly one thing: a button on the settings screen that
// opens the app whose client is keeping this device's folder up to date, for
// the times when the answer to "why has my phone not seen that row" is "the
// provider's app has not run today".

export type ProviderId = 'mega' | 'dropbox' | 'drive' | 'onedrive' | 'nextcloud' | 'syncthing';

export interface Provider {
  id: ProviderId;
  label: string;
  /** The Android package, for the launch intent the shell asks for. */
  android: string;
  /**
   * The desktop command, resolved on `PATH` and run with no arguments. Never a
   * path: a command name is what the helper will accept —
   * architecture.md §4.1.
   */
  command: string;
}

/** MEGA first, because it is the provider the milestones were built against. */
export const PROVIDERS: readonly Provider[] = [
  { id: 'mega', label: 'MEGA', android: 'mega.privacy.android.app', command: 'MEGAsync' },
  { id: 'dropbox', label: 'Dropbox', android: 'com.dropbox.android', command: 'Dropbox' },
  { id: 'drive', label: 'Google Drive', android: 'com.google.android.apps.docs', command: 'GoogleDriveFS' },
  { id: 'onedrive', label: 'OneDrive', android: 'com.microsoft.skydrive', command: 'OneDrive' },
  { id: 'nextcloud', label: 'Nextcloud', android: 'com.nextcloud.client', command: 'nextcloud' },
  { id: 'syncthing', label: 'Syncthing', android: 'com.nutomic.syncthingandroid', command: 'syncthing' },
];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDERS.some((provider) => provider.id === value);
}

/**
 * A stored id is whatever an older build or another tab left there, so it is
 * read as untrusted rather than cast — the same rule X-14's theme id follows.
 * `null` is a device that has never named a provider, which is not an error:
 * it is a device with no button.
 */
export function providerOr(value: unknown): Provider | null {
  return PROVIDERS.find((provider) => provider.id === value) ?? null;
}
