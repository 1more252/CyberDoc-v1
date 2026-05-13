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
    // На Windows Vite по умолчанию биндится на IPv6 (::1), а curl/браузер
    // через localhost резолвят в IPv4 (127.0.0.1) — получается «страница
    // недоступна». Явно фиксируем IPv4-loopback.
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true
      }
    }
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // Vendor-split: bootstrap/иконки кешируются отдельно от кода,
        // axios/vue/pinia — отдельным «фреймворковым» чанком.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.match(/node_modules[\\/](@vue[\\/]|vue[\\/]|vue-router|pinia)/))
            return 'framework'
          if (id.includes('axios')) return 'http'
          if (id.includes('docx')) return 'docx'
          return 'vendor'
        }
      }
    }
  }
})
