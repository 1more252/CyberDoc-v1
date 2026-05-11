<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '@/modules/auth/auth.store.js'

const auth = useAuthStore()

const roleHome = computed(() => {
  switch (auth.role) {
    case 'admin':
      return '/dashboard/admin/users'
    case 'expert':
      return '/dashboard/expert'
    case 'user':
      return '/dashboard/user'
    default:
      return null
  }
})
</script>

<template>
  <section class="py-5 text-center">
    <h1 class="display-5 fw-bold text-primary">
      КиберДок
    </h1>
    <p class="lead text-secondary mb-4">
      Учёт организаций, оборудования и документооборот с массовой генерацией DOCX.
    </p>
    <div class="d-flex gap-2 justify-content-center">
      <template v-if="!auth.isAuthenticated">
        <RouterLink
          :class="['btn btn-primary']"
          to="/login"
        >
          Войти
        </RouterLink>
        <RouterLink
          :class="['btn btn-outline-primary']"
          to="/register"
        >
          Регистрация
        </RouterLink>
      </template>
      <RouterLink
        v-else-if="roleHome"
        :class="['btn btn-primary']"
        :to="roleHome"
      >
        В кабинет
      </RouterLink>
    </div>
  </section>
</template>
