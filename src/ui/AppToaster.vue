<script setup>
import { useToast } from './useToast.js'

const { items, dismiss } = useToast()

const ICONS = {
  success: 'bi-check-circle-fill',
  danger: 'bi-exclamation-triangle-fill',
  warning: 'bi-exclamation-circle-fill',
  info: 'bi-info-circle-fill',
  primary: 'bi-bell-fill'
}
</script>

<template>
  <div
    aria-live="polite"
    aria-atomic="true"
    class="toast-container position-fixed top-0 end-0 p-3"
    style="z-index: 1080"
  >
    <transition-group name="toast">
      <div
        v-for="t in items"
        :key="t.id"
        :class="['toast show align-items-center border-0 shadow', `text-bg-${t.variant}`]"
        role="alert"
      >
        <div class="d-flex">
          <div class="toast-body d-flex align-items-center">
            <i :class="['bi me-2 fs-5', ICONS[t.variant]]" />
            <span>{{ t.message }}</span>
          </div>
          <button
            type="button"
            class="btn-close btn-close-white me-2 m-auto"
            aria-label="Закрыть"
            @click="dismiss(t.id)"
          />
        </div>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast {
  min-width: 280px;
  max-width: 420px;
}
.toast + .toast {
  margin-top: 0.5rem;
}
.toast-enter-active,
.toast-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.toast-enter-from {
  transform: translateX(20px);
  opacity: 0;
}
.toast-leave-to {
  transform: translateX(20px);
  opacity: 0;
}
</style>
