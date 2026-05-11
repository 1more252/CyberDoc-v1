<script setup>
import { reactive, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { authApi } from './auth.api.js'
import { useToast } from '@/ui/useToast.js'
import FormField from '@/ui/FormField.vue'

const router = useRouter()
const toast = useToast()

const form = reactive({ username: '', email: '', password: '', password2: '' })
const errors = reactive({ username: '', email: '', password: '', password2: '' })
const submitting = ref(false)

function validate() {
  errors.username = form.username.trim().length >= 3 ? '' : 'Минимум 3 символа'
  errors.email = /\S+@\S+\.\S+/.test(form.email) ? '' : 'Некорректный e-mail'
  errors.password = form.password.length >= 6 ? '' : 'Минимум 6 символов'
  errors.password2 = form.password === form.password2 ? '' : 'Пароли не совпадают'
  return !Object.values(errors).some(Boolean)
}

async function submit() {
  if (!validate()) return
  submitting.value = true
  try {
    await authApi.register({
      username: form.username.trim(),
      email: form.email.trim(),
      password: form.password
    })
    toast.success('Регистрация успешна. Войдите в систему.')
    router.push('/login')
  } catch (e) {
    toast.error(e?.message || 'Не удалось зарегистрироваться.')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div :class="['cd-card p-4']">
    <h1 class="h4 mb-3">
      Регистрация
    </h1>
    <form
      novalidate
      @submit.prevent="submit"
    >
      <FormField
        v-model="form.username"
        label="Логин"
        autocomplete="username"
        required
        :error="errors.username"
      />
      <FormField
        v-model="form.email"
        label="E-mail"
        type="email"
        autocomplete="email"
        required
        :error="errors.email"
      />
      <FormField
        v-model="form.password"
        label="Пароль"
        type="password"
        autocomplete="new-password"
        required
        :error="errors.password"
      />
      <FormField
        v-model="form.password2"
        label="Пароль ещё раз"
        type="password"
        autocomplete="new-password"
        required
        :error="errors.password2"
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
        Зарегистрироваться
      </button>
    </form>
    <p class="text-center text-secondary mt-3 mb-0">
      Уже есть аккаунт?
      <RouterLink to="/login">
        Войти
      </RouterLink>
    </p>
  </div>
</template>
