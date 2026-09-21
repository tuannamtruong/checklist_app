// The device id, and the local state that must never converge.
//
// The id is generated, never typed by the user, and it names the one file this
// device writes — architecture.md §5. It lives in `localStorage`, so it is
// per-origin: one machine reached through the hosted PWA and through the
// loopback bundle is two devices, and the design tolerates that rather than
// fighting it.

import { autoDeviceName } from '../core/device-name';
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

/**
 * D-5. What this device calls itself until somebody types something better.
 * The user-agent string is read here rather than in `core/`, which has no
 * `window` and no environment of any kind — the shape of the name is core's,
 * and the one fact about this machine is this layer's.
 */
export function suggestedDeviceName(
  id: DeviceId,
  userAgent: string = navigator.userAgent,
): string {
  return autoDeviceName(userAgent, id);
}

/** Node ids are minted by the creating device and never reused — §2.1. */
export function mintNodeId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return 'n_' + [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
