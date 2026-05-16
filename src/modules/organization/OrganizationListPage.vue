<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useOrganizationStore } from './organization.store.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { formatDate } from '@/lib/format.js'
import FlowNextStep from '@/ui/FlowNextStep.vue'

const store = useOrganizationStore()
const toast = useToast()
const confirm = useConfirm()

const searchInput = ref(store.search)
let searchTimer = null
watch(searchInput, (v) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    store.setSearch(v.trim())
    store.fetchList()
  }, 300)
})

const totalPages = computed(() => Math.max(1, Math.ceil(store.total / store.pageSize)))

function gotoPage(p) {
  if (p < 1 || p > totalPages.value || p === store.page) return
  store.setPage(p)
  store.fetchList()
}

async function onDelete(org) {
  const ok = await confirm.ask({
    title: 'Удалить организацию?',
    message: `Удалить «${org.name}»? Связанные документы и оборудование останутся, но потеряют привязку.`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  try {
    await store.remove(org.id)
    toast.success('Организация удалена.')
  } catch (e) {
    toast.error(e?.message || 'Не удалось удалить.')
  }
}

onMounted(() => {
  store.fetchList()
})
</script>

<template>
  <section>
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <h1 class="h3 mb-0">
        Организации
      </h1>
      <RouterLink
        :class="['btn btn-primary']"
        to="/dashboard/organizations/new"
      >
        <i class="bi bi-plus-lg me-1" /> Добавить
      </RouterLink>
    </div>

    <div :class="['cd-card p-3 mb-3']">
      <input
        v-model="searchInput"
        type="search"
        class="form-control"
        placeholder="Поиск по названию или ИНН"
      >
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
        Нет организаций. Нажмите «Добавить».
      </div>
      <table
        v-else
        class="table table-hover mb-0 align-middle"
      >
        <thead class="table-light">
          <tr>
            <th>Название</th>
            <th>Тип</th>
            <th>ИНН</th>
            <th>Создана</th>
            <th class="text-end">
              Действия
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="o in store.items"
            :key="o.id"
          >
            <td>
              <RouterLink :to="`/dashboard/organizations/${o.id}`">
                {{ o.name }}
              </RouterLink>
            </td>
            <td>
              <span class="badge text-bg-secondary">{{ o.kind === 'ip' ? 'ИП' : 'ЮЛ' }}</span>
            </td>
            <td class="font-monospace small">
              {{ o.inn }}
            </td>
            <td class="small text-secondary">
              {{ formatDate(o.createdAt) }}
            </td>
            <td class="text-end">
              <RouterLink
                :class="['btn btn-sm btn-outline-secondary me-1']"
                :to="`/dashboard/organizations/${o.id}/edit`"
                aria-label="Редактировать"
              >
                <i class="bi bi-pencil" />
              </RouterLink>
              <button
                type="button"
                :class="['btn btn-sm btn-outline-danger']"
                aria-label="Удалить"
                @click="onDelete(o)"
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
