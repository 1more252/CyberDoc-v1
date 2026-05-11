import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

/**
 * Vite-конфиг.
 *
 * Алиас `@` указывает в `src` — единственный «магический» путь, чтобы
 * импорты не превращались в `../../../...`. Остальные импорты — относительные
 * внутри модуля.
 *
 * `optimizeDeps.exclude` для docx-воркера: docx загружается только в Web
 * Worker (массовая генерация), и Vite не должен пытаться pre-bundle его в
 * основной thread.
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  worker: {
    format: 'es'
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true
      }
    }
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800
  }
})
