import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwind from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// Port 38531 is this project's, and the loopback helper the Firefox bundle ships
// binds it too — the two are never run together, and pinning it keeps the
// http-folder adapter's origin the same in development as in that bundle.
const PORT = 38531;

export default defineConfig({
  // Relative, so the same bundle works from a static host, from the loopback
  // helper and from the Android WebView's asset loader, which serve it at
  // different roots — architecture.md §7 Packaging.
  base: './',
  plugins: [
    svelte(),
    tailwind(),
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
