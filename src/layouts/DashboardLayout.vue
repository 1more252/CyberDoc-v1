<script setup>
import { computed, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import AppNavbar from '@/ui/AppNavbar.vue'
import { useAuthStore } from '@/modules/auth/auth.store.js'
import { flowForRole } from '@/flow/flow.js'
import { lsGet, lsSet } from '@/lib/storage.js'

const auth = useAuthStore()
const route = useRoute()

// === collapse state =====================================================
const SIDEBAR_KEY = 'cyberdoc.sidebar.collapsed'
const collapsed = ref(lsGet(SIDEBAR_KEY) === '1')

watch(collapsed, (v) => lsSet(SIDEBAR_KEY, v ? '1' : '0'))

function toggleSidebar() {
  collapsed.value = !collapsed.value
}

const sidebar = computed(() => {
  const flow = flowForRole(auth.role)
  if (!flow.length) return []
  const items = []
  let lastGroup
  flow.forEach((step, i) => {
    if (step.group && step.group !== lastGroup) {
      items.push({ kind: 'header', label: step.group })
      lastGroup = step.group
    }
    items.push({ kind: 'link', to: step.to, label: step.label, icon: step.icon, step: i + 1 })
  })
  return items
})

function isActive(to) {
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <div class="d-flex flex-column min-vh-100">
    <AppNavbar />
    <div :class="['cd-shell', { 'cd-shell--collapsed': collapsed }]">
      <aside
        v-if="sidebar.length"
        :class="['cd-sidebar d-none d-lg-block', { 'cd-sidebar--collapsed': collapsed }]"
      >
        <button
          type="button"
          class="cd-sidebar__toggle"
          :title="collapsed ? 'Развернуть меню' : 'Свернуть меню'"
          :aria-label="collapsed ? 'Развернуть меню' : 'Свернуть меню'"
          @click="toggleSidebar"
        >
          <i :class="['bi', collapsed ? 'bi-chevron-double-right' : 'bi-chevron-double-left']" />
        </button>

        <nav class="nav flex-column">
          <template
            v-for="(item, i) in sidebar"
            :key="i"
          >
            <div
              v-if="item.kind === 'header'"
              :class="['cd-sidebar__header text-uppercase small text-secondary px-3 pt-3 pb-1']"
            >
              <span class="cd-sidebar__header-label">{{ item.label }}</span>
              <span
                v-if="collapsed"
                class="cd-sidebar__header-rule"
                aria-hidden="true"
              />
            </div>
            <RouterLink
              v-else
              :class="['nav-link d-flex align-items-center gap-2', { active: isActive(item.to) }]"
              :to="item.to"
              :title="collapsed ? item.label : undefined"
            >
              <span class="cd-sidebar__step">{{ item.step }}</span>
              <i :class="['bi cd-sidebar__icon', item.icon]" />
              <span class="cd-sidebar__label">{{ item.label }}</span>
            </RouterLink>
          </template>
        </nav>
      </aside>
      <main class="cd-shell__main">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.cd-sidebar {
  position: relative;
  user-select: none;
  -webkit-user-select: none;
}
.cd-sidebar :deep(.nav-link) {
  user-select: none;
  -webkit-user-select: none;
}
.cd-sidebar__header {
  letter-spacing: 0.04em;
  font-weight: 600;
  user-select: none;
  -webkit-user-select: none;
}
.cd-sidebar__header:first-of-type {
  padding-top: 0.5rem !important;
}
.cd-sidebar__step {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--bs-secondary-bg, #e9ecef);
  color: var(--bs-secondary-color, #6c757d);
  flex-shrink: 0;
}
.nav-link.active .cd-sidebar__step {
  background: var(--bs-primary);
  color: #fff;
}

/* === toggle-кнопка =================================================== */
.cd-sidebar__toggle {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  width: 28px;
  height: 28px;
  display: inline-grid;
  place-items: center;
  border: 1px solid var(--cd-sidebar-border, #eceef3);
  background: #fff;
  border-radius: 50%;
  color: #6c757d;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, transform 0.15s;
  z-index: 2;
}
.cd-sidebar__toggle:hover {
  color: var(--bs-primary);
  border-color: var(--bs-primary);
}
.cd-sidebar--collapsed .cd-sidebar__toggle {
  right: 50%;
  transform: translateX(50%);
}

/* === свёрнутое состояние ============================================ */
.cd-sidebar--collapsed {
  padding-top: 2.5rem;
}
.cd-sidebar--collapsed .cd-sidebar__label {
  display: none;
}
.cd-sidebar--collapsed .cd-sidebar__step {
  display: none;
}
.cd-sidebar--collapsed :deep(.nav-link) {
  justify-content: center;
  padding-inline: 0.5rem;
}
.cd-sidebar--collapsed .cd-sidebar__icon {
  font-size: 1.15rem;
}
.cd-sidebar--collapsed .cd-sidebar__header {
  padding-inline: 0.5rem !important;
  text-align: center;
}
.cd-sidebar--collapsed .cd-sidebar__header-label {
  display: none;
}
.cd-sidebar__header-rule {
  display: block;
  height: 1px;
  background: var(--cd-sidebar-border, #eceef3);
  margin: 0.25rem auto;
}
</style>
