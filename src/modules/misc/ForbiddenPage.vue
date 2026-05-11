<script setup>
import { RouterLink } from 'vue-router'
</script>

<template>
  <section class="py-5 text-center">
    <i class="bi bi-shield-lock display-1 text-danger" />
    <h1 class="mt-3">
      403 — Доступ запрещён
    </h1>
    <p class="text-secondary">
      У вас нет прав на просмотр этой страницы.
    </p>
    <RouterLink
      :class="['btn btn-primary']"
      to="/"
    >
      На главную
    </RouterLink>
  </section>
</template>
