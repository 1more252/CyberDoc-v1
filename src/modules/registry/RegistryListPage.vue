<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useRegistryStore } from './registry.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { useAuthStore } from '@/modules/auth/auth.store.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { saveDocx } from '@/lib/docx-runner.js'
import { formatDate } from '@/lib/format.js'
import FlowNextStep from '@/ui/FlowNextStep.vue'

const store = useRegistryStore()
const auth = useAuthStore()
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
function onStatusChange(e) {
  store.setStatus(e.target.value)
  store.fetchList()
}
function onMineChange(e) {
  store.setMine(e.target.checked)
  store.fetchList()
}

const totalPages = computed(() => Math.max(1, Math.ceil(store.total / store.pageSize)))

function gotoPage(p) {
  if (p < 1 || p > totalPages.value || p === store.page) return
  store.setPage(p)
  store.fetchList()
}

async function onDelete(doc) {
  const ok = await confirm.ask({
    title: 'Удалить документ?',
    message: `Удалить «${doc.title}»? Действие необратимо.`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(doc.id)
    toast.success('Удалено.')
  } catch (e) {
    toast.error(e?.message || 'Не удалось удалить.')
  }
}

const exporting = ref(false)
const exportProgress = ref({ phase: '', done: 0, total: 0 })

async function onExportAll() {
  if (!store.total) {
    toast.warning('Нет документов для выгрузки.')
    return
  }
  exporting.value = true
  exportProgress.value = { phase: 'load', done: 0, total: store.total }
  try {
    const all = await store.fetchAllForExport((done, total) => {
      exportProgress.value = { phase: 'load', done, total }
    })
    if (!all.length) {
      toast.warning('Нет данных.')
      return
    }
    let organization = null
    if (store.organizationId) {
      organization = await organizationApi.get(store.organizationId).catch(() => null)
    }
    exportProgress.value = { phase: 'build', done: 0, total: all.length }
    const tag = organization?.inn || (store.status || 'all')
    const filename = `documents-${tag}-${new Date().toISOString().slice(0, 10)}.docx`
    await saveDocx(
      'document-bulk',
      {
        items: all,
        organization,
        title: organization
          ? `Пакет документов — ${organization.name}`
          : 'Пакет документов'
      },
      filename,
      (done, total) => {
        exportProgress.value = { phase: 'build', done, total }
      }
    )
    toast.success(`Сгенерирован пакет: ${all.length} документ(ов).`)
  } catch (e) {
    toast.error(e?.message || 'Не удалось собрать DOCX.')
  } finally {
    exporting.value = false
  }
}

const exportLabel = computed(() => {
  if (!exporting.value) return ''
  const { phase, done, total } = exportProgress.value
  if (phase === 'load') return `Загрузка: ${done} / ${total}`
  if (phase === 'build') return `Сборка: ${done} / ${total}`
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

onMounted(async () => {
  await loadOrgs()
  store.fetchList()
})

const STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'draft', label: 'Черновик' },
  { value: 'pending', label: 'На согласовании' },
  { value: 'approved', label: 'Согласовано' },
  { value: 'rejected', label: 'Отклонено' }
]
const STATUS_LABEL = {
  draft: 'Черновик',
  pending: 'На согласовании',
  approved: 'Согласовано',
  rejected: 'Отклонено'
}
const STATUS_BADGE = {
  draft: 'text-bg-secondary',
  pending: 'text-bg-warning',
  approved: 'text-bg-success',
  rejected: 'text-bg-danger'
}
const TYPE_LABEL = {
  act: 'Акт',
  contract: 'Договор',
  protocol: 'Протокол',
  order: 'Приказ',
  report: 'Отчёт'
}

const canCreate = computed(() => auth.role === 'admin' || auth.role === 'user')
const canDelete = (doc) => doc.status !== 'approved' || auth.role === 'admin'
const canEdit = (doc) => ['draft', 'rejected'].includes(doc.status) &&
  (auth.role === 'admin' || doc.ownerUsername === auth.user?.username)
</script>

<template>
  <section>
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <h1 class="h3 mb-0">
        Документы
      </h1>
      <RouterLink
        v-if="canCreate"
        :class="['btn btn-primary']"
        to="/dashboard/registry/new"
      >
        <i class="bi bi-plus-lg me-1" /> Новый
      </RouterLink>
    </div>

    <div :class="['cd-card p-3 mb-3']">
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
        <div class="col-md-3">
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
        <div class="col-md-5">
          <input
            v-model="searchInput"
            type="search"
            class="form-control"
            placeholder="Поиск по заголовку, номеру, тексту"
          >
        </div>
      </div>

      <div class="d-flex flex-wrap gap-3 align-items-center mt-3">
        <button
          type="button"
          :class="['btn btn-outline-success']"
          :disabled="exporting || !store.total"
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
          Скачать пакет DOCX (по фильтру)
        </button>
        <span
          v-if="exporting"
          class="small text-secondary"
        >{{ exportLabel }}</span>
        <div
          v-if="auth.role === 'admin' || auth.role === 'expert'"
          class="form-check ms-auto"
        >
          <input
            id="mineOnly"
            class="form-check-input"
            type="checkbox"
            :checked="store.mine"
            @change="onMineChange"
          >
          <label
            class="form-check-label small"
            for="mineOnly"
          >
            только мои
          </label>
        </div>
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
        Документов не найдено.
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
            <th>Дата</th>
            <th>Статус</th>
            <th>Обновлён</th>
            <th class="text-end">
              Действия
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="d in store.items"
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
            <td class="small">
              {{ d.date || '—' }}
            </td>
            <td>
              <span :class="['badge', STATUS_BADGE[d.status] ?? 'text-bg-light']">
                {{ STATUS_LABEL[d.status] ?? d.status }}
              </span>
            </td>
            <td class="small text-secondary">
              {{ formatDate(d.updatedAt) }}
            </td>
            <td class="text-end text-nowrap">
              <RouterLink
                v-if="canEdit(d)"
                :class="['btn btn-sm btn-outline-secondary me-1']"
                :to="`/dashboard/registry/${d.id}/edit`"
              >
                <i class="bi bi-pencil" />
              </RouterLink>
              <button
                v-if="canDelete(d)"
                type="button"
                :class="['btn btn-sm btn-outline-danger']"
                @click="onDelete(d)"
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
