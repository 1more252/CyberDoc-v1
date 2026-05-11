<script setup>
import { RouterView } from 'vue-router'
import AppNavbar from '@/ui/AppNavbar.vue'
</script>

<template>
  <div class="d-flex flex-column min-vh-100">
    <AppNavbar />
    <main class="flex-grow-1">
      <div class="container cd-page py-4">
        <RouterView />
      </div>
    </main>
    <footer class="border-top py-3 text-center text-secondary small bg-body-tertiary">
      © {{ new Date().getFullYear() }} КиберДок
    </footer>
  </div>
</template>
