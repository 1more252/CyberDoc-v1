<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '@/modules/auth/auth.store.js'
import { flowForRole } from '@/flow/flow.js'
import FlowNextStep from '@/ui/FlowNextStep.vue'

const auth = useAuthStore()

// ---- профиль шапки ------------------------------------------------------

const initials = computed(() => {
  const name = (auth.user?.username || '').trim()
  if (!name) return '?'
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
})

const roleLabel = computed(() => {
  switch (auth.role) {
    case 'admin': return 'Администратор'
    case 'expert': return 'Эксперт'
    case 'user': return 'Пользователь'
    default: return '—'
  }
})
const roleBadgeClass = computed(() => {
  switch (auth.role) {
    case 'admin': return 'text-bg-danger'
    case 'expert': return 'text-bg-warning'
    case 'user': return 'text-bg-primary'
    default: return 'text-bg-secondary'
  }
})

// ---- группировка плиток из flow.js -------------------------------------
// Берём пользовательский flow и режем на смысловые группы. Текущую страницу
// (Главная) исключаем — она и так открыта.

const TILE_GROUPS = computed(() => {
  const flow = flowForRole(auth.role)
  const groups = new Map()
  for (const step of flow) {
    if (step.to === '/dashboard/user') continue
    if (!groups.has(step.group)) groups.set(step.group, [])
    groups.get(step.group).push(step)
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }))
})
</script>

<template>
  <section>
    <!-- === HERO ============================================================ -->
    <div class="cd-card cd-hero p-4 mb-3">
      <div class="d-flex flex-wrap align-items-center gap-3">
        <div class="cd-hero__avatar">
          {{ initials }}
        </div>
        <div class="flex-grow-1 min-w-0">
          <div class="text-secondary small mb-1">
            Добро пожаловать в КиберДок
          </div>
          <h1 class="h3 mb-2 text-truncate">
            Здравствуйте, {{ auth.user?.username }}
          </h1>
          <div class="d-flex flex-wrap gap-2">
            <span
              class="badge"
              :class="roleBadgeClass"
            >
              <i class="bi bi-person-badge" />
              {{ roleLabel }}
            </span>
            <span
              v-if="auth.user?.verified"
              class="badge text-bg-success"
            >
              <i class="bi bi-patch-check" />
              Подтверждён
            </span>
            <span
              v-else
              class="badge text-bg-secondary"
            >
              <i class="bi bi-hourglass-split" />
              Не подтверждён
            </span>
            <RouterLink
              to="/profile"
              class="badge text-bg-light text-decoration-none"
            >
              <i class="bi bi-gear" />
              Настройки профиля
            </RouterLink>
          </div>
        </div>
      </div>
    </div>

    <!-- === FOLLOW-UP STEP CTA ============================================ -->
    <FlowNextStep />

    <!-- === TILE GROUPS ==================================================== -->
    <div
      v-for="g in TILE_GROUPS"
      :key="g.label"
      class="mt-4"
    >
      <div class="cd-group-label">
        {{ g.label }}
      </div>
      <div class="row g-3">
        <div
          v-for="item in g.items"
          :key="item.to"
          class="col-12 col-md-6 col-xl-4"
        >
          <RouterLink
            :to="item.to"
            class="cd-tile h-100"
          >
            <div class="cd-tile__icon">
              <i
                class="bi"
                :class="item.icon"
              />
            </div>
            <div class="flex-grow-1 min-w-0">
              <div class="cd-tile__title text-truncate">
                {{ item.label }}
              </div>
              <div
                v-if="item.hint"
                class="cd-tile__hint"
              >
                {{ item.hint }}
              </div>
            </div>
          </RouterLink>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cd-hero__avatar {
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
.min-w-0 {
  min-width: 0;
}
</style>
