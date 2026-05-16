<script setup>
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { usePersonalStore } from './personal.store.js'
import { organizationApi } from '@/modules/organization/organization.api.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { formatDate } from '@/lib/format.js'
import { useUrlFilterSync } from '@/lib/use-url-filters.js'
import FlowNextStep from '@/ui/FlowNextStep.vue'

const store = usePersonalStore()
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

const totalPages = computed(() => Math.max(1, Math.ceil(store.total / store.pageSize)))

function gotoPage(p) {
  if (p < 1 || p > totalPages.value || p === store.page) return
  store.setPage(p)
  store.fetchList()
}

async function onDelete(person) {
  const ok = await confirm.ask({
    title: 'Удалить сотрудника?',
    message: `Удалить «${fullName(person)}»?`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(person.id)
    toast.success('Удалено.')
  } catch (e) {
    toast.error(e?.message || 'Не удалось удалить.')
  }
}

function fullName(p) {
  return [p.lastName, p.firstName, p.middleName].filter(Boolean).join(' ')
}

function orgName(orgId) {
  return orgs.value.find((o) => o.id === orgId)?.name ?? '—'
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

useUrlFilterSync({
  store,
  fields: ['search', 'organizationId', 'page'],
  numericFields: ['page'],
  onReady: async () => {
    searchInput.value = store.search
    await loadOrgs()
    store.fetchList()
  }
})
</script>

<template>
  <section>
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <h1 class="h3 mb-0">
        Персонал
      </h1>
      <div class="d-flex gap-2">
        <RouterLink
          class="btn btn-outline-primary"
          to="/dashboard/personal/import"
        >
          <i class="bi bi-cloud-upload me-1" /> Импорт из CSV
        </RouterLink>
        <RouterLink
          class="btn btn-primary"
          to="/dashboard/personal/new"
        >
          <i class="bi bi-plus-lg me-1" /> Добавить
        </RouterLink>
      </div>
    </div>

    <div class="cd-card p-3 mb-3">
      <div class="row g-2">
        <div class="col-md-5">
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
        <div class="col-md-7">
          <input
            v-model="searchInput"
            type="search"
            class="form-control"
            placeholder="Поиск по ФИО, должности, email"
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
        Сотрудники не найдены. Добавьте вручную или импортируйте из CSV.
      </div>
      <table
        v-else
        class="table table-hover mb-0 align-middle"
      >
        <thead class="table-light">
          <tr>
            <th>ФИО</th>
            <th>Организация</th>
            <th>Должность</th>
            <th>Подразделение</th>
            <th>Контакты</th>
            <th>Обновлено</th>
            <th class="text-end">
              Действия
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in store.items"
            :key="p.id"
          >
            <td>
              <RouterLink :to="`/dashboard/personal/${p.id}`">
                {{ fullName(p) }}
              </RouterLink>
              <span
                v-if="p.hasAdminRights"
                class="badge text-bg-warning ms-2"
                title="Имеет административные права"
              >admin</span>
            </td>
            <td class="small">
              {{ orgName(p.organizationId) }}
            </td>
            <td class="small">
              {{ p.position || '—' }}
            </td>
            <td class="small text-secondary">
              {{ p.department || '—' }}
            </td>
            <td class="small">
              <div v-if="p.email">
                {{ p.email }}
              </div>
              <div
                v-if="p.phone"
                class="text-secondary"
              >
                {{ p.phone }}
              </div>
              <div
                v-if="!p.email && !p.phone"
                class="text-secondary"
              >
                —
              </div>
            </td>
            <td class="small text-secondary">
              {{ formatDate(p.updatedAt) }}
            </td>
            <td class="text-end">
              <RouterLink
                class="btn btn-sm btn-outline-secondary me-1"
                :to="`/dashboard/personal/${p.id}/edit`"
                aria-label="Редактировать"
              >
                <i class="bi bi-pencil" />
              </RouterLink>
              <button
                type="button"
                class="btn btn-sm btn-outline-danger"
                aria-label="Удалить"
                @click="onDelete(p)"
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
