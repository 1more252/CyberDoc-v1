<script setup>
import { RouterLink } from 'vue-router'
</script>

<template>
  <section class="py-5 text-center">
    <i class="bi bi-question-circle display-1 text-secondary" />
    <h1 class="mt-3">
      404 — Страница не найдена
    </h1>
    <p class="text-secondary">
      Возможно, ссылка устарела или была удалена.
    </p>
    <RouterLink
      :class="['btn btn-primary']"
      to="/"
    >
      На главную
    </RouterLink>
  </section>
</template>
