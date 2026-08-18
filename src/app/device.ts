// The device id, and the local state that must never converge.
//
// The id is generated, never typed by the user, and it names the one file this
// device writes — architecture.md §5. It lives in `localStorage`, so it is
// per-origin: one machine reached through the hosted PWA and through the
// loopback bundle is two devices, and the design tolerates that rather than
// fighting it.

import type { DeviceId } from '../core/types';

const DEVICE_KEY = 'checklist.device';

function mintDeviceId(): DeviceId {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function deviceId(storage: Storage = window.localStorage): DeviceId {
  const stored = storage.getItem(DEVICE_KEY);
  if (stored && /^[0-9a-f]{8}$/.test(stored)) return stored;
  const minted = mintDeviceId();
  storage.setItem(DEVICE_KEY, minted);
  return minted;
}

/** Node ids are minted by the creating device and never reused — §2.1. */
export function mintNodeId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return 'n_' + [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
