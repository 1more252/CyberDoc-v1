import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/modules/auth/auth.store.js'

const USER_FLOW = [
  { to: '/dashboard/user', label: 'Главная', icon: 'bi-speedometer2', group: 'Кабинет', hint: 'Обзор кабинета и быстрые ссылки.' },
  { to: '/profile', label: 'Профиль', icon: 'bi-person-gear', group: 'Заполнение данных', hint: 'Заполните личные данные — это база для всех документов.' },
  { to: '/dashboard/organizations', label: 'Организации', icon: 'bi-building', group: 'Заполнение данных', hint: 'Заведите свои юр. лица и ИП.' },
  { to: '/dashboard/inn-registry', label: 'Реестр ИНН', icon: 'bi-list-columns-reverse', group: 'Заполнение данных', hint: 'Подгрузите контрагентов из ФНС.' },
  { to: '/dashboard/personal', label: 'Персонал', icon: 'bi-people', group: 'Заполнение данных', hint: 'Сотрудники организации (с массовым импортом из CSV).' },
  { to: '/dashboard/info-systems', label: 'Информационные системы', icon: 'bi-hdd-network', group: 'ИБ-учёт', hint: 'Карточки ИС: классификация, оператор, ПДн / КИИ / ГИС.' },
  { to: '/dashboard/equipment', label: 'Оборудование', icon: 'bi-pc-display', group: 'ИБ-учёт', hint: 'Учёт техники с журналом перемещений.' },
  { to: '/dashboard/software', label: 'Программное обеспечение', icon: 'bi-box-seam', group: 'ИБ-учёт', hint: 'Системное и прикладное ПО, привязанное к ИС.' },
  { to: '/dashboard/security-tools-db', label: 'Каталог СЗИ ФСТЭК', icon: 'bi-database-lock', group: 'ИБ-учёт', hint: 'Сертифицированные средства защиты (справочник).' },
  { to: '/dashboard/security-tools', label: 'Мои СЗИ', icon: 'bi-shield-check', group: 'ИБ-учёт', hint: 'Развёрнутые СЗИ с лицензиями и сроками.' },
  { to: '/dashboard/threat-models', label: 'Модели угроз', icon: 'bi-bug', group: 'ИБ-учёт', hint: 'Модели угроз ФСТЭК с моделью нарушителя и оценкой угроз.' },
  { to: '/dashboard/document-sets', label: 'Пакеты ОРД', icon: 'bi-folder-symlink', group: 'Документы', hint: 'Генератор комплектов нормативной документации.' },
  { to: '/dashboard/registry', label: 'Документы', icon: 'bi-clipboard-data', group: 'Документы', hint: 'Договоры, акты, счета.' },
  { to: '/dashboard/statistics', label: 'Статистика', icon: 'bi-bar-chart-line', group: 'Аналитика', hint: 'Итоги по платформе.' }
]

const ADMIN_FLOW = [
  { to: '/dashboard/admin/users', label: 'Пользователи', icon: 'bi-people', group: 'Администрирование', hint: 'Управление учётками.' },
  { to: '/dashboard/admin/audit', label: 'Журнал действий', icon: 'bi-journal-text', group: 'Администрирование', hint: 'История значимых событий.' },
  { to: '/dashboard/admin/settings', label: 'Настройки', icon: 'bi-gear', group: 'Администрирование', hint: 'Глобальные параметры платформы.' },
  { to: '/dashboard/expert/review', label: 'Очередь согласования', icon: 'bi-patch-check', group: 'Согласование', hint: 'Документы, ожидающие решения.' },
  { to: '/dashboard/organizations', label: 'Организации', icon: 'bi-building', group: 'Учёт', hint: 'Все организации.' },
  { to: '/dashboard/inn-registry', label: 'Реестр ИНН', icon: 'bi-list-columns-reverse', group: 'Учёт', hint: 'Контрагенты ФНС.' },
  { to: '/dashboard/personal', label: 'Персонал', icon: 'bi-people', group: 'Учёт', hint: 'Сотрудники всех организаций.' },
  { to: '/dashboard/info-systems', label: 'Информационные системы', icon: 'bi-hdd-network', group: 'ИБ-учёт', hint: 'Все ИС в системе.' },
  { to: '/dashboard/equipment', label: 'Оборудование', icon: 'bi-pc-display', group: 'ИБ-учёт', hint: 'Инвентарный учёт техники.' },
  { to: '/dashboard/software', label: 'Программное обеспечение', icon: 'bi-box-seam', group: 'ИБ-учёт', hint: 'Реестр ПО всех организаций.' },
  { to: '/dashboard/security-tools-db', label: 'Каталог СЗИ ФСТЭК', icon: 'bi-database-lock', group: 'ИБ-учёт', hint: 'Управление справочником сертифицированных СЗИ.' },
  { to: '/dashboard/security-tools', label: 'Мои СЗИ', icon: 'bi-shield-check', group: 'ИБ-учёт', hint: 'Все экземпляры СЗИ.' },
  { to: '/dashboard/threat-models', label: 'Модели угроз', icon: 'bi-bug', group: 'ИБ-учёт', hint: 'Все модели угроз в системе.' },
  { to: '/dashboard/document-sets', label: 'Пакеты ОРД', icon: 'bi-folder-symlink', group: 'Документы', hint: 'Все сгенерированные комплекты ОРД.' },
  { to: '/dashboard/registry', label: 'Документы', icon: 'bi-clipboard-data', group: 'Документы', hint: 'Все документы.' },
  { to: '/dashboard/statistics', label: 'Статистика', icon: 'bi-bar-chart-line', group: 'Аналитика', hint: 'Сводная аналитика.' },
  { to: '/profile', label: 'Профиль', icon: 'bi-person-gear', group: 'Аккаунт', hint: 'Личные данные и пароль.' }
]

const EXPERT_FLOW = [
  { to: '/dashboard/expert', label: 'Обзор', icon: 'bi-binoculars', group: 'Эксперт', hint: 'Сводка по очереди.' },
  { to: '/dashboard/expert/review', label: 'Очередь согласования', icon: 'bi-patch-check', group: 'Эксперт', hint: 'Ожидающие документы.' },
  { to: '/dashboard/organizations', label: 'Организации', icon: 'bi-building', group: 'Учёт', hint: 'Все организации.' },
  { to: '/dashboard/inn-registry', label: 'Реестр ИНН', icon: 'bi-list-columns-reverse', group: 'Учёт', hint: 'ИНН-контрагенты.' },
  { to: '/dashboard/personal', label: 'Персонал', icon: 'bi-people', group: 'Учёт', hint: 'Сотрудники организаций.' },
  { to: '/dashboard/info-systems', label: 'Информационные системы', icon: 'bi-hdd-network', group: 'ИБ-учёт', hint: 'Все ИС.' },
  { to: '/dashboard/equipment', label: 'Оборудование', icon: 'bi-pc-display', group: 'ИБ-учёт', hint: 'Учёт техники.' },
  { to: '/dashboard/software', label: 'Программное обеспечение', icon: 'bi-box-seam', group: 'ИБ-учёт', hint: 'Реестр ПО.' },
  { to: '/dashboard/security-tools-db', label: 'Каталог СЗИ ФСТЭК', icon: 'bi-database-lock', group: 'ИБ-учёт', hint: 'Справочник сертифицированных СЗИ.' },
  { to: '/dashboard/security-tools', label: 'Мои СЗИ', icon: 'bi-shield-check', group: 'ИБ-учёт', hint: 'Развёрнутые СЗИ.' },
  { to: '/dashboard/threat-models', label: 'Модели угроз', icon: 'bi-bug', group: 'ИБ-учёт', hint: 'Все модели угроз.' },
  { to: '/dashboard/document-sets', label: 'Пакеты ОРД', icon: 'bi-folder-symlink', group: 'Документы', hint: 'История сгенерированных комплектов.' },
  { to: '/dashboard/registry', label: 'Документы', icon: 'bi-clipboard-data', group: 'Документы', hint: 'Все документы.' },
  { to: '/dashboard/statistics', label: 'Статистика', icon: 'bi-bar-chart-line', group: 'Аналитика', hint: 'Аналитика.' },
  { to: '/profile', label: 'Профиль', icon: 'bi-person-gear', group: 'Аккаунт', hint: 'Личные данные.' }
]

export function flowForRole(role) {
  switch (role) {
    case 'admin':
      return ADMIN_FLOW
    case 'expert':
      return EXPERT_FLOW
    case 'user':
      return USER_FLOW
    default:
      return []
  }
}

export function useFlow(explicitPath) {
  const auth = useAuthStore()
  const route = useRoute()

  const flow = computed(() => flowForRole(auth.role))

  const idx = computed(() => {
    const path = explicitPath ?? route.path
    const exact = flow.value.findIndex((s) => s.to === path)
    if (exact >= 0) return exact
    return flow.value.findIndex((s) => path === s.to || path.startsWith(`${s.to}/`))
  })

  const currentStep = computed(() => (idx.value >= 0 ? flow.value[idx.value] ?? null : null))
  const nextStep = computed(() => {
    const i = idx.value
    if (i < 0 || i >= flow.value.length - 1) return null
    return flow.value[i + 1] ?? null
  })
  const prevStep = computed(() => (idx.value <= 0 ? null : flow.value[idx.value - 1] ?? null))
  const stepNumber = computed(() => Math.max(0, idx.value) + 1)
  const totalSteps = computed(() => flow.value.length)

  return { flow, currentStep, nextStep, prevStep, stepNumber, totalSteps }
}
