import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'fonts/*.woff2'],
      manifest: {
        name: 'CubeRoom — Multiplayer Cube Timer',
        short_name: 'CubeRoom',
        description: 'Same scramble. Fastest hands win.',
        theme_color: '#F0EEEA',
        background_color: '#F0EEEA',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'en',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  // Preserve cubing's module boundaries: the nested search worker must never
  // import and execute this app's outer worker entry.
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          const dependency = id.split('/node_modules/')[1];
          return dependency ? dependency.replace(/[^a-zA-Z0-9_-]/g, '-') : undefined;
        },
      },
    },
  },
});
