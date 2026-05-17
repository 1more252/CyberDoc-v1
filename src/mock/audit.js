// Audit-лог: append-only журнал действий (логин, CRUD'ы, admin-операции).
// Хранится в db.audit (массив, новейшие в начале — unshift). Чтение через
// auditListHandler (admin-only); ротация — cleanupAudit (по возрасту + row-cap).
//
// Изолирован от handlers.js, чтобы не таскать аудит-инфру по всем доменам.
// Циклической зависимости нет: handlers.js → audit.js (use), audit.js → db.js.
// Минорные хелперы (requireAdmin, clampPageSize) инлайнятся, чтобы не плодить
// import handlers.js → audit.js → handlers.js.

import { db } from './db.js'

export const AUDIT_HARD_CAP = 10_000

// Возвращает оперативную статистику для admin-панели: текущий размер,
// timestamp самой старой записи (или null), хард-кап. AUDIT_KEEP_DAYS
// живёт на уровне сервера — здесь его не знаем.
export function auditStats() {
  const rows = db.audit?.length ?? 0
  if (rows === 0) return { rows: 0, oldestAt: null, hardCap: AUDIT_HARD_CAP }
  // db.audit отсортирован новейшие→старейшие (unshift), значит самая старая
  // в конце массива. На пустых записях at может отсутствовать — берём 0.
  const oldest = db.audit[rows - 1]
  const oldestAt = typeof oldest?.at === 'number' ? oldest.at : null
  return { rows, oldestAt, hardCap: AUDIT_HARD_CAP }
}

// Локальные копии трivialьных хелперов — избегаем кругового импорта с handlers.js.
const PAGE_SIZE_HARD_MAX = Number(process.env.PAGE_SIZE_HARD_MAX) || 500
function clampPageSize(raw, fallback, max = 200) {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, Math.min(max, PAGE_SIZE_HARD_MAX))
}
function requireAdminGuard(caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  if (caller.role !== 'admin') return { status: 403, data: { error: 'forbidden' } }
  return null
}

export function logAudit(actor, action, target, details = '', ip = '') {
  const entry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    actor,
    action,
    target,
    details,
    at: Date.now()
  }
  // IP — опционален: старые вызовы (4 аргумента) его не передают, новые
  // (логин, регистрация, смена пароля) — передают. Не пишем пустое поле,
  // чтобы JSON-storage не пух от undefined.
  if (ip) entry.ip = ip
  db.audit.unshift(entry)
  // Хард-кап: глубже задача SIEM / бэкапов. Возрастная ротация — в cleanupAudit.
  if (db.audit.length > AUDIT_HARD_CAP) db.audit.length = AUDIT_HARD_CAP
}

// Подрезает audit по возрасту (старше maxAgeMs) и опциональному row-cap.
// Возвращает кол-во удалённых записей. Вызывается из maintenance-tick'а.
// Идемпотентна; для maxAgeMs <= 0 пропускает по возрасту (оставляет всё).
export function cleanupAudit(maxAgeMs = 0, maxRows = AUDIT_HARD_CAP) {
  if (!Array.isArray(db.audit) || db.audit.length === 0) return 0
  const before = db.audit.length
  let arr = db.audit
  if (maxAgeMs > 0) {
    const cutoff = Date.now() - maxAgeMs
    arr = arr.filter((e) => (e?.at ?? 0) >= cutoff)
  }
  if (maxRows > 0 && arr.length > maxRows) {
    // db.audit отсортирован новейшие→старейшие (unshift), берём префикс.
    arr = arr.slice(0, maxRows)
  }
  if (arr.length === before) return 0
  db.audit = arr
  return before - arr.length
}

// Сравнивает before/after по списку полей и возвращает только изменения.
// Пустой `before` — значит нечего логировать (вызывающий пусть решает).
function diffFields(before, after, fields) {
  const b = {}
  const a = {}
  for (const f of fields) {
    const bv = before?.[f]
    const av = after?.[f]
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      b[f] = bv
      a[f] = av
    }
  }
  return { before: b, after: a }
}

// audit-запись с JSON-diff'ом в details. Если diff пустой (никакие fields не
// поменялись) — не пишем, чтобы не засорять лог no-op PUT'ами.
export function logAuditDiff(actor, action, target, before, after, fields) {
  const diff = diffFields(before, after, fields)
  if (Object.keys(diff.before).length === 0) return
  logAudit(actor, action, target, JSON.stringify(diff))
}

// Хелперы парсинга дат: принимаем 'YYYY-MM-DD', ISO-строку, или unix-ms.
// Возвращаем ms или null если невалидно.
function toMs(v) {
  if (!v) return null
  const s = String(v).trim()
  if (!s) return null
  const n = Number(s)
  if (Number.isFinite(n) && n > 1e10) return n   // unix ms (≈ после 1970+)
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}
function isDateOnly(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())
}

export function auditListHandler(
  { page = 1, pageSize = 50, action = '', search = '', actor = '', dateFrom = '', dateTo = '' },
  caller
) {
  const guard = requireAdminGuard(caller)
  if (guard) return guard
  const p = Number(page) || 1
  const ps = clampPageSize(pageSize, 50)
  const q = String(search || '').trim().toLowerCase()
  const actorQ = String(actor || '').trim().toLowerCase()
  // dateFrom/dateTo принимаем как ISO-строки или unix-ms. Невалидные —
  // игнорируем (не валим запрос). Преобразуем в ms.
  const tsFrom = toMs(dateFrom)
  const tsTo = toMs(dateTo)

  let items = db.audit
  if (action) items = items.filter((a) => a.action === action)
  if (actorQ) items = items.filter((a) => a.actor.toLowerCase() === actorQ)
  if (tsFrom !== null) items = items.filter((a) => a.at >= tsFrom)
  // tsTo интерпретируем как «включительно до конца суток», если передали без
  // времени (YYYY-MM-DD → 00:00:00 → +1 день). Простейший хак: +24h при наличии.
  if (tsTo !== null) {
    const upper = isDateOnly(dateTo) ? tsTo + 86400_000 - 1 : tsTo
    items = items.filter((a) => a.at <= upper)
  }
  if (q) {
    items = items.filter(
      (a) =>
        a.actor.toLowerCase().includes(q) ||
        a.target.toLowerCase().includes(q) ||
        (a.details ?? '').toLowerCase().includes(q) ||
        (a.ip ?? '').toLowerCase().includes(q)
    )
  }
  const total = items.length
  const start = (p - 1) * ps
  return { status: 200, data: { items: items.slice(start, start + ps), total } }
}
