import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/modules/auth/auth.store.js'

const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/modules/misc/HomePage.vue'),
    meta: { layout: 'guest', title: 'Главная' }
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/modules/auth/LoginPage.vue'),
    meta: { layout: 'auth', title: 'Вход' }
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/modules/auth/RegisterPage.vue'),
    meta: { layout: 'auth', title: 'Регистрация' }
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('@/modules/auth/ProfilePage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, title: 'Мой профиль' }
  },

  // --- Кабинет пользователя
  {
    path: '/dashboard/user',
    name: 'user-dashboard',
    component: () => import('@/modules/dashboard/UserDashboardPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['user'], title: 'Кабинет' }
  },

  // --- Организации
  {
    path: '/dashboard/organizations',
    name: 'organization-list',
    component: () => import('@/modules/organization/OrganizationListPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Организации' }
  },
  {
    path: '/dashboard/organizations/new',
    name: 'organization-create',
    component: () => import('@/modules/organization/OrganizationFormPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'user'], title: 'Новая организация' }
  },
  {
    path: '/dashboard/organizations/:id',
    name: 'organization-detail',
    component: () => import('@/modules/organization/OrganizationDetailPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Карточка организации' }
  },
  {
    path: '/dashboard/organizations/:id/edit',
    name: 'organization-edit',
    component: () => import('@/modules/organization/OrganizationFormPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'user'], title: 'Редактирование организации' }
  },

  // --- Реестр ИНН
  {
    path: '/dashboard/inn-registry',
    name: 'inn-registry',
    component: () => import('@/modules/inn-registry/InnRegistryPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Реестр ИНН' }
  },

  // --- Информационные системы (ИБ-учёт по ФСТЭК)
  {
    path: '/dashboard/info-systems',
    name: 'info-systems-list',
    component: () => import('@/modules/info-systems/InfoSystemsListPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Информационные системы' }
  },
  {
    path: '/dashboard/info-systems/new',
    name: 'info-systems-create',
    component: () => import('@/modules/info-systems/InfoSystemsFormPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'user'], title: 'Новая ИС' }
  },
  {
    path: '/dashboard/info-systems/:id',
    name: 'info-systems-detail',
    component: () => import('@/modules/info-systems/InfoSystemsDetailPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Карточка ИС' }
  },
  {
    path: '/dashboard/info-systems/:id/edit',
    name: 'info-systems-edit',
    component: () => import('@/modules/info-systems/InfoSystemsFormPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'user'], title: 'Редактирование ИС' }
  },

  // --- Персонал (с массовым импортом из CSV)
  {
    path: '/dashboard/personal',
    name: 'personal-list',
    component: () => import('@/modules/personal/PersonalListPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Персонал' }
  },
  {
    path: '/dashboard/personal/import',
    name: 'personal-import',
    component: () => import('@/modules/personal/PersonalBulkImportPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'user'], title: 'Импорт персонала' }
  },
  {
    path: '/dashboard/personal/new',
    name: 'personal-create',
    component: () => import('@/modules/personal/PersonalFormPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'user'], title: 'Новый сотрудник' }
  },
  {
    path: '/dashboard/personal/:id',
    name: 'personal-detail',
    component: () => import('@/modules/personal/PersonalDetailPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Карточка сотрудника' }
  },
  {
    path: '/dashboard/personal/:id/edit',
    name: 'personal-edit',
    component: () => import('@/modules/personal/PersonalFormPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'user'], title: 'Редактирование сотрудника' }
  },

  // --- Оборудование
  {
    path: '/dashboard/equipment',
    name: 'equipment-list',
    component: () => import('@/modules/equipment/EquipmentListPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Оборудование' }
  },
  {
    path: '/dashboard/equipment/new',
    name: 'equipment-create',
    component: () => import('@/modules/equipment/EquipmentFormPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'user'], title: 'Новое оборудование' }
  },
  {
    path: '/dashboard/equipment/:id',
    name: 'equipment-detail',
    component: () => import('@/modules/equipment/EquipmentDetailPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Карточка оборудования' }
  },
  {
    path: '/dashboard/equipment/:id/edit',
    name: 'equipment-edit',
    component: () => import('@/modules/equipment/EquipmentFormPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'user'], title: 'Редактирование оборудования' }
  },

  // --- ПО (системное + прикладное)
  {
    path: '/dashboard/software',
    name: 'software-list',
    component: () => import('@/modules/software/SoftwareListPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Программное обеспечение' }
  },
  {
    path: '/dashboard/software/new',
    name: 'software-create',
    component: () => import('@/modules/software/SoftwareFormPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'user'], title: 'Новое ПО' }
  },
  {
    path: '/dashboard/software/:id',
    name: 'software-detail',
    component: () => import('@/modules/software/SoftwareDetailPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Карточка ПО' }
  },
  {
    path: '/dashboard/software/:id/edit',
    name: 'software-edit',
    component: () => import('@/modules/software/SoftwareFormPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'user'], title: 'Редактирование ПО' }
  },

  // --- Каталог СЗИ ФСТЭК (read-only для всех; CRUD только admin)
  {
    path: '/dashboard/security-tools-db',
    name: 'security-tools-db-list',
    component: () => import('@/modules/security-tools-db/SecurityToolsDbListPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Каталог СЗИ ФСТЭК' }
  },
  {
    path: '/dashboard/security-tools-db/new',
    name: 'security-tools-db-create',
    component: () => import('@/modules/security-tools-db/SecurityToolsDbFormPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin'], title: 'Новая запись каталога СЗИ' }
  },
  {
    path: '/dashboard/security-tools-db/:id',
    name: 'security-tools-db-detail',
    component: () => import('@/modules/security-tools-db/SecurityToolsDbDetailPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Карточка СЗИ (каталог)' }
  },
  {
    path: '/dashboard/security-tools-db/:id/edit',
    name: 'security-tools-db-edit',
    component: () => import('@/modules/security-tools-db/SecurityToolsDbFormPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin'], title: 'Редактирование записи каталога СЗИ' }
  },

  // --- Мои СЗИ (экземпляры у организации)
  {
    path: '/dashboard/security-tools',
    name: 'security-tools-list',
    component: () => import('@/modules/security-tools/SecurityToolsListPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Мои СЗИ' }
  },
  {
    path: '/dashboard/security-tools/new',
    name: 'security-tools-create',
    component: () => import('@/modules/security-tools/SecurityToolsFormPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'user'], title: 'Новое СЗИ' }
  },
  {
    path: '/dashboard/security-tools/:id',
    name: 'security-tools-detail',
    component: () => import('@/modules/security-tools/SecurityToolsDetailPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Карточка СЗИ' }
  },
  {
    path: '/dashboard/security-tools/:id/edit',
    name: 'security-tools-edit',
    component: () => import('@/modules/security-tools/SecurityToolsFormPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'user'], title: 'Редактирование СЗИ' }
  },

  // --- Пакеты ОРД (генератор комплектов нормативной документации)
  {
    path: '/dashboard/document-sets',
    name: 'document-set-list',
    component: () => import('@/modules/document-set/DocumentSetListPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Пакеты ОРД' }
  },
  {
    path: '/dashboard/document-sets/new',
    name: 'document-set-generate',
    component: () => import('@/modules/document-set/DocumentSetGeneratePage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'user'], title: 'Генерация пакета ОРД' }
  },

  // --- Модели угроз (методика ФСТЭК)
  {
    path: '/dashboard/threat-models',
    name: 'threat-models-list',
    component: () => import('@/modules/threat-models/ThreatModelsListPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Модели угроз' }
  },
  {
    path: '/dashboard/threat-models/new',
    name: 'threat-models-create',
    component: () => import('@/modules/threat-models/ThreatModelWizardPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'user'], title: 'Новая модель угроз' }
  },
  {
    path: '/dashboard/threat-models/:id',
    name: 'threat-models-detail',
    component: () => import('@/modules/threat-models/ThreatModelDetailPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Карточка модели угроз' }
  },
  {
    path: '/dashboard/threat-models/:id/edit',
    name: 'threat-models-edit',
    component: () => import('@/modules/threat-models/ThreatModelWizardPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'user'], title: 'Редактирование модели угроз' }
  },

  // --- Реестр документов
  {
    path: '/dashboard/registry',
    name: 'registry-list',
    component: () => import('@/modules/registry/RegistryListPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Реестр документов' }
  },
  {
    path: '/dashboard/registry/new',
    name: 'registry-create',
    component: () => import('@/modules/registry/RegistryFormPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'user'], title: 'Новый документ' }
  },
  {
    path: '/dashboard/registry/:id',
    name: 'registry-detail',
    component: () => import('@/modules/registry/RegistryDetailPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Карточка документа' }
  },
  {
    path: '/dashboard/registry/:id/edit',
    name: 'registry-edit',
    component: () => import('@/modules/registry/RegistryFormPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'user'], title: 'Редактирование документа' }
  },

  // --- Статистика
  {
    path: '/dashboard/statistics',
    name: 'statistics',
    component: () => import('@/modules/statistics/StatisticsPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin', 'expert', 'user'], title: 'Статистика' }
  },

  // --- Эксперт
  {
    path: '/dashboard/expert',
    name: 'expert',
    component: () => import('@/modules/expert/ExpertPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['expert'], title: 'Экспертная панель' }
  },
  {
    path: '/dashboard/expert/review',
    name: 'expert-review',
    component: () => import('@/modules/expert/ExpertReviewPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['expert', 'admin'], title: 'Очередь согласования' }
  },

  // --- Админ
  {
    path: '/dashboard/admin/users',
    name: 'admin-users',
    component: () => import('@/modules/admin/AdminUsersPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin'], title: 'Пользователи' }
  },
  {
    path: '/dashboard/admin/audit',
    name: 'admin-audit',
    component: () => import('@/modules/admin/AdminAuditPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin'], title: 'Журнал действий' }
  },
  {
    path: '/dashboard/admin/settings',
    name: 'admin-settings',
    component: () => import('@/modules/admin/AdminSettingsPage.vue'),
    meta: { layout: 'dashboard', requiresAuth: true, roles: ['admin'], title: 'Настройки' }
  },

  // --- Системные
  {
    path: '/403',
    name: 'forbidden',
    component: () => import('@/modules/misc/ForbiddenPage.vue'),
    meta: { layout: 'guest', title: 'Доступ запрещён' }
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/modules/misc/NotFoundPage.vue'),
    meta: { layout: 'guest', title: 'Не найдено' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

router.beforeEach((to) => {
  const auth = useAuthStore()

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.meta.roles && (!auth.role || !to.meta.roles.includes(auth.role))) {
    return { name: 'forbidden' }
  }
  if ((to.name === 'login' || to.name === 'register') && auth.isAuthenticated) {
    return roleHome(auth.role)
  }
  return true
})

router.afterEach((to) => {
  const base = import.meta.env.VITE_APP_TITLE || 'КиберДок'
  document.title = to.meta.title ? `${to.meta.title} — ${base}` : base
})

function roleHome(role) {
  switch (role) {
    case 'admin':
      return { name: 'admin-users' }
    case 'expert':
      return { name: 'expert' }
    case 'user':
      return { name: 'user-dashboard' }
    default:
      return { name: 'home' }
  }
}

export default router
