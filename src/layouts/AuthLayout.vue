<script setup>
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="d-flex flex-column min-vh-100 bg-body-secondary">
    <header class="py-3 border-bottom bg-white">
      <div class="container">
        <RouterLink
          to="/"
          :class="['cd-brand text-decoration-none text-primary']"
        >
          <span class="cd-brand__mark">К</span>
          КиберДок
        </RouterLink>
      </div>
    </header>
    <main class="flex-grow-1 d-flex align-items-center">
      <div class="container">
        <div class="row justify-content-center">
          <div class="col-12 col-sm-10 col-md-7 col-lg-5">
            <RouterView />
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
