// Общий хелпер: процент заполнения хард-капа audit-лога + severity.
// Используется в AdminAuditPage (badge в шапке) и AdminSettingsPage (карточка
// с прогресс-баром). Дефолтная severity для «нормы» отличается по сайтам —
// карточка хочет 'success' (зелёный прогресс-бар), badge в шапке — нейтральный
// 'secondary' (серый, не отвлекающий).
export function auditFillStatus(rows, hardCap, { lowSeverity = 'success' } = {}) {
  if (!hardCap || typeof rows !== 'number') return null
  const pct = Math.min(100, Math.round((rows / hardCap) * 100))
  const severity = pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : lowSeverity
  return { pct, severity }
}
