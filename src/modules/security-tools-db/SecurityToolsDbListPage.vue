<script setup>
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useSecurityToolsDbStore } from './security-tools-db.store.js'
import { useDictionariesStore } from '@/modules/dictionaries/dictionaries.store.js'
import { useAuthStore } from '@/modules/auth/auth.store.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { useUrlFilterSync } from '@/lib/use-url-filters.js'
import FlowNextStep from '@/ui/FlowNextStep.vue'

const store = useSecurityToolsDbStore()
const dicts = useDictionariesStore()
const auth = useAuthStore()
const toast = useToast()
const confirm = useConfirm()

const isAdmin = computed(() => auth.role === 'admin')

const searchInput = ref(store.search)
let searchTimer = null
watch(searchInput, (v) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    store.setSearch(v.trim())
    store.fetchList()
  }, 300)
})

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

async function onDelete(c) {
  const ok = await confirm.ask({
    title: 'Удалить запись каталога?',
    message: `Удалить «${c.name}»? Удаление запрещено, если на запись есть ссылки в моих СЗИ.`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(c.id)
    toast.success('Удалено.')
  } catch (e) {
    if (e?.message?.includes('catalog_in_use'))
      toast.error('Нельзя удалить: на запись есть ссылки в моих СЗИ.')
    else toast.error(e?.message || 'Не удалось удалить.')
  }
}

useUrlFilterSync({
  store,
  fields: ['search', 'kindId', 'page'],
  numericFields: ['page'],
  onReady: async () => {
    searchInput.value = store.search
    await dicts.load('typeSzi')
    store.fetchList()
  }
})
</script>

<template>
  <section>
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <div>
        <h1 class="h3 mb-1">
          Каталог СЗИ ФСТЭК
        </h1>
        <p class="text-secondary mb-0 small">
          Сертифицированные средства защиты информации.
          Используется как справочник при добавлении «Моих СЗИ».
        </p>
      </div>
      <RouterLink
        v-if="isAdmin"
        class="btn btn-primary"
        to="/dashboard/security-tools-db/new"
      >
        <i class="bi bi-plus-lg me-1" /> Добавить запись
      </RouterLink>
    </div>

    <div class="cd-card p-3 mb-3">
      <div class="row g-2">
        <div class="col-md-4">
          <select
            class="form-select"
            :value="store.kindId"
            @change="onKindChange"
          >
            <option value="">
              Все категории СЗИ
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
        <div class="col-md-8">
          <input
            v-model="searchInput"
            type="search"
            class="form-control"
            placeholder="Поиск по названию, вендору, номеру сертификата"
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
        Записи не найдены.
      </div>
      <table
        v-else
        class="table table-hover mb-0 align-middle"
      >
        <thead class="table-light">
          <tr>
            <th>Наименование</th>
            <th>Вендор</th>
            <th>Категория</th>
            <th>Сертификат</th>
            <th>Срок действия</th>
            <th
              v-if="isAdmin"
              class="text-end"
            >
              Действия
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in store.items"
            :key="c.id"
          >
            <td>
              <RouterLink :to="`/dashboard/security-tools-db/${c.id}`">
                {{ c.name }}
              </RouterLink>
              <div
                v-if="c.certClass"
                class="small text-secondary"
              >
                {{ c.certClass }}
              </div>
            </td>
            <td class="small">
              {{ c.vendor || '—' }}
            </td>
            <td class="small text-secondary">
              {{ dicts.labelOf('typeSzi', c.kindId) || '—' }}
            </td>
            <td class="small font-monospace">
              {{ c.certNumber || '—' }}
            </td>
            <td class="small text-secondary">
              {{ c.certExpiry || '—' }}
            </td>
            <td
              v-if="isAdmin"
              class="text-end"
            >
              <RouterLink
                class="btn btn-sm btn-outline-secondary me-1"
                :to="`/dashboard/security-tools-db/${c.id}/edit`"
                aria-label="Редактировать"
              >
                <i class="bi bi-pencil" />
              </RouterLink>
              <button
                type="button"
                class="btn btn-sm btn-outline-danger"
                aria-label="Удалить"
                @click="onDelete(c)"
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
