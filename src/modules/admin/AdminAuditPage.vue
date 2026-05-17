<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { adminApi } from './admin.api.js'
import { useToast } from '@/ui/useToast.js'
import { formatDateTime } from '@/lib/format.js'
import { auditFillStatus } from './audit-retention.js'

const toast = useToast()

const items = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(50)
const loading = ref(false)

// Audit retention status: лёгкий запрос (/admin/audit-retention), не тащит
// полный db-stats. Подгружается один раз на mount, в перезагрузке списка
// не участвует — значения медленно меняются и не критичны для UX списка.
const retention = ref(null)
async function loadRetention() {
  try {
    retention.value = await adminApi.auditRetention()
  } catch {
    retention.value = null
  }
}

const retentionFill = computed(() => auditFillStatus(retention.value?.rows, retention.value?.hardCap, { lowSeverity: 'secondary' }))

const search = ref('')
const action = ref('')

let searchTimer = null
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    load()
  }, 300)
})
watch(action, () => {
  page.value = 1
  load()
})

async function load() {
  loading.value = true
  try {
    const res = await adminApi.listAudit({
      page: page.value,
      pageSize: pageSize.value,
      search: search.value.trim(),
      action: action.value
    })
    items.value = res.items
    total.value = res.total
  } catch (e) {
    toast.error(e?.message || 'Не удалось загрузить журнал.')
  } finally {
    loading.value = false
  }
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
function gotoPage(p) {
  if (p < 1 || p > totalPages.value || p === page.value) return
  page.value = p
  load()
}

const ACTION_OPTIONS = [
  { value: '', label: 'Все события' },
  { value: 'user.verify', label: 'Подтверждение' },
  { value: 'user.block', label: 'Блокировка' },
  { value: 'user.role', label: 'Смена роли' },
  { value: 'user.password', label: 'Смена пароля' },
  { value: 'user.delete', label: 'Удаление' }
]
const ACTION_LABEL = {
  'user.verify': 'Подтверждение',
  'user.block': 'Блокировка',
  'user.role': 'Смена роли',
  'user.password': 'Смена пароля',
  'user.delete': 'Удаление'
}
const ACTION_BADGE = {
  'user.verify': 'text-bg-success',
  'user.block': 'text-bg-warning',
  'user.role': 'text-bg-info',
  'user.password': 'text-bg-secondary',
  'user.delete': 'text-bg-danger'
}

onMounted(() => {
  load()
  loadRetention()
})
</script>

<template>
  <section>
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <h1 class="h3 mb-0">
        Журнал действий
      </h1>
      <button
        type="button"
        :class="['btn btn-outline-secondary']"
        :disabled="loading"
        @click="load"
      >
        <i class="bi bi-arrow-clockwise me-1" /> Обновить
      </button>
    </div>

    <div
      v-if="retention"
      class="small text-secondary mb-3"
    >
      <span class="me-3">
        <i class="bi bi-database me-1" />
        {{ retention.rows.toLocaleString('ru-RU') }} / {{ retention.hardCap.toLocaleString('ru-RU') }} записей
      </span>
      <span
        v-if="retention.keepDays > 0"
        class="me-3"
      >
        <i class="bi bi-calendar3 me-1" />
        Хранение {{ retention.keepDays }} дней
      </span>
      <span
        v-if="retentionFill"
        :class="`badge text-bg-${retentionFill.severity}`"
      >
        {{ retentionFill.pct }}% от хард-капа
      </span>
    </div>

    <div :class="['cd-card p-3 mb-3']">
      <div class="row g-2">
        <div class="col-md-4">
          <select
            v-model="action"
            class="form-select"
          >
            <option
              v-for="opt in ACTION_OPTIONS"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="col-md-8">
          <input
            v-model="search"
            type="search"
            class="form-control"
            placeholder="Поиск по администратору, цели или описанию"
          >
        </div>
      </div>
    </div>

    <div :class="['cd-card']">
      <div
        v-if="loading"
        class="p-4 text-center text-secondary"
      >
        <span class="spinner-border spinner-border-sm me-2" /> Загрузка…
      </div>
      <div
        v-else-if="!items.length"
        class="p-4 text-center text-secondary"
      >
        Записей не найдено.
      </div>
      <table
        v-else
        class="table table-hover mb-0 align-middle"
      >
        <thead class="table-light">
          <tr>
            <th>Когда</th>
            <th>Кто</th>
            <th>Действие</th>
            <th>Цель</th>
            <th>Детали</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in items"
            :key="r.id"
          >
            <td class="small text-secondary text-nowrap">
              {{ formatDateTime(r.at) }}
            </td>
            <td class="font-monospace small">
              {{ r.actor }}
            </td>
            <td>
              <span :class="['badge', ACTION_BADGE[r.action] ?? 'text-bg-light']">
                {{ ACTION_LABEL[r.action] ?? r.action }}
              </span>
            </td>
            <td class="font-monospace small">
              {{ r.target || '—' }}
            </td>
            <td class="small">
              {{ r.details || '—' }}
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
        <li :class="['page-item', { disabled: page === 1 }]">
          <button
            type="button"
            class="page-link"
            @click="gotoPage(page - 1)"
          >
            ‹
          </button>
        </li>
        <li
          v-for="p in totalPages"
          :key="p"
          :class="['page-item', { active: p === page }]"
        >
          <button
            type="button"
            class="page-link"
            @click="gotoPage(p)"
          >
            {{ p }}
          </button>
        </li>
        <li :class="['page-item', { disabled: page === totalPages }]">
          <button
            type="button"
            class="page-link"
            @click="gotoPage(page + 1)"
          >
            ›
          </button>
        </li>
      </ul>
    </nav>
  </section>
</template>
