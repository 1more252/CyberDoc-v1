<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useThreatModelsStore } from './threat-models.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { infoSystemsApi } from '@/modules/info-systems/info-systems.api.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { formatDate } from '@/lib/format.js'
import FlowNextStep from '@/ui/FlowNextStep.vue'

const store = useThreatModelsStore()
const toast = useToast()
const confirm = useConfirm()

const orgs = ref([])
const orgsLoading = ref(false)
const infoSystems = ref([])
const infoSystemsLoading = ref(false)

async function loadOrgs() {
  orgsLoading.value = true
  try {
    const res = await organizationApi.list({ page: 1, pageSize: 200 })
    orgs.value = res.items
  } finally {
    orgsLoading.value = false
  }
}

async function loadInfoSystems() {
  if (!store.organizationId) {
    infoSystems.value = []
    return
  }
  infoSystemsLoading.value = true
  try {
    const res = await infoSystemsApi.list({
      page: 1,
      pageSize: 200,
      organizationId: store.organizationId
    })
    infoSystems.value = res.items
  } finally {
    infoSystemsLoading.value = false
  }
}

async function onOrgChange(e) {
  store.setOrganizationId(e.target.value)
  await loadInfoSystems()
  store.fetchList()
}
function onInfoSystemChange(e) {
  store.setInfoSystemId(e.target.value)
  store.fetchList()
}
function onStatusChange(e) {
  store.setStatus(e.target.value)
  store.fetchList()
}

const totalPages = computed(() => Math.max(1, Math.ceil(store.total / store.pageSize)))
function gotoPage(p) {
  if (p < 1 || p > totalPages.value || p === store.page) return
  store.setPage(p)
  store.fetchList()
}

async function onDelete(m) {
  const ok = await confirm.ask({
    title: 'Удалить модель угроз?',
    message: `Удалить «${m.name}»? Это действие необратимо.`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(m.id)
    toast.success('Удалено.')
  } catch (e) {
    toast.error(e?.message || 'Не удалось удалить.')
  }
}

const STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'draft', label: 'Черновик' },
  { value: 'finalized', label: 'Утверждена' }
]
const STATUS_LABEL = { draft: 'Черновик', finalized: 'Утверждена' }
const STATUS_BADGE = { draft: 'text-bg-secondary', finalized: 'text-bg-success' }

watch(
  () => store.organizationId,
  () => {
    loadInfoSystems()
  }
)

onMounted(async () => {
  await loadOrgs()
  await loadInfoSystems()
  store.fetchList()
})
</script>

<template>
  <section>
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <div>
        <h1 class="h3 mb-1">
          Модели угроз
        </h1>
        <p class="text-secondary mb-0 small">
          Перечень моделей угроз безопасности информации по методике ФСТЭК России.
          Создаётся отдельно для каждой информационной системы.
        </p>
      </div>
      <RouterLink
        class="btn btn-primary"
        to="/dashboard/threat-models/new"
      >
        <i class="bi bi-plus-lg me-1" /> Новая модель угроз
      </RouterLink>
    </div>

    <div class="cd-card p-3 mb-3">
      <div class="row g-2">
        <div class="col-md-4">
          <select
            class="form-select"
            :disabled="orgsLoading"
            :value="store.organizationId"
            @change="onOrgChange"
          >
            <option value="">
              Все организации
            </option>
            <option
              v-for="o in orgs"
              :key="o.id"
              :value="o.id"
            >
              {{ o.name }}
            </option>
          </select>
        </div>
        <div class="col-md-4">
          <select
            class="form-select"
            :disabled="!store.organizationId || infoSystemsLoading"
            :value="store.infoSystemId"
            :title="!store.organizationId ? 'Сначала выберите организацию' : ''"
            @change="onInfoSystemChange"
          >
            <option value="">
              Все ИС
            </option>
            <option
              v-for="is in infoSystems"
              :key="is.id"
              :value="is.id"
            >
              {{ is.name }}
            </option>
          </select>
        </div>
        <div class="col-md-4">
          <select
            class="form-select"
            :value="store.status"
            @change="onStatusChange"
          >
            <option
              v-for="opt in STATUS_OPTIONS"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </div>
      </div>
    </div>

    <div class="cd-card">
      <div
        v-if="store.loading"
        class="p-4 text-center text-secondary"
      >
        <span class="spinner-border spinner-border-sm me-2" /> Загрузка…
      </div>
      <div
        v-else-if="!store.items.length"
        class="p-4 text-center text-secondary"
      >
        Модели угроз не найдены.
      </div>
      <table
        v-else
        class="table table-hover mb-0 align-middle"
      >
        <thead class="table-light">
          <tr>
            <th>Наименование</th>
            <th>Организация</th>
            <th>ИС</th>
            <th class="text-center">
              Угрозы
            </th>
            <th>Статус</th>
            <th>Обновлено</th>
            <th class="text-end">
              Действия
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="m in store.items"
            :key="m.id"
          >
            <td>
              <RouterLink :to="`/dashboard/threat-models/${m.id}`">
                {{ m.name }}
              </RouterLink>
            </td>
            <td class="small">
              {{ m.organizationName || '—' }}
            </td>
            <td class="small text-secondary">
              {{ m.infoSystemName || '—' }}
            </td>
            <td class="small text-center">
              <span class="badge text-bg-light me-1">
                Всего: {{ m.threatsCount }}
              </span>
              <span
                :class="['badge', m.relevantCount ? 'text-bg-danger' : 'text-bg-success']"
              >
                Актуальных: {{ m.relevantCount }}
              </span>
            </td>
            <td>
              <span :class="['badge', STATUS_BADGE[m.status] ?? 'text-bg-light']">
                {{ STATUS_LABEL[m.status] ?? m.status }}
              </span>
            </td>
            <td class="small text-secondary">
              {{ formatDate(m.updatedAt) }}
            </td>
            <td class="text-end">
              <RouterLink
                class="btn btn-sm btn-outline-secondary me-1"
                :to="`/dashboard/threat-models/${m.id}/edit`"
              >
                <i class="bi bi-pencil" />
              </RouterLink>
              <button
                type="button"
                class="btn btn-sm btn-outline-danger"
                @click="onDelete(m)"
              >
                <i class="bi bi-trash" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <nav
      v-if="totalPages > 1"
      class="mt-3"
    >
      <ul class="pagination">
        <li :class="['page-item', { disabled: store.page === 1 }]">
          <button
            type="button"
            class="page-link"
            @click="gotoPage(store.page - 1)"
          >
            ‹
          </button>
        </li>
        <li
          v-for="p in totalPages"
          :key="p"
          :class="['page-item', { active: p === store.page }]"
        >
          <button
            type="button"
            class="page-link"
            @click="gotoPage(p)"
          >
            {{ p }}
          </button>
        </li>
        <li :class="['page-item', { disabled: store.page === totalPages }]">
          <button
            type="button"
            class="page-link"
            @click="gotoPage(store.page + 1)"
          >
            ›
          </button>
        </li>
      </ul>
    </nav>

    <FlowNextStep />
  </section>
</template>
