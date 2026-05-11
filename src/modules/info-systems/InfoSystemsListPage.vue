<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useInfoSystemsStore } from './info-systems.store.js'
import { useDictionariesStore } from '@/modules/dictionaries/dictionaries.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { formatDate } from '@/lib/format.js'
import FlowNextStep from '@/ui/FlowNextStep.vue'

const store = useInfoSystemsStore()
const dicts = useDictionariesStore()
const toast = useToast()
const confirm = useConfirm()

const orgs = ref([])
const orgsLoading = ref(false)

const searchInput = ref(store.search)
let searchTimer = null
watch(searchInput, (v) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    store.setSearch(v.trim())
    store.fetchList()
  }, 300)
})

function onOrgChange(e) {
  store.setOrganizationId(e.target.value)
  store.fetchList()
}
function onTypeChange(e) {
  store.setTypeId(e.target.value)
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

async function onDelete(is) {
  const ok = await confirm.ask({
    title: 'Удалить ИС?',
    message: `Удалить «${is.name}»? Связанные с ней документы потеряют связь с ИС.`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(is.id)
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

const STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'draft', label: 'Черновик' },
  { value: 'active', label: 'В эксплуатации' },
  { value: 'archived', label: 'Архив' }
]
const STATUS_LABEL = {
  draft: 'Черновик',
  active: 'В эксплуатации',
  archived: 'Архив'
}
const STATUS_BADGE = {
  draft: 'text-bg-secondary',
  active: 'text-bg-success',
  archived: 'text-bg-light'
}

function orgName(orgId) {
  return orgs.value.find((o) => o.id === orgId)?.name ?? '—'
}

onMounted(async () => {
  await Promise.all([loadOrgs(), dicts.load('infoSysType')])
  store.fetchList()
})
</script>

<template>
  <section>
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <h1 class="h3 mb-0">
        Информационные системы
      </h1>
      <RouterLink
        class="btn btn-primary"
        to="/dashboard/info-systems/new"
      >
        <i class="bi bi-plus-lg me-1" /> Добавить ИС
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
            :value="store.typeId"
            @change="onTypeChange"
          >
            <option value="">
              Все типы ИС
            </option>
            <option
              v-for="t in dicts.items('infoSysType')"
              :key="t.id"
              :value="t.id"
            >
              {{ t.name }}
            </option>
          </select>
        </div>
        <div class="col-md-2">
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
        <div class="col-md-4">
          <input
            v-model="searchInput"
            type="search"
            class="form-control"
            placeholder="Поиск по названию, классу, назначению"
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
        Информационных систем не найдено. Создайте первую — и к ней можно будет
        привязать сегменты, АРМ, ПО, СЗИ и модель угроз.
      </div>
      <table
        v-else
        class="table table-hover mb-0 align-middle"
      >
        <thead class="table-light">
          <tr>
            <th>Название</th>
            <th>Организация</th>
            <th>Тип</th>
            <th>Класс</th>
            <th>Статус</th>
            <th>Обновлено</th>
            <th class="text-end">
              Действия
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="is in store.items"
            :key="is.id"
          >
            <td>
              <RouterLink :to="`/dashboard/info-systems/${is.id}`">
                {{ is.name }}
              </RouterLink>
              <div
                v-if="is.purpose"
                class="small text-secondary"
              >
                {{ is.purpose }}
              </div>
            </td>
            <td class="small">
              {{ orgName(is.organizationId) }}
            </td>
            <td class="small text-secondary">
              {{ dicts.labelOf('infoSysType', is.typeId) }}
            </td>
            <td class="small font-monospace">
              {{ is.classification || '—' }}
            </td>
            <td>
              <span :class="['badge', STATUS_BADGE[is.status] ?? 'text-bg-light']">
                {{ STATUS_LABEL[is.status] ?? is.status }}
              </span>
            </td>
            <td class="small text-secondary">
              {{ formatDate(is.updatedAt) }}
            </td>
            <td class="text-end">
              <RouterLink
                class="btn btn-sm btn-outline-secondary me-1"
                :to="`/dashboard/info-systems/${is.id}/edit`"
              >
                <i class="bi bi-pencil" />
              </RouterLink>
              <button
                type="button"
                class="btn btn-sm btn-outline-danger"
                @click="onDelete(is)"
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
