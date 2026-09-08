import { describe, expect, it } from 'vitest';
import { hrefOf, routeOf, TODAY_HREF, TOMORROW_HREF } from './router.svelte';

describe('the two day routes — G-7', () => {
  it('are routes of their own rather than one carrying which list', () => {
    expect(routeOf('#/today')).toEqual({ name: 'today' });
    expect(routeOf('#/tomorrow')).toEqual({ name: 'tomorrow' });
    expect(TODAY_HREF).toBe('#/today');
    expect(TOMORROW_HREF).toBe('#/tomorrow');
  });

  it('round-trip, so a nav entry and a deep link are the same thing — X-8', () => {
    for (const hash of ['#/today', '#/tomorrow', '#/done', '#/', '#/n/n_1']) {
      expect(hrefOf(routeOf(hash))).toBe(hash);
    }
  });

  it('leave anything else to the recovery page — X-11', () => {
    expect(routeOf('#/yesterday')).toEqual({ name: 'unknown', hash: '/yesterday' });
  });
});
