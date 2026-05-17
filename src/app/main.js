import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router.js'
import { useAuthStore } from '@/modules/auth/auth.store.js'
import { setupErrorReporting } from '@/lib/error-reporter.js'

import '@/assets/main.scss'

const app = createApp(App)

// Глобальный сбор ошибок ставим первым: Vue.errorHandler должен быть назначен
// до маунта любого компонента, window-listeners — до старта async work.
setupErrorReporting(app)

app.use(createPinia())
app.use(router)

useAuthStore().hydrate()

app.mount('#app')
