import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 部署於 https://<user>.github.io/lglearning/，
// 因此 production build 的 base 必須是 repo 名稱；本地 dev 用 '/'
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/lglearning/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: '家庭語言學習',
        short_name: '語言學習',
        description: '家庭自用語言學習 App：英文、日文、台語、古文',
        lang: 'zh-TW',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        // 古文原文與夾註各約 190KB（gzip），不預先下載，
        // 改成「第一次進古文才抓，抓過就永久離線可用」
        globIgnores: ['**/classicalTexts-*.js', '**/classicalNotes-*.js'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/classical(Texts|Notes)-[\w-]+\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'classical-texts',
              expiration: { maxEntries: 8 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
}))
