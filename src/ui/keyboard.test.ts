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
    // Escape and `/` resolve to no action: discarding a draft and navigating are
    // not edits, so they carry no name and are the only entries without one. The
    // caret keys are bound and taught nowhere at all — ↑ and ↓ move a caret the
    // way every other field on the machine does, and the screen says what is
    // particular to this app.
    const untaught = KEY_HELP.filter((entry) => entry.action === undefined).map((e) => e.keys);
    expect(untaught).toEqual(['Escape', '/']);
    expect(KEY_HELP.map((entry) => entry.keys)).not.toContain('↑ / ↓');
  });

  it('says something for every entry, or the screen shows a blank row', () => {
    for (const entry of KEY_HELP) {
      expect(entry.keys.length, JSON.stringify(entry)).toBeGreaterThan(0);
      expect(entry.label.length, JSON.stringify(entry)).toBeGreaterThan(0);
    }
  });
});
