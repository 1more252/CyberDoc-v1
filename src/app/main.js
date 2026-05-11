import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router.js'
import { useAuthStore } from '@/modules/auth/auth.store.js'

import '@/assets/main.scss'

const app = createApp(App)

app.use(createPinia())
app.use(router)

useAuthStore().hydrate()

app.mount('#app')
