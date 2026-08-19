// A folder reached through this device's own loopback helper — the Firefox
// path, architecture.md §7.1.
//
// Firefox and Safari have no File System Access API and are not getting one:
// handing a web page a real directory is authority they have decided not to
// grant. So the process that served the page hands the folder over instead.
//
// It is not a sync server and cannot become one. It binds 127.0.0.1, no other
// device can reach it, and no device ever syncs *through* it — two devices
// could run different helpers, or none, and converge identically, because the
// only thing they share is the folder.

import type { FolderAdapter } from '../core/folder';

/** The helper's own prefix, on the origin that served the page. */
const BASE = '/folder';

export interface HelperInfo {
  configured: boolean;
  /** The folder's own name, never a path assembled here — code-standard.md §1. */
  name?: string;
}

interface FileMeta {
  path: string;
}

export class HttpFolderError extends Error {
  constructor(action: string, name: string, status: number | string) {
    super(`folder helper: ${action} ${name} failed: ${status}`);
    this.name = 'HttpFolderError';
  }
}

/**
 * "Is there a helper, and does it have a folder?" — the one question startup
 * asks it. A page served from anywhere else answers no by failing to connect,
 * which is not an error worth showing.
 */
export async function helperInfo(base = BASE): Promise<HelperInfo> {
  try {
    const response = await fetch(`${base}/info`);
    if (!response.ok) return { configured: false };
    return (await response.json()) as HelperInfo;
  } catch {
    return { configured: false };
  }
}

export function httpFolder(base = BASE): FolderAdapter {
  const fileUrl = (name: string) => `${base}/file/${encodeURIComponent(name)}`;

  return {
    async list() {
      const response = await fetch(`${base}/list?prefix=`);
      if (!response.ok) throw new HttpFolderError('listing', base, response.status);
      const metas = (await response.json()) as FileMeta[];
      return metas.map((meta) => meta.path);
    },

    async read(name) {
      const response = await fetch(fileUrl(name));
      if (response.status === 404) return null;
      if (!response.ok) throw new HttpFolderError('reading', name, response.status);
      return await response.text();
    },

    async write(name, content) {
      const response = await fetch(fileUrl(name), {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: content,
      });
      if (!response.ok) throw new HttpFolderError('writing', name, response.status);
    },
  };
}
