<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { formatDateTime } from '@/lib/format.js'
import FlowNextStep from '@/ui/FlowNextStep.vue'

const localItems = ref([])
const localLoading = ref(false)

async function loadQueue() {
  localLoading.value = true
  try {
    const { items: rows } = await fetchPending()
    localItems.value = rows
  } finally {
    localLoading.value = false
  }
}

async function fetchPending() {
  const { registryApi } = await import('@/modules/registry/registry.api.js')
  return registryApi.list({ page: 1, pageSize: 100, status: 'pending' })
}

const TYPE_LABEL = {
  act: 'Акт',
  contract: 'Договор',
  protocol: 'Протокол',
  order: 'Приказ',
  report: 'Отчёт'
}

onMounted(() => {
  loadQueue()
  window.addEventListener('focus', loadQueue)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', loadQueue)
})
</script>

<template>
  <section>
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <h1 class="h3 mb-0">
        Очередь согласования
      </h1>
      <button
        type="button"
        :class="['btn btn-outline-secondary']"
        @click="loadQueue"
      >
        <i class="bi bi-arrow-clockwise me-1" /> Обновить
      </button>
    </div>

    <div :class="['cd-card']">
      <div
        v-if="localLoading"
        class="p-4 text-center text-secondary"
      >
        <span class="spinner-border spinner-border-sm me-2" /> Загрузка…
      </div>
      <div
        v-else-if="!localItems.length"
        class="p-4 text-center text-secondary"
      >
        <i class="bi bi-check2-circle me-1" /> Очередь пуста.
      </div>
      <table
        v-else
        class="table table-hover mb-0 align-middle"
      >
        <thead class="table-light">
          <tr>
            <th>Заголовок</th>
            <th>Тип</th>
            <th>№</th>
            <th>Автор</th>
            <th>Отправлен</th>
            <th class="text-end">
              Действия
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="d in localItems"
            :key="d.id"
          >
            <td>
              <RouterLink :to="`/dashboard/registry/${d.id}`">
                {{ d.title }}
              </RouterLink>
            </td>
            <td class="small text-secondary">
              {{ TYPE_LABEL[d.type] ?? d.type }}
            </td>
            <td class="font-monospace small">
              {{ d.number || '—' }}
            </td>
            <td>{{ d.ownerUsername }}</td>
            <td class="small text-secondary">
              {{ formatDateTime(d.updatedAt) }}
            </td>
            <td class="text-end">
              <RouterLink
                :class="['btn btn-sm btn-primary']"
                :to="`/dashboard/registry/${d.id}`"
              >
                Рассмотреть
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <FlowNextStep />
  </section>
</template>
