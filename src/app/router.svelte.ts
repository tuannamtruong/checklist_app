// Hash routing — X-7. The fragment never reaches the server, so the app deploys
// to any static host with no rewrite rules, and a deep link survives a cold
// launch from a home-screen icon because the document request is always
// index.html — X-8.

import type { NodeId } from '../core/types';

export type Route =
  | { name: 'root' }
  | { name: 'node'; id: NodeId }
  | { name: 'done' }
  | { name: 'conflicts' }
  | { name: 'search'; query: string }
  | { name: 'settings' }
  | { name: 'devices' }
  | { name: 'logs' }
  | { name: 'unknown'; hash: string };

export function routeOf(hash: string): Route {
  const path = hash.replace(/^#/, '');
  if (path === '' || path === '/') return { name: 'root' };
  if (path === '/done') return { name: 'done' };
  if (path === '/conflicts') return { name: 'conflicts' };
  if (path === '/settings') return { name: 'settings' };
  if (path === '/devices') return { name: 'devices' };
  if (path === '/logs') return { name: 'logs' };
  // F-5. The query is a path segment rather than a query string, for the reason
  // X-7 already gives: it stays in the fragment, so a result list is linkable
  // and survives a cold launch without any of it reaching a server.
  if (path === '/search') return { name: 'search', query: '' };
  const search = /^\/search\/(.*)$/.exec(path);
  if (search) return { name: 'search', query: decodeURIComponent(search[1]!) };
  const node = /^\/n\/([^/]+)$/.exec(path);
  if (node) return { name: 'node', id: decodeURIComponent(node[1]!) };
  return { name: 'unknown', hash: path };
}

export function hrefOf(route: Route): string {
  switch (route.name) {
    case 'root':
      return '#/';
    case 'node':
      return `#/n/${encodeURIComponent(route.id)}`;
    case 'done':
      return '#/done';
    case 'conflicts':
      return '#/conflicts';
    case 'search':
      return route.query === '' ? '#/search' : `#/search/${encodeURIComponent(route.query)}`;
    case 'settings':
      return '#/settings';
    case 'devices':
      return '#/devices';
    case 'logs':
      return '#/logs';
    case 'unknown':
      return `#${route.hash}`;
  }
}

/** T-12's view, always in the nav — see requirements.md §5 Navigation and routing. */
export const DONE_HREF = hrefOf({ name: 'done' });

/**
 * §9's view, in the nav only when it has rows. It is still routable when it does
 * not, so a link to it answers "nothing to report" rather than the recovery page.
 */
export const CONFLICTS_HREF = hrefOf({ name: 'conflicts' });

/** §6's view and X-12's, both permanent in the nav — see requirements.md §5. */
export const SEARCH_HREF = hrefOf({ name: 'search', query: '' });
export const SETTINGS_HREF = hrefOf({ name: 'settings' });

/**
 * §8's view and D-4's. Neither is in the nav: both say something about *this*
 * device rather than about the tree, and `#/settings` is where this device is
 * already the subject — requirements.md §5.
 */
export const DEVICES_HREF = hrefOf({ name: 'devices' });
export const LOGS_HREF = hrefOf({ name: 'logs' });

export function nodeHref(id: NodeId): string {
  return hrefOf({ name: 'node', id });
}

export function searchHref(query: string): string {
  return hrefOf({ name: 'search', query });
}

export class Router {
  route = $state<Route>({ name: 'root' });

  constructor() {
    this.route = routeOf(window.location.hash);
    window.addEventListener('hashchange', () => {
      this.route = routeOf(window.location.hash);
    });
  }

  go(route: Route): void {
    window.location.hash = hrefOf(route);
  }
}
