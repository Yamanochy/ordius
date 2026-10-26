import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Рабочее приложение Ordius. Собирается в app/dist; ordius-deploy раскладывает его в pb_public,
// и PocketBase отдаёт его по адресу https://app.ordius.ru — тот же адрес, что и API.
// Для разработки: VITE_PB_URL=http://127.0.0.1:8090 npm run dev
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'fonts/*.woff2', 'fonts/fonts.css'],
      manifest: {
        name: 'Ordius',
        short_name: 'Ordius',
        description: 'Смены, техника и зарплата водителей',
        lang: 'ru',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#1C2129',
        theme_color: '#1C2129',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // приложение открывается и без связи; данные API никогда не кэшируются сервис-воркером
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/_\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  base: '/',
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
