
export const INTRUDER_TYPE_LABEL = {
  external: 'Внешний',
  internal: 'Внутренний',
  mixed: 'Смешанный (внешний и внутренний)'
}

export const INTRUDER_POTENTIAL_LABEL = {
  low: 'Низкий',
  basic: 'Базовый',
  enhanced: 'Повышенный',
  high: 'Высокий'
}

export const INTRUDER_CAPABILITIES = [
  { id: 'network_access', name: 'Сетевой доступ к ИС' },
  { id: 'physical_access', name: 'Физический доступ к компонентам' },
  { id: 'user_account', name: 'Учётная запись пользователя' },
  { id: 'privileged_account', name: 'Привилегированный доступ' },
  { id: 'social_engineering', name: 'Возможности социальной инженерии' },
  { id: 'supply_chain', name: 'Доступ к цепочке поставок' }
]

export const LEVEL_OPTIONS = [
  { value: 'low', label: 'Низкая' },
  { value: 'medium', label: 'Средняя' },
  { value: 'high', label: 'Высокая' }
]
export const LEVEL_LABEL = {
  low: 'Низкая',
  medium: 'Средняя',
  high: 'Высокая'
}
export const LEVEL_BADGE = {
  low: 'text-bg-light',
  medium: 'text-bg-warning',
  high: 'text-bg-danger'
}

export const THREAT_CATEGORIES = [
  { id: 'access', name: 'Несанкционированный доступ' },
  { id: 'malware', name: 'Вредоносное ПО' },
  { id: 'physical', name: 'Физические угрозы' },
  { id: 'channel', name: 'Сетевые / канальные угрозы' },
  { id: 'insider', name: 'Внутренний нарушитель' },
  { id: 'environment', name: 'Среда / климатические факторы' }
]
export const THREAT_CATEGORY_LABEL = Object.fromEntries(
  THREAT_CATEGORIES.map((c) => [c.id, c.name])
)

const RELEVANCE_MATRIX = {
  low: { low: false, medium: false, high: false },
  medium: { low: false, medium: true, high: true },
  high: { low: false, medium: true, high: true }
}
export function isRelevant(probability, damage) {
  return RELEVANCE_MATRIX[probability]?.[damage] ?? false
}
