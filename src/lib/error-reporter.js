// Глобальный сбор ошибок: Vue errorHandler + window error + unhandledrejection.
// Цели:
//   1) показать пользователю toast, что что-то пошло не так (вместо тихого фриза)
//   2) переслать структурированную ошибку на бэк (pino warn), чтобы видеть
//      реальные баги в проде, а не только то, что попало в локальную консоль.
//
// Anti-spam:
//   - dedup по hash(message + первая строка stack): не шлём одинаковую ошибку
//     чаще раза в 60s
//   - глобальный лимит: max 5 уникальных ошибок в минуту с этой сессии
//     (защищает от петель типа errorHandler→render→errorHandler)
//
// Send-механика: fetch с keepalive (а не axios), потому что (а) axios сам
// мог поломаться, (б) keepalive позволяет отправить отчёт во время unload.
import { useToast } from '@/ui/useToast.js'

const MOCK = import.meta.env.VITE_USE_MOCK_API === 'true'
const ENDPOINT = (import.meta.env.VITE_API_URL || '') + '/api/client-errors'

// Per-field size caps. KEEP IN SYNC с CLIENT_ERROR_LIMITS в server/index.js —
// бэк перепроверяет, иначе клиент-side кампинг бесполезен против ручного POST.
export const CLIENT_ERROR_LIMITS = Object.freeze({
  message: 500,
  stack: 4000,
  source: 300,
  url: 500,
  ua: 200,
  kind: 32,
  ts: 32
})

// Допустимые значения kind. KEEP IN SYNC с CLIENT_ERROR_KINDS на бэке.
export const CLIENT_ERROR_KINDS = Object.freeze({
  VUE: 'vue',
  WINDOW: 'window',
  PROMISE: 'promise',
  UNKNOWN: 'unknown'
})

const DEDUP_WINDOW_MS = 60_000
const GLOBAL_LIMIT_MAX = 5
const SEEN_GC_THRESHOLD = 100

const seen = new Map() // hash → lastSentAt
let globalWindowStart = 0
let globalCount = 0
let reentryGuard = false
let installed = false

function hashError(message, stack) {
  // djb2 по message + первой строке stack (там file:line:col — стабильный
  // идентификатор места ошибки, без timing-зависимых хвостов).
  const s = `${message}|${(stack || '').split('\n')[1] || ''}`
  let h = 5381 >>> 0
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return String(h)
}

function shouldReport(message, stack) {
  const now = Date.now()
  if (now - globalWindowStart > DEDUP_WINDOW_MS) {
    globalWindowStart = now
    globalCount = 0
  }
  if (globalCount >= GLOBAL_LIMIT_MAX) return false

  const h = hashError(message, stack)
  const last = seen.get(h) || 0
  if (now - last < DEDUP_WINDOW_MS) return false
  seen.set(h, now)

  if (seen.size > SEEN_GC_THRESHOLD) {
    for (const [k, t] of seen) {
      if (now - t > DEDUP_WINDOW_MS) seen.delete(k)
    }
  }

  globalCount++
  return true
}

function sendReport(payload) {
  if (MOCK) return
  try {
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: 'omit'
    }).catch(() => { /* best-effort, swallow */ })
  } catch { /* swallow */ }
}

// Нормализует исключение в плоский { message, stack } шейп. err может быть
// чем угодно — Error, string, null, объект с .reason (Promise rejection).
function fromError(err, kind, source) {
  return {
    message: err?.message || String(err ?? `Unknown ${kind} error`),
    stack: err?.stack,
    kind,
    source
  }
}

function reportError({ message, stack, kind, source }) {
  if (reentryGuard) return
  reentryGuard = true
  try {
    const msg = String(message || 'Unknown error').slice(0, CLIENT_ERROR_LIMITS.message)
    const stk = String(stack || '').slice(0, CLIENT_ERROR_LIMITS.stack)
    if (!shouldReport(msg, stk)) return

    if (import.meta.env.DEV) {

      console.error(`[error-reporter:${kind}]`, msg, source ? `(${source})` : '', stk)
    }

    try {
      useToast().error('Произошла ошибка. Попробуйте повторить действие или обновите страницу.')
    } catch { /* toast недоступен — игнорим */ }

    sendReport({
      message: msg,
      stack: stk,
      kind,
      source: source || null,
      url: typeof location !== 'undefined' ? location.href.slice(0, CLIENT_ERROR_LIMITS.url) : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, CLIENT_ERROR_LIMITS.ua) : '',
      ts: new Date().toISOString()
    })
  } finally {
    reentryGuard = false
  }
}

export function setupErrorReporting(app) {
  // Idempotency: HMR / повторный bootstrap в тестах не должны дублировать
  // window-listeners. Vue.errorHandler перетирается — это ok, всё равно один.
  if (installed) return
  installed = true

  // 1) Vue render/lifecycle ошибки. info содержит фазу ('render', 'setup',
  // 'mounted hook' etc.) — полезно для отладки.
  app.config.errorHandler = (err, _instance, info) => {
    reportError(fromError(err, CLIENT_ERROR_KINDS.VUE, info))
  }

  // 2) Синхронные window.onerror (несовместимый код в imported chunk,
  // сторонние скрипты, и т.п.).
  window.addEventListener('error', (e) => {
    // Игнорим resource-loading errors (img/script onerror) — они не
    // несут полезной диагностики, только спам.
    if (e.target && e.target !== window) return
    reportError(fromError(
      e.error || { message: e.message },
      CLIENT_ERROR_KINDS.WINDOW,
      e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : null
    ))
  }, true)

  // 3) Unhandled promise rejections. async-функции в store/actions могут
  // тихо упасть — без этого мы их вообще не видим.
  window.addEventListener('unhandledrejection', (e) => {
    reportError(fromError(e.reason, CLIENT_ERROR_KINDS.PROMISE, null))
  })
}
