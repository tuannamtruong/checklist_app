import { describe, expect, it } from 'vitest';
import { KEY_BOUND_ACTIONS, KEY_HELP } from './keyboard';

describe('the keyboard reference — X-33', () => {
  it('teaches every key this file binds, so the settings screen is the whole list', () => {
    const taught = KEY_HELP.map((entry) => entry.action).filter((name) => name !== undefined);
    for (const bound of KEY_BOUND_ACTIONS) {
      expect(taught, `${bound} is bound to a key and taught nowhere`).toContain(bound);
    }
  });

  it('teaches nothing it does not bind, apart from the keys that are not edits', () => {
    // The caret keys and `/` resolve to no action: moving and navigating are not
    // edits, so they carry no name and are the only entries without one.
    const untaught = KEY_HELP.filter((entry) => entry.action === undefined).map((e) => e.keys);
    expect(untaught).toEqual(['↑ / ↓', 'Escape', '/']);
  });

  it('says something for every entry, or the screen shows a blank row', () => {
    for (const entry of KEY_HELP) {
      expect(entry.keys.length, JSON.stringify(entry)).toBeGreaterThan(0);
      expect(entry.label.length, JSON.stringify(entry)).toBeGreaterThan(0);
    }
  });
});
