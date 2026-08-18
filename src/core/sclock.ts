// Version vector arithmetic — the `sClock` of glossary.md. Comparing two
// vectors both ways classifies two replicas as ahead, behind, equal or
// concurrent, which is how a race is detected rather than prevented.
//
// A vector is never pruned. An absent counter means zero, which is
// indistinguishable from never having seen that device, so dropping a folded-in
// device turns agreement into a false race — sync-flow.md §4.6.

import type { DeviceId, SClock } from './types';

export function counterOf(clock: SClock, device: DeviceId): number {
  return clock[device] ?? 0;
}

export function bump(clock: SClock, device: DeviceId): SClock {
  return { ...clock, [device]: counterOf(clock, device) + 1 };
}

export function withCounter(clock: SClock, device: DeviceId, counter: number): SClock {
  return { ...clock, [device]: Math.max(counterOf(clock, device), counter) };
}

/** The pointwise maximum: what a replica knows after reading another. */
export function join(a: SClock, b: SClock): SClock {
  const joined: Record<DeviceId, number> = { ...a };
  for (const device of Object.keys(b)) {
    joined[device] = Math.max(counterOf(a, device), counterOf(b, device));
  }
  return joined;
}

function devicesOf(a: SClock, b: SClock): Set<DeviceId> {
  return new Set([...Object.keys(a), ...Object.keys(b)]);
}

/** True when `a` has seen everything `b` has. */
export function dominates(a: SClock, b: SClock): boolean {
  for (const device of devicesOf(a, b)) {
    if (counterOf(a, device) < counterOf(b, device)) return false;
  }
  return true;
}

export function equal(a: SClock, b: SClock): boolean {
  return dominates(a, b) && dominates(b, a);
}

/** Neither has seen everything the other has — the race S-5 detects. */
export function concurrent(a: SClock, b: SClock): boolean {
  return !dominates(a, b) && !dominates(b, a);
}
