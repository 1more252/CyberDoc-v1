<script setup>
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useDocumentSetStore } from './document-set.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { infoSystemsApi } from '@/modules/info-systems/info-systems.api.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { formatDate } from '@/lib/format.js'
import { useUrlFilterSync } from '@/lib/use-url-filters.js'
import FlowNextStep from '@/ui/FlowNextStep.vue'

const store = useDocumentSetStore()
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
function onTemplateFilterChange(e) {
  store.setTemplateId(e.target.value)
  store.fetchList()
}

const totalPages = computed(() => Math.max(1, Math.ceil(store.total / store.pageSize)))

function gotoPage(p) {
  if (p < 1 || p > totalPages.value || p === store.page) return
  store.setPage(p)
  store.fetchList()
}

async function onDelete(d) {
  const ok = await confirm.ask({
    title: 'Удалить запись из истории?',
    message: `Удалить запись о пакете «${d.templateName || d.templateId}» от ${formatDate(d.generatedAt)}? Сам файл не затрагивается.`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(d.id)
    toast.success('Удалено.')
  } catch (e) {
    toast.error(e?.message || 'Не удалось удалить.')
  }
}

function generateLink(tplId) {
  const params = new URLSearchParams({ template: tplId })
  if (store.organizationId) params.set('organizationId', store.organizationId)
  if (store.infoSystemId && store.infoSystemId !== 'none')
    params.set('infoSystemId', store.infoSystemId)
  return `/dashboard/document-sets/new?${params.toString()}`
}

watch(
  () => store.organizationId,
  () => {
    loadInfoSystems()
  }
)

useUrlFilterSync({
  store,
  fields: ['organizationId', 'infoSystemId', 'templateId', 'page'],
  numericFields: ['page'],
  onReady: async () => {
    await Promise.all([loadOrgs(), store.loadTemplates()])
    await loadInfoSystems()
    store.fetchList()
  }
})
</script>

<template>
  <section>
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <div>
        <h1 class="h3 mb-1">
          Пакеты ОРД
        </h1>
        <p class="text-secondary mb-0 small">
          Генератор комплектов организационно-распорядительной документации:
          приказы, положения, акты, перечни ТС/ПО/СЗИ.
        </p>
      </div>
      <RouterLink
        class="btn btn-primary"
        to="/dashboard/document-sets/new"
      >
        <i class="bi bi-plus-lg me-1" /> Сгенерировать пакет
      </RouterLink>
    </div>

    <h2 class="h5 mb-2">
      Доступные шаблоны
    </h2>
    <div
      v-if="store.templatesLoading && !store.templates.length"
      class="cd-card p-4 text-center text-secondary mb-4"
    >
      <span class="spinner-border spinner-border-sm me-2" /> Загрузка шаблонов…
    </div>
    <div
      v-else-if="!store.templates.length"
      class="cd-card p-4 text-center text-secondary mb-4"
    >
      Шаблоны ОРД не найдены.
    </div>
    <div
      v-else
      class="row g-3 mb-4"
    >
      <div
        v-for="t in store.templates"
        :key="t.id"
        class="col-md-6 col-xl-4"
      >
        <div class="cd-card p-3 h-100 d-flex flex-column">
          <div class="d-flex align-items-start justify-content-between gap-2 mb-2">
            <h3 class="h6 mb-0">
              {{ t.name }}
            </h3>
            <span class="badge text-bg-light">
              {{ t.sections.length }} разд.
            </span>
          </div>
          <div class="text-secondary small mb-2">
            {{ t.audience }}
          </div>
          <p class="small mb-3 flex-grow-1">
            {{ t.description }}
          </p>
          <div class="d-flex gap-2">
            <RouterLink
              class="btn btn-sm btn-primary"
              :to="generateLink(t.id)"
            >
              <i class="bi bi-file-earmark-word me-1" /> Сгенерировать
            </RouterLink>
            <span
              v-if="!t.requiresIs"
              class="badge text-bg-secondary align-self-center"
              title="Шаблон формируется на уровне организации, без выбора ИС"
            >
              Уровень организации
            </span>
          </div>
        </div>
      </div>
    </div>

    <h2 class="h5 mb-2">
      История генераций
    </h2>
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
        <div class="col-md-4">
          <select
            class="form-select"
            :value="store.templateId"
            @change="onTemplateFilterChange"
          >
            <option value="">
              Все шаблоны
            </option>
            <option
              v-for="t in store.templates"
              :key="t.id"
              :value="t.id"
            >
              {{ t.name }}
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
        История пуста — сгенерируйте первый пакет.
      </div>
      <table
        v-else
        class="table table-hover mb-0 align-middle"
      >
        <thead class="table-light">
          <tr>
            <th>Шаблон</th>
            <th>Организация</th>
            <th>ИС</th>
            <th>Файл</th>
            <th>Разделов</th>
            <th>Сгенерирован</th>
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
              {{ d.templateName || '—' }}
            </td>
            <td class="small">
              {{ d.organizationName || '—' }}
            </td>
            <td class="small text-secondary">
              {{ d.infoSystemName || '—' }}
            </td>
            <td class="small font-monospace">
              {{ d.filename }}
            </td>
            <td class="small text-secondary">
              {{ d.sectionsCount }}
            </td>
            <td class="small text-secondary">
              {{ formatDate(d.generatedAt) }}
            </td>
            <td class="text-end">
              <button
                type="button"
                class="btn btn-sm btn-outline-danger"
                aria-label="Удалить"
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
