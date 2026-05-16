<script setup>
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useSecurityToolsStore } from './security-tools.store.js'
import { useDictionariesStore } from '@/modules/dictionaries/dictionaries.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { infoSystemsApi } from '@/modules/info-systems/info-systems.api.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { formatDate } from '@/lib/format.js'
import { useUrlFilterSync } from '@/lib/use-url-filters.js'
import FlowNextStep from '@/ui/FlowNextStep.vue'

const store = useSecurityToolsStore()
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
function onStatusChange(e) {
  store.setStatus(e.target.value)
  store.fetchList()
}
function onKindChange(e) {
  store.setKindId(e.target.value)
  store.fetchList()
}

const totalPages = computed(() => Math.max(1, Math.ceil(store.total / store.pageSize)))

function gotoPage(p) {
  if (p < 1 || p > totalPages.value || p === store.page) return
  store.setPage(p)
  store.fetchList()
}

async function onDelete(st) {
  const ok = await confirm.ask({
    title: 'Удалить экземпляр СЗИ?',
    message: `Удалить «${st.catalogName || st.serialNumber || st.id}»?`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(st.id)
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

const STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'active', label: 'Активна' },
  { value: 'expired', label: 'Лицензия истекла' },
  { value: 'decommissioned', label: 'Выведено из эксплуатации' }
]
const STATUS_LABEL = {
  active: 'Активна',
  expired: 'Лицензия истекла',
  decommissioned: 'Выведено'
}
const STATUS_BADGE = {
  active: 'text-bg-success',
  expired: 'text-bg-danger',
  decommissioned: 'text-bg-secondary'
}

function expiryBadge(dateStr) {
  if (!dateStr) return { cls: 'text-bg-light', text: '—' }
  const d = new Date(dateStr).getTime()
  if (Number.isNaN(d)) return { cls: 'text-bg-light', text: dateStr }
  const ms = d - Date.now()
  const days = Math.round(ms / (24 * 3600 * 1000))
  if (days < 0) return { cls: 'text-bg-danger', text: `Истёк ${dateStr}` }
  if (days < 30) return { cls: 'text-bg-warning', text: `${dateStr} (${days} дн.)` }
  return { cls: 'text-bg-light', text: dateStr }
}

useUrlFilterSync({
  store,
  fields: ['search', 'organizationId', 'infoSystemId', 'status', 'kindId', 'page'],
  numericFields: ['page'],
  onReady: async () => {
    searchInput.value = store.search
    await Promise.all([loadOrgs(), dicts.load('typeSzi')])
    await loadInfoSystems()
    store.fetchList()
  }
})
</script>

<template>
  <section>
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <h1 class="h3 mb-0">
        Мои СЗИ
      </h1>
      <RouterLink
        class="btn btn-primary"
        to="/dashboard/security-tools/new"
      >
        <i class="bi bi-plus-lg me-1" /> Добавить СЗИ
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
            :value="store.kindId"
            @change="onKindChange"
          >
            <option value="">
              Все категории
            </option>
            <option
              v-for="k in dicts.items('typeSzi')"
              :key="k.id"
              :value="k.id"
            >
              {{ k.name }}
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
        Экземпляры СЗИ не найдены.
      </div>
      <table
        v-else
        class="table table-hover mb-0 align-middle"
      >
        <thead class="table-light">
          <tr>
            <th>СЗИ</th>
            <th>Категория</th>
            <th>Серийный №</th>
            <th>Срок лицензии</th>
            <th>Статус</th>
            <th>Обновлено</th>
            <th class="text-end">
              Действия
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="st in store.items"
            :key="st.id"
          >
            <td>
              <RouterLink :to="`/dashboard/security-tools/${st.id}`">
                {{ st.catalogName || '— без названия —' }}
              </RouterLink>
              <div
                v-if="st.catalogVendor"
                class="small text-secondary"
              >
                {{ st.catalogVendor }}
              </div>
            </td>
            <td class="small text-secondary">
              {{ dicts.labelOf('typeSzi', st.catalogKindId) || '—' }}
            </td>
            <td class="small font-monospace">
              {{ st.serialNumber || '—' }}
            </td>
            <td class="small">
              <span :class="['badge', expiryBadge(st.licenseExpiresAt).cls]">
                {{ expiryBadge(st.licenseExpiresAt).text }}
              </span>
            </td>
            <td>
              <span :class="['badge', STATUS_BADGE[st.status] ?? 'text-bg-light']">
                {{ STATUS_LABEL[st.status] ?? st.status }}
              </span>
            </td>
            <td class="small text-secondary">
              {{ formatDate(st.updatedAt) }}
            </td>
            <td class="text-end">
              <RouterLink
                class="btn btn-sm btn-outline-secondary me-1"
                :to="`/dashboard/security-tools/${st.id}/edit`"
                aria-label="Редактировать"
              >
                <i class="bi bi-pencil" />
              </RouterLink>
              <button
                type="button"
                class="btn btn-sm btn-outline-danger"
                aria-label="Удалить"
                @click="onDelete(st)"
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
