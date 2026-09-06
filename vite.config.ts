import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwind from '@tailwindcss/vite';
import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// Port 38531 is this project's, and the loopback helper the Firefox bundle ships
// binds it too — the two are never run together, and pinning it keeps the
// http-folder adapter's origin the same in development as in that bundle.
const PORT = 38531;

// A service worker installed by the bundle or by `make preview` is still in
// charge in development, because all three are the same origin — the port is
// pinned for exactly that reason. It answers navigations out of its precache,
// so the dev server runs and the browser never asks it anything: the app looks
// frozen at whatever was last built, which is X-6's "next launch" promise being
// kept about the wrong thing.
//
// So development serves a worker of its own at that URL whose only job is to
// remove itself. The browser rechecks the script on every navigation, sees a
// different one and installs it; this one does not wait its turn, because the
// waiting X-6 wants is about a *new build*, not about a worker that exists to
// leave. It empties every cache, unregisters, and reloads the pages it was
// holding — one reload and the dev server is reachable again.
//
// `configureServer` only, never `configurePreviewServer`: `make preview` and
// `make ui-smoke` serve the real `dist/sw.js`, and X-5's offline cold start is
// that worker doing its job.
const SELF_DESTRUCT_SW = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    for (const client of windows) client.navigate(client.url);
  })());
});
`;

function devUnregisterServiceWorker(): Plugin {
  return {
    name: 'checklist:dev-unregister-sw',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? '').split('?')[0] !== '/sw.js') return next();
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Service-Worker-Allowed', '/');
        res.end(SELF_DESTRUCT_SW);
      });
    },
  };
}

export default defineConfig({
  // Relative, so the same bundle works from a static host, from the loopback
  // helper and from the Android WebView's asset loader, which serve it at
  // different roots — architecture.md §7 Packaging.
  base: './',
  plugins: [
    svelte(),
    tailwind(),
    devUnregisterServiceWorker(),
    VitePWA({
      // X-6: a new build takes effect on next launch. The waiting worker is not
      // told to skipWaiting, so it activates when the last tab closes — no
      // prompt, and no reload under the user's hands mid-edit.
      registerType: 'prompt',
      injectRegister: 'auto',
      manifest: {
        name: 'Checklist',
        short_name: 'Checklist',
        description: 'Checklists and notes, on every device, through a folder.',
        theme_color: '#1f2937',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: './index.html',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          // X-4: padded to the 80% safe zone, so a launcher's mask cannot clip it.
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // X-5: everything the app needs is precached, so a cold start offline is
        // the same start as any other. There are no API calls to fall back to.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // X-8: a deep link like #/n/<id> is one document request for index.html;
        // the fragment never reaches the network.
        navigateFallback: 'index.html',
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: PORT, strictPort: true },
  preview: { port: PORT, strictPort: true },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
