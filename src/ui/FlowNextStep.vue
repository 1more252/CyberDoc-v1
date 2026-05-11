<script setup>
import { RouterLink } from 'vue-router'
import { useFlow } from '@/flow/flow.js'

const props = defineProps({
  
  basePath: { type: String, default: undefined }
})

const { nextStep, stepNumber, totalSteps } = useFlow(props.basePath)
</script>

<template>
  <RouterLink
    v-if="nextStep"
    :to="nextStep.to"
    :class="['cd-flow-next d-flex align-items-center gap-3 p-3 mt-4 text-decoration-none border rounded']"
  >
    <i :class="['bi fs-3 text-primary', nextStep.icon]" />
    <div class="flex-grow-1">
      <div class="small text-secondary">
        Следующий шаг ({{ stepNumber + 1 }}/{{ totalSteps }})
      </div>
      <div class="fw-semibold">
        {{ nextStep.label }}
      </div>
      <div
        v-if="nextStep.hint"
        class="small text-muted"
      >
        {{ nextStep.hint }}
      </div>
    </div>
    <i class="bi bi-arrow-right fs-4 text-primary" />
  </RouterLink>
</template>

<style scoped>
.cd-flow-next {
  background: #fff;
  color: inherit;
  transition: box-shadow 0.15s ease, transform 0.15s ease;
}
.cd-flow-next:hover {
  box-shadow: 0 0.25rem 0.75rem rgba(13, 110, 253, 0.12);
  transform: translateY(-1px);
}
</style>
