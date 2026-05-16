<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/modules/auth/auth.store.js'

const auth = useAuthStore()
const router = useRouter()

const dashboardLink = computed(() => {
  switch (auth.role) {
    case 'admin':
      // /dashboard/admin как entry-route не существует — у админа три раздела
      // (users/audit/settings) без общего landing'а. Ведём на /users — тот же
      // выбор делает LoginPage и HomePage для admin'а после логина.
      return { to: '/dashboard/admin/users', label: 'Админ-панель' }
    case 'expert':
      return { to: '/dashboard/expert', label: 'Экспертная панель' }
    case 'user':
      return { to: '/dashboard/user', label: 'Кабинет' }
    default:
      return null
  }
})

const userDropdownEl = ref(null)
const userDropdownOpen = ref(false)
const mobileMenuOpen = ref(false)

function toggleMobileMenu() {
  mobileMenuOpen.value = !mobileMenuOpen.value
}

function toggleUserDropdown() {
  userDropdownOpen.value = !userDropdownOpen.value
}

function closeUserDropdown() {
  userDropdownOpen.value = false
}

function onDocumentClick(e) {
  if (!userDropdownOpen.value) return
  if (userDropdownEl.value?.contains(e.target)) return
  closeUserDropdown()
}

function onDocumentKey(e) {
  if (e.key === 'Escape') closeUserDropdown()
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onDocumentKey)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKey)
})

async function logout() {
  closeUserDropdown()
  await auth.logout()
  router.push('/')
}
</script>

<template>
  <nav class="navbar navbar-expand-lg bg-primary navbar-dark shadow-sm cd-navbar">
    <div class="container-fluid">
      <RouterLink
        to="/"
        :class="['navbar-brand cd-brand text-white']"
      >
        <span class="cd-brand__mark">К</span>
        КиберДок
      </RouterLink>

      <button
        class="navbar-toggler"
        type="button"
        :aria-expanded="mobileMenuOpen"
        aria-controls="cdNavbar"
        aria-label="Меню"
        @click="toggleMobileMenu"
      >
        <span class="navbar-toggler-icon" />
      </button>

      <div
        id="cdNavbar"
        :class="['collapse navbar-collapse', { show: mobileMenuOpen }]"
      >
        <ul class="navbar-nav ms-auto align-items-lg-center gap-lg-1">
          <template v-if="!auth.isAuthenticated">
            <li class="nav-item">
              <RouterLink
                :class="['nav-link text-white']"
                to="/login"
              >
                <i class="bi bi-box-arrow-in-right me-1" /> Войти
              </RouterLink>
            </li>
            <li class="nav-item">
              <RouterLink
                :class="['btn btn-light btn-sm fw-semibold ms-lg-2']"
                to="/register"
              >
                Регистрация
              </RouterLink>
            </li>
          </template>

          <template v-else>
            <li
              v-if="dashboardLink"
              class="nav-item"
            >
              <RouterLink
                :class="['nav-link text-white']"
                :to="dashboardLink.to"
              >
                <i class="bi bi-speedometer2 me-1" /> {{ dashboardLink.label }}
              </RouterLink>
            </li>
            <li class="nav-item">
              <RouterLink
                :class="['nav-link text-white']"
                :to="{ name: 'organization-list' }"
              >
                <i class="bi bi-building me-1" /> Организации
              </RouterLink>
            </li>
            <li class="nav-item">
              <RouterLink
                :class="['nav-link text-white']"
                :to="{ name: 'registry-list' }"
              >
                <i class="bi bi-clipboard-data me-1" /> Реестр
              </RouterLink>
            </li>
            <li class="nav-item">
              <RouterLink
                :class="['nav-link text-white']"
                :to="{ name: 'equipment-list' }"
              >
                <i class="bi bi-pc-display me-1" /> Оборудование
              </RouterLink>
            </li>
            <li class="nav-item">
              <RouterLink
                :class="['nav-link text-white']"
                :to="{ name: 'statistics' }"
              >
                <i class="bi bi-bar-chart-line me-1" /> Статистика
              </RouterLink>
            </li>
            <li
              ref="userDropdownEl"
              :class="['nav-item dropdown', { show: userDropdownOpen }]"
            >
              <a
                :class="['nav-link dropdown-toggle text-white']"
                href="#"
                role="button"
                :aria-expanded="userDropdownOpen"
                @click.prevent="toggleUserDropdown"
              >
                <i class="bi bi-person-circle me-1" />
                {{ auth.user?.username }}
              </a>
              <ul
                :class="['dropdown-menu dropdown-menu-end', { show: userDropdownOpen }]"
                :style="userDropdownOpen
                  ? { position: 'absolute', inset: '0px 0px auto auto', transform: 'translate(0px, 40px)' }
                  : {}"
              >
                <li class="dropdown-header text-uppercase small">
                  Роль: {{ auth.role }}
                </li>
                <li>
                  <RouterLink
                    :class="['dropdown-item']"
                    to="/profile"
                    @click="closeUserDropdown"
                  >
                    <i class="bi bi-person-gear me-1" /> Мой профиль
                  </RouterLink>
                </li>
                <li><hr class="dropdown-divider"></li>
                <li>
                  <button
                    :class="['dropdown-item text-danger']"
                    type="button"
                    @click="logout"
                  >
                    <i class="bi bi-box-arrow-right me-1" /> Выйти
                  </button>
                </li>
              </ul>
            </li>
          </template>
        </ul>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.cd-navbar {
  user-select: none;
  -webkit-user-select: none;
}
.cd-navbar :deep(a),
.cd-navbar :deep(button),
.cd-navbar :deep(.dropdown-item),
.cd-navbar :deep(.navbar-brand) {
  user-select: none;
  -webkit-user-select: none;
}
</style>
