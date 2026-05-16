<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useEquipmentStore } from './equipment.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { infoSystemsApi } from '@/modules/info-systems/info-systems.api.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { saveDocx } from '@/lib/docx-runner.js'
import { formatDate } from '@/lib/format.js'
import FlowNextStep from '@/ui/FlowNextStep.vue'

const store = useEquipmentStore()
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

const totalPages = computed(() => Math.max(1, Math.ceil(store.total / store.pageSize)))

function gotoPage(p) {
  if (p < 1 || p > totalPages.value || p === store.page) return
  store.setPage(p)
  store.fetchList()
}

async function onDelete(eq) {
  const ok = await confirm.ask({
    title: 'Удалить оборудование?',
    message: `Удалить «${eq.name}»? Действие необратимо.`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(eq.id)
    toast.success('Удалено.')
  } catch (e) {
    toast.error(e?.message || 'Не удалось удалить.')
  }
}

const exporting = ref(false)
const exportProgress = ref({ phase: '', done: 0, total: 0 })

async function onExportAll() {
  if (!store.organizationId) {
    toast.warning('Выберите организацию — массовая выгрузка идёт по одной организации.')
    return
  }
  if (!store.total) {
    toast.warning('Нет оборудования для выгрузки.')
    return
  }

  exporting.value = true
  exportProgress.value = { phase: 'load', done: 0, total: store.total }
  try {
    const all = await store.fetchAllForExport((done, total) => {
      exportProgress.value = { phase: 'load', done, total }
    })
    if (!all.length) {
      toast.warning('Нет данных для экспорта.')
      return
    }

    const organization = await organizationApi.get(store.organizationId).catch(() => null)

    exportProgress.value = { phase: 'build', done: 0, total: all.length }
    const filename = `equipment-${organization?.inn || 'org'}-${new Date().toISOString().slice(0, 10)}.docx`
    await saveDocx(
      'equipment-bulk',
      {
        items: all,
        organization,
        title: organization ? `Карточки оборудования — ${organization.name}` : 'Карточки оборудования'
      },
      filename,
      (done, total) => {
        exportProgress.value = { phase: 'build', done, total }
      }
    )
    toast.success(`Сгенерировано карточек: ${all.length}.`)
  } catch (e) {
    toast.error(e?.message || 'Не удалось собрать DOCX.')
  } finally {
    exporting.value = false
  }
}

const exportLabel = computed(() => {
  if (!exporting.value) return ''
  const { phase, done, total } = exportProgress.value
  if (phase === 'load') return `Загрузка данных: ${done} / ${total}`
  if (phase === 'build') return `Сборка карточек: ${done} / ${total}`
  return ''
})

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

onMounted(async () => {
  await loadOrgs()
  await loadInfoSystems()
  store.fetchList()
})

const STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'active', label: 'В эксплуатации' },
  { value: 'repair', label: 'В ремонте' },
  { value: 'decommissioned', label: 'Списано' }
]
const STATUS_LABEL = {
  active: 'В эксплуатации',
  repair: 'В ремонте',
  decommissioned: 'Списано'
}
const STATUS_BADGE = {
  active: 'text-bg-success',
  repair: 'text-bg-warning',
  decommissioned: 'text-bg-secondary'
}
const KIND_LABEL = {
  server: 'Сервер',
  network: 'Сетевое',
  pc: 'ПК',
  printer: 'Принтер/МФУ',
  pos: 'Касса',
  ups: 'ИБП',
  other: 'Прочее'
}
</script>

<template>
  <section>
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <h1 class="h3 mb-0">
        Оборудование
      </h1>
      <RouterLink
        :class="['btn btn-primary']"
        to="/dashboard/equipment/new"
      >
        <i class="bi bi-plus-lg me-1" /> Добавить
      </RouterLink>
    </div>

    <div :class="['cd-card p-3 mb-3']">
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
            placeholder="Поиск по названию, модели, серийному, инв. номеру"
          >
        </div>
      </div>

      <div class="d-flex flex-wrap gap-2 align-items-center mt-3">
        <button
          type="button"
          :class="['btn btn-outline-success']"
          :disabled="exporting || !store.organizationId || !store.total"
          :title="!store.organizationId ? 'Выберите организацию' : ''"
          @click="onExportAll"
        >
          <span
            v-if="exporting"
            class="spinner-border spinner-border-sm me-2"
          />
          <i
            v-else
            class="bi bi-file-earmark-word me-1"
          />
          Скачать карточки DOCX (по фильтру)
        </button>
        <span
          v-if="exporting"
          class="small text-secondary"
        >
          {{ exportLabel }}
        </span>
      </div>
    </div>

    <div :class="['cd-card']">
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
        Ничего не найдено.
      </div>
      <table
        v-else
        class="table table-hover mb-0 align-middle"
      >
        <thead class="table-light">
          <tr>
            <th>Название</th>
            <th>Тип</th>
            <th>Модель</th>
            <th>Инв. №</th>
            <th>Статус</th>
            <th>Обновлено</th>
            <th class="text-end">
              Действия
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="e in store.items"
            :key="e.id"
          >
            <td>
              <RouterLink :to="`/dashboard/equipment/${e.id}`">
                {{ e.name }}
              </RouterLink>
            </td>
            <td class="small text-secondary">
              {{ KIND_LABEL[e.kind] ?? e.kind }}
            </td>
            <td class="small">
              {{ e.model || '—' }}
            </td>
            <td class="font-monospace small">
              {{ e.inventoryNumber || '—' }}
            </td>
            <td>
              <span :class="['badge', STATUS_BADGE[e.status] ?? 'text-bg-light']">
                {{ STATUS_LABEL[e.status] ?? e.status }}
              </span>
            </td>
            <td class="small text-secondary">
              {{ formatDate(e.updatedAt) }}
            </td>
            <td class="text-end">
              <RouterLink
                :class="['btn btn-sm btn-outline-secondary me-1']"
                :to="`/dashboard/equipment/${e.id}/edit`"
                aria-label="Редактировать"
              >
                <i class="bi bi-pencil" />
              </RouterLink>
              <button
                type="button"
                :class="['btn btn-sm btn-outline-danger']"
                aria-label="Удалить"
                @click="onDelete(e)"
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
