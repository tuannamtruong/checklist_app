// requirements.md §8 — the device list, derived from the header lines and
// nothing else.
//
// D-3 is what this file is for, and it is structural rather than promised:
// `name` and `at` are read here and in no other module, and neither `merge.ts`
// nor `materialise.ts` imports this one. A header carrying neither field is a
// device nobody has named yet, which is a state rather than an error — every
// file M2 wrote is one.
//
// D-1's name rides the header of the file the device already owns, so the
// device that minted the id is the only writer of its name. That keeps naming
// inside the one-writer-per-file rule (S-3) and leaves it with no merge rule at
// all — past_decision.md §8.

import type { DeviceId, SClock } from './types';

export interface DeviceRecord {
  id: DeviceId;
  /** What the user called it, or the empty string while nobody has. */
  name: string;
  /** D-2. When the device last wrote its file, or null in a file predating M3. */
  lastSeen: number | null;
  /** This device, which is the only one whose name can be edited here. */
  self: boolean;
  /**
   * True when the only evidence for this device is a counter in somebody's
   * vector. Its file is not in the folder — retired, or never synced here.
   */
  absent: boolean;
}

/** One device's header, as the folder holds it. */
export interface DeviceHeader {
  dev: DeviceId;
  name?: string;
  at?: number;
}

/** Never shown; a device with no name shows its id, which is what it has. */
export function labelOf(device: DeviceRecord): string {
  return device.name || device.id;
}

/**
 * Every device the folder knows about, this one first and then by name.
 *
 * The vector is read as well as the headers, because a device whose file has
 * gone still owns a counter in every peer's vector and is still the device a
 * conflict row names. sync-flow.md §4.6 never prunes those counters, so this is
 * the complete list by construction.
 */
export function devicesOf(
  headers: readonly DeviceHeader[],
  clock: SClock,
  self: DeviceId,
): DeviceRecord[] {
  const byId = new Map<DeviceId, DeviceRecord>();
  for (const id of Object.keys(clock)) {
    byId.set(id, { id, name: '', lastSeen: null, self: id === self, absent: true });
  }
  for (const header of headers) {
    byId.set(header.dev, {
      id: header.dev,
      name: header.name ?? '',
      lastSeen: header.at ?? null,
      self: header.dev === self,
      absent: false,
    });
  }
  if (!byId.has(self)) {
    byId.set(self, { id: self, name: '', lastSeen: null, self: true, absent: false });
  }

  return [...byId.values()].sort((a, b) => {
    if (a.self !== b.self) return a.self ? -1 : 1;
    const left = labelOf(a);
    const right = labelOf(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/** What a conflict row calls a device — D-1 closing §15's row 9. */
export function nameOf(devices: readonly DeviceRecord[], id: DeviceId): string {
  return devices.find((device) => device.id === id)?.name || id;
}
