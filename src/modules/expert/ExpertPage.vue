<script setup>
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { adminApi } from '@/modules/admin/admin.api.js'
import { registryApi } from '@/modules/registry/registry.api.js'
import { useToast } from '@/ui/useToast.js'
import { formatDateTime } from '@/lib/format.js'

const toast = useToast()

const stats = ref(null)
const loading = ref(false)
const pendingPreview = ref([])
const previewLoading = ref(false)

async function loadStats() {
  loading.value = true
  try {
    stats.value = await adminApi.statistics()
  } catch (e) {
    toast.error(e?.message || 'Не удалось загрузить статистику.')
  } finally {
    loading.value = false
  }
}

async function loadPreview() {
  previewLoading.value = true
  try {
    const res = await registryApi.list({ page: 1, pageSize: 5, status: 'pending' })
    pendingPreview.value = res.items
  } finally {
    previewLoading.value = false
  }
}

const TYPE_LABEL = {
  act: 'Акт',
  contract: 'Договор',
  protocol: 'Протокол',
  order: 'Приказ',
  report: 'Отчёт'
}

onMounted(() => {
  loadStats()
  loadPreview()
})
</script>

<template>
  <section>
    <h1 class="h3 mb-3">
      Экспертная панель
    </h1>

    <div class="row g-3 mb-3">
      <div class="col-md-4">
        <RouterLink
          to="/dashboard/expert/review"
          class="text-decoration-none"
        >
          <div :class="['cd-card p-3 h-100 d-flex align-items-center gap-3']">
            <span class="badge rounded-circle p-3 text-bg-warning">
              <i class="bi bi-hourglass-split fs-5" />
            </span>
            <div>
              <div class="text-secondary small">
                На согласовании
              </div>
              <div class="h3 mb-0">
                {{ stats?.documentsByStatus?.pending ?? '—' }}
              </div>
            </div>
          </div>
        </RouterLink>
      </div>
      <div class="col-md-4">
        <RouterLink
          to="/dashboard/registry"
          class="text-decoration-none"
        >
          <div :class="['cd-card p-3 h-100 d-flex align-items-center gap-3']">
            <span class="badge rounded-circle p-3 text-bg-success">
              <i class="bi bi-check2-circle fs-5" />
            </span>
            <div>
              <div class="text-secondary small">
                Согласовано всего
              </div>
              <div class="h3 mb-0">
                {{ stats?.documentsByStatus?.approved ?? '—' }}
              </div>
            </div>
          </div>
        </RouterLink>
      </div>
      <div class="col-md-4">
        <RouterLink
          to="/dashboard/statistics"
          class="text-decoration-none"
        >
          <div :class="['cd-card p-3 h-100 d-flex align-items-center gap-3']">
            <span class="badge rounded-circle p-3 text-bg-primary">
              <i class="bi bi-graph-up fs-5" />
            </span>
            <div>
              <div class="text-secondary small">
                Документов в системе
              </div>
              <div class="h3 mb-0">
                {{ stats?.documents ?? '—' }}
              </div>
            </div>
          </div>
        </RouterLink>
      </div>
    </div>

    <div :class="['cd-card']">
      <div class="p-3 d-flex flex-wrap align-items-center justify-content-between gap-2 border-bottom">
        <h2 class="h6 mb-0">
          Очередь согласования (5 свежих)
        </h2>
        <RouterLink
          :class="['btn btn-sm btn-primary']"
          to="/dashboard/expert/review"
        >
          Открыть очередь <i class="bi bi-arrow-right ms-1" />
        </RouterLink>
      </div>
      <div
        v-if="previewLoading"
        class="p-4 text-center text-secondary"
      >
        <span class="spinner-border spinner-border-sm me-2" /> Загрузка…
      </div>
      <div
        v-else-if="!pendingPreview.length"
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
            v-for="d in pendingPreview"
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
  </section>
</template>
