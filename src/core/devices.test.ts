// requirements.md §8. D-3 is the claim worth testing here — the list tolerates
// a header that says nothing, because every file M2 wrote is one.

import { describe, expect, it } from 'vitest';
import { devicesOf, labelOf, nameOf } from './devices';

const OURS = 'aaaa0001';
const PEER = 'bbbb0002';
const GONE = 'cccc0003';

describe('devicesOf', () => {
  it('names a device from its own header — D-1', () => {
    const devices = devicesOf(
      [
        { dev: OURS, name: 'laptop', at: 5_000 },
        { dev: PEER, name: 'phone', at: 4_000 },
      ],
      { [OURS]: 3, [PEER]: 2 },
      OURS,
    );
    expect(devices.map((device) => device.name)).toEqual(['laptop', 'phone']);
    expect(devices[0]!.self).toBe(true);
    expect(devices[1]!.lastSeen).toBe(4_000);
  });

  it('accepts a header carrying neither field — D-3', () => {
    // Every file M2 wrote is this shape, so an unnamed device is a state rather
    // than an error, and nothing in the merge path ever asked.
    const devices = devicesOf([{ dev: OURS }], { [OURS]: 1 }, OURS);
    expect(devices[0]).toMatchObject({ id: OURS, name: '', lastSeen: null, absent: false });
    expect(labelOf(devices[0]!)).toBe(OURS);
  });

  it('lists a device that only exists as a counter in the vector', () => {
    // sync-flow.md §4.6 never prunes a counter, so a device whose file has gone
    // is still the device a conflict row names.
    const devices = devicesOf([{ dev: OURS, name: 'laptop' }], { [OURS]: 3, [GONE]: 9 }, OURS);
    expect(devices.map((device) => device.id)).toEqual([OURS, GONE]);
    expect(devices[1]!.absent).toBe(true);
  });

  it('puts this device first, then sorts by what each is called', () => {
    const devices = devicesOf(
      [
        { dev: PEER, name: 'zebra' },
        { dev: GONE, name: 'aardvark' },
        { dev: OURS, name: 'middle' },
      ],
      {},
      OURS,
    );
    expect(devices.map((device) => device.name)).toEqual(['middle', 'aardvark', 'zebra']);
  });

  it('includes this device even before it has written anything', () => {
    expect(devicesOf([], {}, OURS).map((device) => device.id)).toEqual([OURS]);
  });
});

describe('nameOf', () => {
  const devices = devicesOf([{ dev: PEER, name: 'phone' }, { dev: GONE }], {}, OURS);

  it('gives a conflict row a name instead of eight hex characters', () => {
    expect(nameOf(devices, PEER)).toBe('phone');
  });

  it('falls back to the id, which is all an unnamed device has', () => {
    expect(nameOf(devices, GONE)).toBe(GONE);
    expect(nameOf(devices, 'dddd0004')).toBe('dddd0004');
  });
});
