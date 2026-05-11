<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { adminApi } from './admin.api.js'
import { useAuthStore } from '@/modules/auth/auth.store.js'
import { useToast } from '@/ui/useToast.js'
import { useConfirm } from '@/ui/useConfirm.js'
import { formatDate } from '@/lib/format.js'

const auth = useAuthStore()
const toast = useToast()
const confirm = useConfirm()

const items = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const acting = ref(false)

const search = ref('')
const role = ref('')

let searchTimer = null
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    load()
  }, 300)
})
watch(role, () => {
  page.value = 1
  load()
})

async function load() {
  loading.value = true
  try {
    const res = await adminApi.listUsers({
      page: page.value,
      pageSize: pageSize.value,
      search: search.value.trim(),
      role: role.value
    })
    items.value = res.items
    total.value = res.total
  } catch (e) {
    toast.error(e?.message || 'Не удалось загрузить пользователей.')
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

function applyUpdated(u) {
  const i = items.value.findIndex((x) => x.username === u.username)
  if (i >= 0) items.value.splice(i, 1, u)
}

async function onVerify(u) {
  acting.value = true
  try {
    const updated = await adminApi.setVerified(u.username, !u.verified)
    applyUpdated(updated)
    toast.success(updated.verified ? 'Подтверждено.' : 'Подтверждение снято.')
  } catch (e) {
    toast.error(e?.message || 'Не удалось изменить.')
  } finally {
    acting.value = false
  }
}

async function onBlock(u) {
  const next = !u.blocked
  const ok = await confirm.ask({
    title: next ? 'Заблокировать пользователя?' : 'Разблокировать пользователя?',
    message: next
      ? `Заблокировать «${u.username}»? Активные сессии будут завершены.`
      : `Разблокировать «${u.username}»?`,
    okText: next ? 'Заблокировать' : 'Разблокировать',
    variant: next ? 'danger' : 'primary'
  })
  if (!ok) return
  acting.value = true
  try {
    const updated = await adminApi.setBlocked(u.username, next)
    applyUpdated(updated)
    toast.success(next ? 'Заблокирован.' : 'Разблокирован.')
  } catch (e) {
    toast.error(e?.message || 'Не удалось изменить.')
  } finally {
    acting.value = false
  }
}

async function onRoleChange(u, e) {
  const newRole = e.target.value
  if (newRole === u.role) return
  acting.value = true
  try {
    const updated = await adminApi.setRole(u.username, newRole)
    applyUpdated(updated)
    toast.success(`Роль изменена на «${newRole}».`)
  } catch (err) {
    e.target.value = u.role
    toast.error(err?.message || 'Не удалось сменить роль.')
  } finally {
    acting.value = false
  }
}

async function onPassword(u) {
  const password = window.prompt(`Новый пароль для «${u.username}» (мин. 6 символов):`)
  if (password === null) return
  if (password.length < 6) {
    toast.warning('Пароль должен быть не короче 6 символов.')
    return
  }
  acting.value = true
  try {
    await adminApi.setPassword(u.username, password)
    toast.success('Пароль изменён. Активные сессии завершены.')
  } catch (e) {
    toast.error(e?.message || 'Не удалось изменить пароль.')
  } finally {
    acting.value = false
  }
}

async function onDelete(u) {
  const ok = await confirm.ask({
    title: 'Удалить пользователя?',
    message: `Удалить «${u.username}»? Действие необратимо. Если у пользователя есть организации/оборудование/документы — удаление будет отклонено.`,
    okText: 'Удалить',
    variant: 'danger'
  })
  if (!ok) return
  acting.value = true
  try {
    await adminApi.removeUser(u.username)
    toast.success('Пользователь удалён.')
    load()
  } catch (e) {
    if (e?.message === 'has_dependencies') {
      toast.error('Сначала удалите/переназначьте организации, оборудование и документы пользователя.')
    } else {
      toast.error(e?.message || 'Не удалось удалить.')
    }
  } finally {
    acting.value = false
  }
}

const ROLE_OPTIONS = [
  { value: '', label: 'Все роли' },
  { value: 'admin', label: 'Администратор' },
  { value: 'expert', label: 'Эксперт' },
  { value: 'user', label: 'Пользователь' }
]
const ROLE_OPTIONS_FOR_SELECT = ROLE_OPTIONS.filter((o) => o.value)

const isSelf = (u) => u.username === auth.user?.username

onMounted(load)
</script>

<template>
  <section>
    <h1 class="h3 mb-3">
      Пользователи
    </h1>

    <div :class="['cd-card p-3 mb-3']">
      <div class="row g-2">
        <div class="col-md-4">
          <select
            v-model="role"
            class="form-select"
          >
            <option
              v-for="opt in ROLE_OPTIONS"
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
            placeholder="Поиск по логину или email"
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
        Пользователи не найдены.
      </div>
      <table
        v-else
        class="table table-hover mb-0 align-middle"
      >
        <thead class="table-light">
          <tr>
            <th>Логин</th>
            <th>Email</th>
            <th>Роль</th>
            <th>Статус</th>
            <th>Зарегистрирован</th>
            <th class="text-end">
              Действия
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="u in items"
            :key="u.username"
          >
            <td class="font-monospace">
              {{ u.username }}
              <span
                v-if="isSelf(u)"
                class="badge text-bg-light ms-1"
              >вы</span>
            </td>
            <td class="small">
              {{ u.email || '—' }}
            </td>
            <td>
              <select
                :class="['form-select form-select-sm']"
                :value="u.role"
                :disabled="isSelf(u) || acting"
                style="width: 10rem;"
                @change="onRoleChange(u, $event)"
              >
                <option
                  v-for="opt in ROLE_OPTIONS_FOR_SELECT"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </option>
              </select>
            </td>
            <td>
              <span
                v-if="u.blocked"
                class="badge text-bg-danger me-1"
              >Заблокирован</span>
              <span
                v-else-if="!u.verified"
                class="badge text-bg-warning me-1"
              >Не подтверждён</span>
              <span
                v-else
                class="badge text-bg-success me-1"
              >Активен</span>
            </td>
            <td class="small text-secondary">
              {{ formatDate(u.createdAt) }}
            </td>
            <td class="text-end text-nowrap">
              <button
                type="button"
                :class="['btn btn-sm me-1', u.verified ? 'btn-outline-secondary' : 'btn-outline-success']"
                :disabled="acting"
                :title="u.verified ? 'Снять подтверждение' : 'Подтвердить'"
                @click="onVerify(u)"
              >
                <i :class="['bi', u.verified ? 'bi-patch-check-fill' : 'bi-patch-check']" />
              </button>
              <button
                type="button"
                :class="['btn btn-sm me-1', u.blocked ? 'btn-outline-success' : 'btn-outline-warning']"
                :disabled="isSelf(u) || acting"
                :title="u.blocked ? 'Разблокировать' : 'Заблокировать'"
                @click="onBlock(u)"
              >
                <i :class="['bi', u.blocked ? 'bi-unlock' : 'bi-lock']" />
              </button>
              <button
                type="button"
                :class="['btn btn-sm btn-outline-secondary me-1']"
                :disabled="acting"
                title="Сменить пароль"
                @click="onPassword(u)"
              >
                <i class="bi bi-key" />
              </button>
              <button
                type="button"
                :class="['btn btn-sm btn-outline-danger']"
                :disabled="isSelf(u) || acting"
                title="Удалить"
                @click="onDelete(u)"
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
