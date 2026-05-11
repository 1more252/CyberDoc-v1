<script setup>
import { RouterLink } from 'vue-router'
import { useAuthStore } from '@/modules/auth/auth.store.js'
import FlowNextStep from '@/ui/FlowNextStep.vue'

const auth = useAuthStore()
</script>

<template>
  <section>
    <h1 class="h3 mb-1">
      Здравствуйте, {{ auth.user?.username }}
    </h1>
    <p class="text-secondary">
      Это ваш кабинет. Двигайтесь по чек-листу слева.
    </p>
    <div class="row g-3 mt-2">
      <div class="col-md-6">
        <RouterLink
          :class="['cd-card p-3 d-block text-decoration-none']"
          to="/dashboard/organizations"
        >
          <i class="bi bi-building fs-3 text-primary" />
          <div class="fw-semibold mt-2">
            Организации
          </div>
          <div class="small text-secondary">
            Юр. лица и ИП.
          </div>
        </RouterLink>
      </div>
      <div class="col-md-6">
        <RouterLink
          :class="['cd-card p-3 d-block text-decoration-none']"
          to="/dashboard/registry"
        >
          <i class="bi bi-clipboard-data fs-3 text-primary" />
          <div class="fw-semibold mt-2">
            Документы
          </div>
          <div class="small text-secondary">
            Реестр и подписание.
          </div>
        </RouterLink>
      </div>
    </div>
    <FlowNextStep />
  </section>
</template>
