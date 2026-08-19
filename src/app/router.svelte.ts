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
  | { name: 'unknown'; hash: string };

export function routeOf(hash: string): Route {
  const path = hash.replace(/^#/, '');
  if (path === '' || path === '/') return { name: 'root' };
  if (path === '/done') return { name: 'done' };
  if (path === '/conflicts') return { name: 'conflicts' };
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

export function nodeHref(id: NodeId): string {
  return hrefOf({ name: 'node', id });
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
