<script setup>
import { reactive, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from './auth.store.js'
import { useToast } from '@/ui/useToast.js'
import FormField from '@/ui/FormField.vue'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const toast = useToast()

const form = reactive({ username: '', password: '' })
const errors = reactive({ username: '', password: '' })
const submitting = ref(false)

function validate() {
  errors.username = form.username.trim() ? '' : 'Введите логин'
  errors.password = form.password ? '' : 'Введите пароль'
  return !errors.username && !errors.password
}

async function submit() {
  if (!validate()) return
  submitting.value = true
  try {
    await auth.login({ username: form.username.trim(), password: form.password })
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : null
    router.push(redirect || roleHome())
  } catch (e) {
    if (e?.message === 'blocked') toast.error('Учётная запись заблокирована.')
    else if (e?.message === 'not_verified') toast.error('Аккаунт не подтверждён.')
    else toast.error(e?.message || 'Не удалось войти.')
  } finally {
    submitting.value = false
  }
}

function roleHome() {
  switch (auth.role) {
    case 'admin':
      return '/dashboard/admin/users'
    case 'expert':
      return '/dashboard/expert'
    case 'user':
      return '/dashboard/user'
    default:
      return '/'
  }
}
</script>

<template>
  <div :class="['cd-card p-4']">
    <h1 class="h4 mb-3">
      Вход
    </h1>
    <form
      novalidate
      @submit.prevent="submit"
    >
      <FormField
        v-model="form.username"
        label="Логин"
        name="username"
        autocomplete="username"
        required
        :error="errors.username"
      />
      <FormField
        v-model="form.password"
        label="Пароль"
        name="password"
        type="password"
        autocomplete="current-password"
        required
        :error="errors.password"
      />
      <button
        type="submit"
        :class="['btn btn-primary w-100']"
        :disabled="submitting"
      >
        <span
          v-if="submitting"
          class="spinner-border spinner-border-sm me-2"
        />
        Войти
      </button>
    </form>
    <p class="text-center text-secondary mt-3 mb-0">
      Нет аккаунта?
      <RouterLink to="/register">
        Регистрация
      </RouterLink>
    </p>
  </div>
</template>
