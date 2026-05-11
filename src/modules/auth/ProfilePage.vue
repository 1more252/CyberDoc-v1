<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useAuthStore } from './auth.store.js'
import { authApi } from './auth.api.js'
import { useToast } from '@/ui/useToast.js'
import FormField from '@/ui/FormField.vue'
import FlowNextStep from '@/ui/FlowNextStep.vue'

const auth = useAuthStore()
const toast = useToast()

// ===== profile load =====================================================

const profile = ref(null)
const loading = ref(true)

const roleLabel = computed(() => {
  switch (profile.value?.role ?? auth.role) {
    case 'admin': return 'Администратор'
    case 'expert': return 'Эксперт'
    case 'user': return 'Пользователь'
    default: return '—'
  }
})

const roleBadgeClass = computed(() => {
  switch (profile.value?.role ?? auth.role) {
    case 'admin': return 'text-bg-danger'
    case 'expert': return 'text-bg-warning'
    case 'user': return 'text-bg-primary'
    default: return 'text-bg-secondary'
  }
})

const initials = computed(() => {
  const name = (profile.value?.username || auth.user?.username || '').trim()
  if (!name) return '?'
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
})

const createdAtLabel = computed(() => {
  const ts = profile.value?.createdAt
  if (!ts) return null
  try {
    return new Date(ts).toLocaleDateString('ru-RU', {
      day: '2-digit', month: 'long', year: 'numeric'
    })
  } catch {
    return null
  }
})

onMounted(async () => {
  try {
    profile.value = await authApi.me()
  } catch (e) {
    toast.error(e?.message || 'Не удалось загрузить профиль.')
  } finally {
    loading.value = false
  }
})

// ===== password change ==================================================

const pwd = reactive({ current: '', next: '', confirm: '' })
const errors = reactive({ current: '', next: '', confirm: '' })
const submitting = ref(false)

function validatePassword() {
  errors.current = pwd.current.length ? '' : 'Введите текущий пароль'
  errors.next = pwd.next.length >= 6 ? '' : 'Минимум 6 символов'
  if (!errors.next && pwd.next === pwd.current)
    errors.next = 'Новый пароль должен отличаться от текущего'
  errors.confirm = pwd.confirm === pwd.next ? '' : 'Пароли не совпадают'
  return !Object.values(errors).some(Boolean)
}

const ERR_MAP = {
  wrong_current: 'Текущий пароль неверный.',
  password_too_short: 'Минимум 6 символов.',
  password_same: 'Новый пароль должен отличаться от текущего.',
  missing_fields: 'Заполните все поля.'
}

async function submitPassword() {
  if (!validatePassword()) return
  submitting.value = true
  try {
    await authApi.changePassword({
      currentPassword: pwd.current,
      newPassword: pwd.next
    })
    toast.success('Пароль изменён.')
    pwd.current = ''
    pwd.next = ''
    pwd.confirm = ''
  } catch (e) {
    const msg = ERR_MAP[e?.message] || e?.message || 'Не удалось изменить пароль.'
    toast.error(msg)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section>
    <h1 class="h3 mb-4">
      Мой профиль
    </h1>

    <!-- === заголовочная карточка =================================== -->
    <div class="cd-card cd-profile-header p-4 mb-3">
      <div class="d-flex flex-wrap align-items-center gap-3">
        <div class="cd-avatar">
          {{ initials }}
        </div>
        <div class="flex-grow-1">
          <div class="h4 mb-1">
            {{ profile?.username || auth.user?.username || '—' }}
          </div>
          <div class="d-flex flex-wrap align-items-center gap-2">
            <span
              class="badge"
              :class="roleBadgeClass"
            >
              <i class="bi bi-person-badge me-1" />
              {{ roleLabel }}
            </span>
            <span
              v-if="profile?.verified"
              class="badge text-bg-success"
            >
              <i class="bi bi-patch-check me-1" />
              Подтверждён
            </span>
            <span
              v-else-if="profile"
              class="badge text-bg-secondary"
            >
              <i class="bi bi-hourglass-split me-1" />
              Не подтверждён
            </span>
            <span
              v-if="profile?.blocked"
              class="badge text-bg-danger"
            >
              <i class="bi bi-slash-circle me-1" />
              Заблокирован
            </span>
          </div>
        </div>
      </div>
    </div>

    <div class="row g-3">
      <!-- === учётные данные ====================================== -->
      <div class="col-lg-6">
        <div class="cd-card p-4 h-100">
          <h2 class="h5 mb-3">
            <i class="bi bi-person-vcard me-2 text-primary" />
            Учётные данные
          </h2>

          <div
            v-if="loading"
            class="text-secondary"
          >
            <span class="spinner-border spinner-border-sm me-2" />
            Загрузка…
          </div>

          <dl
            v-else
            class="cd-info-grid mb-0"
          >
            <dt>
              <i class="bi bi-person me-1 text-secondary" />
              Логин
            </dt>
            <dd>{{ profile?.username || '—' }}</dd>

            <dt>
              <i class="bi bi-envelope me-1 text-secondary" />
              E-mail
            </dt>
            <dd>
              <span v-if="profile?.email">{{ profile.email }}</span>
              <span
                v-else
                class="text-secondary"
              >не указан</span>
            </dd>

            <dt>
              <i class="bi bi-shield-lock me-1 text-secondary" />
              Роль
            </dt>
            <dd>{{ roleLabel }}</dd>

            <template v-if="createdAtLabel">
              <dt>
                <i class="bi bi-calendar3 me-1 text-secondary" />
                Создан
              </dt>
              <dd>{{ createdAtLabel }}</dd>
            </template>
          </dl>
        </div>
      </div>

      <!-- === смена пароля ======================================== -->
      <div class="col-lg-6">
        <div class="cd-card p-4 h-100">
          <h2 class="h5 mb-3">
            <i class="bi bi-key me-2 text-primary" />
            Смена пароля
          </h2>
          <form
            novalidate
            @submit.prevent="submitPassword"
          >
            <FormField
              v-model="pwd.current"
              label="Текущий пароль"
              type="password"
              autocomplete="current-password"
              required
              :error="errors.current"
            />
            <FormField
              v-model="pwd.next"
              label="Новый пароль"
              type="password"
              autocomplete="new-password"
              required
              hint="Минимум 6 символов"
              :error="errors.next"
            />
            <FormField
              v-model="pwd.confirm"
              label="Повторите новый пароль"
              type="password"
              autocomplete="new-password"
              required
              :error="errors.confirm"
            />
            <button
              type="submit"
              class="btn btn-primary w-100"
              :disabled="submitting"
            >
              <span
                v-if="submitting"
                class="spinner-border spinner-border-sm me-2"
              />
              <i
                v-else
                class="bi bi-check2-circle me-1"
              />
              Сохранить новый пароль
            </button>
          </form>
        </div>
      </div>
    </div>

    <FlowNextStep />
  </section>
</template>

<style scoped>
.cd-profile-header {
  background: linear-gradient(135deg, #ffffff 0%, #eef3ff 100%);
}

.cd-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #0d6efd 0%, #6f42c1 100%);
  color: #fff;
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: 0.5px;
  box-shadow: 0 0.25rem 0.75rem rgba(13, 110, 253, 0.25);
  flex-shrink: 0;
}

.cd-info-grid {
  display: grid;
  grid-template-columns: minmax(140px, max-content) 1fr;
  row-gap: 0.6rem;
  column-gap: 1rem;
  align-items: baseline;
}
.cd-info-grid dt {
  font-weight: 500;
  color: #4b5563;
  margin: 0;
}
.cd-info-grid dd {
  margin: 0;
  word-break: break-word;
}
</style>
