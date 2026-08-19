// S-18: the one contract suite, run over every adapter that can run in Node.
//
// `fsaa-folder` is not here and cannot be: a directory handle comes from a
// picker, which needs a real user gesture. It is on test.md §3.6's checklist
// instead. `node-folder` is not here either — it has no production caller.

import { createServer, type Server } from 'node:http';
import { afterAll, describe } from 'vitest';
import { androidFolder, type AndroidBridge } from './android-folder';
import { folderContract } from './conformance';
import { httpFolder } from './http-folder';
import { localFolder } from './local-folder';
import { memoryFolder } from './memory-folder';

/** `localStorage` as the spec defines it, since Node has none — not a mock of the adapter. */
class FakeStorage implements Storage {
  private entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }
  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }
  removeItem(key: string): void {
    this.entries.delete(key);
  }
  clear(): void {
    this.entries.clear();
  }
}

/** The Java side of the bridge, in JavaScript — test.md §1's one allowed stand-in. */
function fakeBridge(): AndroidBridge {
  const files = new Map<string, string>();
  return {
    hasFolder: () => true,
    folderName: () => 'Checklist',
    pickFolder: () => {},
    list: () => JSON.stringify([...files.keys()]),
    read: (name) => files.get(name) ?? null,
    write: (name, content) => {
      files.set(name, content);
      return '';
    },
  };
}

/**
 * The helper's four routes, over a Map. The helper itself is Python and is the
 * subject of test.md §3.4; what is under test here is the adapter's half of the
 * wire — a 404 read answering null, a PUT round-tripping, `list` returning
 * FileMeta whose `path` is a name.
 *
 * Port 0, not this project's 38531: that port belongs to the helper and to the
 * dev server, and a test that took it would fail whenever one was running.
 */
async function startHelper(): Promise<{ base: string; server: Server; clear: () => void }> {
  const files = new Map<string, string>();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const send = (status: number, body: string, type = 'application/json') => {
      response.writeHead(status, { 'content-type': type });
      response.end(body);
    };

    if (url.pathname === '/folder/info') {
      return send(200, JSON.stringify({ configured: true, name: 'Checklist' }));
    }
    if (url.pathname === '/folder/list') {
      return send(200, JSON.stringify([...files.keys()].map((path) => ({ path }))));
    }
    if (url.pathname.startsWith('/folder/file/')) {
      const name = decodeURIComponent(url.pathname.slice('/folder/file/'.length));
      if (request.method === 'PUT') {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          files.set(name, Buffer.concat(chunks).toString('utf8'));
          send(200, JSON.stringify({ path: name }));
        });
        return;
      }
      const content = files.get(name);
      if (content === undefined) return send(404, '{}');
      return send(200, content, 'text/plain; charset=utf-8');
    }
    send(404, '{}');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { base: `http://127.0.0.1:${port}/folder`, server, clear: () => files.clear() };
}

describe('folder adapter contract', () => {
  folderContract({ name: 'memory-folder', open: () => memoryFolder() });

  folderContract({ name: 'local-folder', open: () => localFolder(new FakeStorage()) });

  folderContract({ name: 'android-folder', open: () => androidFolder(fakeBridge()) });

  const helper = startHelper();
  folderContract({
    name: 'http-folder',
    open: async () => {
      const { base, clear } = await helper;
      clear();
      return httpFolder(base);
    },
  });
  afterAll(async () => {
    const { server } = await helper;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
