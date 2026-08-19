// X-17. Which cloud client keeps this device's folder in sync, remembered on
// this device only — requirements.md §2.3.
//
// It is a label and nothing more: the merge, the adapter and the file format
// never learn it, and a device that has never named one simply has no button.
// It sits beside the theme (X-14) rather than in a file for the same reason —
// the laptop's provider and the phone's are different apps for one folder.

import { providerOr, type Provider, type ProviderId } from '../core/providers';

const PROVIDER_KEY = 'checklist.provider';

export function storedProvider(storage: Storage = window.localStorage): Provider | null {
  return providerOr(storage.getItem(PROVIDER_KEY));
}

export function rememberProvider(
  id: ProviderId | null,
  storage: Storage = window.localStorage,
): void {
  if (id === null) storage.removeItem(PROVIDER_KEY);
  else storage.setItem(PROVIDER_KEY, id);
}
