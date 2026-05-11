<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import GuestLayout from '@/layouts/GuestLayout.vue'
import AuthLayout from '@/layouts/AuthLayout.vue'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import AppToaster from '@/ui/AppToaster.vue'
import AppConfirm from '@/ui/AppConfirm.vue'

const route = useRoute()

const layout = computed(() => {
  switch (route.meta?.layout) {
    case 'auth':
      return AuthLayout
    case 'dashboard':
      return DashboardLayout
    default:
      return GuestLayout
  }
})
</script>

<template>
  <component :is="layout" />
  <AppToaster />
  <AppConfirm />
</template>
