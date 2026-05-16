<script setup>
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useSoftwareStore } from './software.store.js'
import { useDictionariesStore } from '@/modules/dictionaries/dictionaries.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { infoSystemsApi } from '@/modules/info-systems/info-systems.api.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { formatDate } from '@/lib/format.js'
import { useUrlFilterSync } from '@/lib/use-url-filters.js'
import FlowNextStep from '@/ui/FlowNextStep.vue'

const store = useSoftwareStore()
const dicts = useDictionariesStore()
const toast = useToast()
const confirm = useConfirm()

const orgs = ref([])
const orgsLoading = ref(false)
const infoSystems = ref([])
const infoSystemsLoading = ref(false)

const searchInput = ref(store.search)
let searchTimer = null
watch(searchInput, (v) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    store.setSearch(v.trim())
    store.fetchList()
  }, 300)
})

async function onOrgChange(e) {
  store.setOrganizationId(e.target.value)
  await loadInfoSystems()
  store.fetchList()
}
function onInfoSystemChange(e) {
  store.setInfoSystemId(e.target.value)
  store.fetchList()
}
function onCategoryChange(e) {
  store.setCategory(e.target.value)
  store.fetchList()
}
function onKindChange(v) {
  store.setKindId(v)
  store.fetchList()
}

const totalPages = computed(() => Math.max(1, Math.ceil(store.total / store.pageSize)))

function gotoPage(p) {
  if (p < 1 || p > totalPages.value || p === store.page) return
  store.setPage(p)
  store.fetchList()
}

async function onDelete(sw) {
  const ok = await confirm.ask({
    title: 'Удалить ПО?',
    message: `Удалить «${sw.name}»? Действие необратимо.`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(sw.id)
    toast.success('Удалено.')
  } catch (e) {
    toast.error(e?.message || 'Не удалось удалить.')
  }
}

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

const CATEGORY_OPTIONS = [
  { value: '', label: 'Все типы ПО' },
  { value: 'system', label: 'Системное' },
  { value: 'application', label: 'Прикладное' }
]
const CATEGORY_LABEL = { system: 'Системное', application: 'Прикладное' }
const CATEGORY_BADGE = {
  system: 'text-bg-primary',
  application: 'text-bg-info'
}

useUrlFilterSync({
  store,
  fields: ['search', 'organizationId', 'infoSystemId', 'category', 'kindId', 'page'],
  numericFields: ['page'],
  onReady: async () => {
    searchInput.value = store.search
    await Promise.all([loadOrgs(), dicts.load('typeApp')])
    await loadInfoSystems()
    store.fetchList()
  }
})
</script>

<template>
  <section>
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <h1 class="h3 mb-0">
        Программное обеспечение
      </h1>
      <RouterLink
        class="btn btn-primary"
        to="/dashboard/software/new"
      >
        <i class="bi bi-plus-lg me-1" /> Добавить ПО
      </RouterLink>
    </div>

    <div class="cd-card p-3 mb-3">
      <div class="row g-2">
        <div class="col-md-3">
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
        <div class="col-md-3">
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
            <option value="none">
              Без привязки к ИС
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
        <div class="col-md-2">
          <select
            class="form-select"
            :value="store.category"
            @change="onCategoryChange"
          >
            <option
              v-for="opt in CATEGORY_OPTIONS"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="col-md-2">
          <select
            class="form-select"
            :value="store.kindId"
            @change="onKindChange($event.target.value)"
          >
            <option value="">
              Все категории
            </option>
            <option
              v-for="k in dicts.items('typeApp')"
              :key="k.id"
              :value="k.id"
            >
              {{ k.name }}
            </option>
          </select>
        </div>
        <div class="col-md-2">
          <input
            v-model="searchInput"
            type="search"
            class="form-control"
            placeholder="Поиск"
          >
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
        Программное обеспечение не найдено.
      </div>
      <table
        v-else
        class="table table-hover mb-0 align-middle"
      >
        <thead class="table-light">
          <tr>
            <th>Название</th>
            <th>Категория</th>
            <th>Тип</th>
            <th>Версия</th>
            <th>Вендор</th>
            <th>Обновлено</th>
            <th class="text-end">
              Действия
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="sw in store.items"
            :key="sw.id"
          >
            <td>
              <RouterLink :to="`/dashboard/software/${sw.id}`">
                {{ sw.name }}
              </RouterLink>
            </td>
            <td>
              <span :class="['badge', CATEGORY_BADGE[sw.category] ?? 'text-bg-light']">
                {{ CATEGORY_LABEL[sw.category] ?? sw.category }}
              </span>
            </td>
            <td class="small text-secondary">
              {{ dicts.labelOf('typeApp', sw.kindId) || '—' }}
            </td>
            <td class="small font-monospace">
              {{ sw.version || '—' }}
            </td>
            <td class="small">
              {{ sw.vendor || '—' }}
            </td>
            <td class="small text-secondary">
              {{ formatDate(sw.updatedAt) }}
            </td>
            <td class="text-end">
              <RouterLink
                class="btn btn-sm btn-outline-secondary me-1"
                :to="`/dashboard/software/${sw.id}/edit`"
                aria-label="Редактировать"
              >
                <i class="bi bi-pencil" />
              </RouterLink>
              <button
                type="button"
                class="btn btn-sm btn-outline-danger"
                aria-label="Удалить"
                @click="onDelete(sw)"
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
