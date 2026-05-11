<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { adminApi } from '@/modules/admin/admin.api.js'
import { useAuthStore } from '@/modules/auth/auth.store.js'
import { useToast } from '@/ui/useToast.js'
import FlowNextStep from '@/ui/FlowNextStep.vue'

const auth = useAuthStore()
const toast = useToast()

const data = ref(null)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    data.value = await adminApi.statistics()
  } catch (e) {
    toast.error(e?.message || 'Не удалось загрузить статистику.')
  } finally {
    loading.value = false
  }
}

const isPrivileged = computed(() => ['admin', 'expert'].includes(auth.role))

const cards = computed(() => {
  if (!data.value) return []
  const out = [
    {
      key: 'organizations',
      title: 'Организации',
      value: data.value.organizations,
      icon: 'bi-building',
      to: '/dashboard/organizations',
      colorClass: 'text-bg-primary'
    },
    {
      key: 'equipment',
      title: 'Оборудование',
      value: data.value.equipment,
      icon: 'bi-cpu',
      to: '/dashboard/equipment',
      colorClass: 'text-bg-info'
    },
    {
      key: 'documents',
      title: 'Документы',
      value: data.value.documents,
      icon: 'bi-file-earmark-text',
      to: '/dashboard/registry',
      colorClass: 'text-bg-success'
    }
  ]
  if (data.value.users !== undefined) {
    out.push({
      key: 'users',
      title: 'Пользователи',
      value: data.value.users,
      icon: 'bi-people',
      to: '/dashboard/admin/users',
      colorClass: 'text-bg-secondary'
    })
  }
  return out
})

const STATUS_LABEL = {
  draft: 'Черновики',
  pending: 'На согласовании',
  approved: 'Согласованы',
  rejected: 'Отклонены'
}
const STATUS_BADGE = {
  draft: 'text-bg-secondary',
  pending: 'text-bg-warning',
  approved: 'text-bg-success',
  rejected: 'text-bg-danger'
}

const docsByStatus = computed(() => {
  const s = data.value?.documentsByStatus
  if (!s) return []
  return Object.entries(s).map(([key, value]) => ({
    key,
    label: STATUS_LABEL[key] ?? key,
    value,
    badge: STATUS_BADGE[key] ?? 'text-bg-light'
  }))
})

const totalDocs = computed(() => data.value?.documents ?? 0)

function pct(value) {
  if (!totalDocs.value) return 0
  return Math.round((value / totalDocs.value) * 100)
}

onMounted(load)
</script>

<template>
  <section>
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <h1 class="h3 mb-0">
        Статистика
      </h1>
      <button
        type="button"
        :class="['btn btn-outline-secondary']"
        :disabled="loading"
        @click="load"
      >
        <i class="bi bi-arrow-clockwise me-1" /> Обновить
      </button>
    </div>

    <p
      v-if="!isPrivileged"
      class="text-secondary small mb-3"
    >
      Данные показаны только по вашим записям.
    </p>

    <div
      v-if="loading"
      :class="['cd-card p-4 text-center text-secondary']"
    >
      <span class="spinner-border spinner-border-sm me-2" /> Загрузка…
    </div>

    <template v-else-if="data">
      <div class="row g-3 mb-3">
        <div
          v-for="c in cards"
          :key="c.key"
          class="col-md-6 col-lg-3"
        >
          <RouterLink
            :to="c.to"
            class="text-decoration-none"
          >
            <div :class="['cd-card p-3 h-100 d-flex align-items-center gap-3']">
              <span :class="['badge rounded-circle p-3', c.colorClass]">
                <i :class="['bi', c.icon, 'fs-5']" />
              </span>
              <div>
                <div class="text-secondary small">
                  {{ c.title }}
                </div>
                <div class="h3 mb-0">
                  {{ c.value }}
                </div>
              </div>
            </div>
          </RouterLink>
        </div>
      </div>

      <div :class="['cd-card p-4']">
        <h2 class="h6 text-secondary mb-3">
          Документы по статусам
        </h2>
        <div
          v-if="!totalDocs"
          class="text-secondary"
        >
          Документов нет.
        </div>
        <div
          v-else
          class="vstack gap-2"
        >
          <div
            v-for="row in docsByStatus"
            :key="row.key"
          >
            <div class="d-flex align-items-center gap-2 mb-1">
              <span :class="['badge', row.badge]">{{ row.label }}</span>
              <span class="ms-auto small text-secondary">{{ row.value }} ({{ pct(row.value) }}%)</span>
            </div>
            <div
              class="progress"
              style="height: 6px;"
            >
              <div
                class="progress-bar"
                role="progressbar"
                :style="{ width: pct(row.value) + '%' }"
                :aria-valuenow="row.value"
                :aria-valuemin="0"
                :aria-valuemax="totalDocs"
              />
            </div>
          </div>
        </div>
      </div>
    </template>

    <FlowNextStep />
  </section>
</template>
