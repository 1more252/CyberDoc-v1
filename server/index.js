// ===========================================================================
// Express-бэк для apn-vue.
//
// Слои:
//   • helmet           — security-заголовки
//   • CORS             — '*' в деве, allowlist через ALLOWED_ORIGINS в проде
//   • compression      — gzip ответов >1KB
//   • rate-limit       — общий (300/мин) + login/register (20/15мин)
//   • express.json     — парсинг тел (limit 10mb)
//   • inflight + log   — req-id, метрики, медленные ответы (>100ms)
//   • READ_ONLY guard  — мутации → 503 при READ_ONLY=true
//   • per-user quota   — ≤ PER_USER_INFLIGHT_LIMIT (20) на юзера → 429
//   • ETag             — для read-only справочников (304 Not Modified)
//   • /health          — БД, RAM, inflight, peak, db-size, readOnly
//   • /metrics         — admin: totalRequests, byStatusClass, mean latency
//   • /api/admin/*     — wal-checkpoint, backup (admin-only)
//   • /api/*           — диспетчер на handleMockRequest
//   • static + SPA     — если SERVE_STATIC=true, отдаём dist/
//
// Запуск:
//   npm run server                         — dev (порт 3001)
//   SERVE_STATIC=true npm run server       — отдаёт ещё и dist/ (prod)
//   JWT_SECRET=... npm run server          — реальный секрет для прода
//   ALLOWED_ORIGINS=https://a,https://b … — CORS allowlist
//   READ_ONLY=true npm run server          — режим обслуживания
// ===========================================================================

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import { randomUUID, createHash } from 'node:crypto'
import { existsSync, statSync, mkdirSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleMockRequest, setMockDelayMs, setTokenSigner, setTokenVerifier, setPasswordHasher, cleanupExpiredSessions, cleanupAudit, cleanupLoginFailures, loginFailuresSize, loginFailuresByIpSize, refreshRotationStats } from '../src/mock/handlers.js'
import { makeAccessToken, makeRefreshToken } from './jwt.js'
import { hash as pwHash, verify as pwVerify, isHashed as pwIsHashed } from './password.js'
import {
  loadFromDisk,
  scheduleSave,
  flushSync,
  flushPending,
  importLegacyJsonIfEmpty,
  hasPendingWrites,
  getDbPath,
  countUsers,
  walCheckpoint,
  backupTo,
  pruneOldBackups,
  getTableStats,
  verifyBackup,
  pingDb
} from './storage.js'
import { verifyJwt } from './jwt.js'
import { logger, serverLog, maintLog, clientErrLog } from './logger.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = resolve(HERE, '..', 'dist')

const PORT = Number(process.env.PORT) || 3001
const HOST = process.env.HOST || '127.0.0.1'
const SERVE_STATIC = process.env.SERVE_STATIC === 'true'
const TRUST_PROXY = process.env.TRUST_PROXY === 'true'

// Лимит одновременных запросов на одного юзера. Защищает от ретраев в цикле
// и зависшего uploader'а. Chunked-импорт идёт по ≤100 последовательно, не
// мешает. Анон-запросы ограничивает общий rate-limit.
const PER_USER_INFLIGHT_LIMIT = Number(process.env.PER_USER_INFLIGHT_LIMIT) || 20

// Парный лимит — concurrent inflight на IP. rateLimit считает req/min,
// а это — сколько одновременных connection'ов держит один IP. Закрывает
// slow-loris / login-flood (200 параллельных scrypt'ов с одного хоста)
// и анонимный трафик в целом (per-user не сработает без токена).
// 50 — щедро для NAT (CGNAT, корп.офис), жёстко для атакующего бота.
const PER_IP_INFLIGHT_LIMIT = Number(process.env.PER_IP_INFLIGHT_LIMIT) || 50

// Глобальный потолок одновременных запросов на сервер. Выше него — 503
// с Retry-After: клиент должен отступить, а не копить очередь, которая всё
// равно выберет request-timeout и сожжёт ресурсы впустую. Это backpressure
// поверх per-user/per-IP: даже легитимный трафик от множества IP'ов не
// должен утопить сервер. 800 — потолок ~16× PER_IP_INFLIGHT_LIMIT,
// т.е. сервер ловит шторм только когда десятки IP одновременно нагружают.
const MAX_INFLIGHT_GLOBAL = Number(process.env.MAX_INFLIGHT_GLOBAL) || 800
const BACKPRESSURE_RETRY_AFTER_S = Number(process.env.BACKPRESSURE_RETRY_AFTER_S) || 2

// Сколько ждать дренажа inflight перед shutdown'ом.
const SHUTDOWN_DRAIN_MS = Number(process.env.SHUTDOWN_DRAIN_MS) || 5000

// CORS-allowlist. В dev по умолчанию '*' (UX); в проде ОБЯЗАТЕЛЬНО задать
// через ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com.
// Открытый CORS в проде — это «любой сайт может дёрнуть нашу API из браузера
// жертвы», классический CSRF-vector при stateful-сессиях.
const IS_PROD = process.env.NODE_ENV === 'production'
if (IS_PROD && !process.env.ALLOWED_ORIGINS) {
  throw new Error('ALLOWED_ORIGINS is required in production (e.g. https://app.example.com,https://admin.example.com)')
}
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || (IS_PROD ? '' : '*'))
  .split(',').map((s) => s.trim()).filter(Boolean)

// Read-only режим: все мутации возвращают 503. Полезно при миграциях/backup'ах,
// чтобы клиенты получали явный сигнал и могли отступить.
const READ_ONLY = process.env.READ_ONLY === 'true'

// Папка для бэкапов; создаётся лениво при первом запросе бэкапа.
const BACKUP_DIR = resolve(HERE, '..', 'data', 'backups')

// Порог для warning по размеру -wal. Если -wal распух (нет checkpoint'ов
// долго) — обычно симптом «висящих» readers или забытого админа. 100MB
// для нашей нагрузки = аномалия, повод дёрнуть /api/admin/wal-checkpoint.
const WAL_ALERT_MB = Number(process.env.WAL_ALERT_MB) || 100

// Авто-checkpoint срабатывает заранее, до alert-порога — чтобы админу не
// приходилось ничего делать руками. По умолчанию 50MB (половина alert'а).
const WAL_AUTO_CHECKPOINT_MB = Number(process.env.WAL_AUTO_CHECKPOINT_MB) || 50

// Time-trigger для WAL-checkpoint: даже если -wal не распух (мало записи),
// его всё равно полезно сбрасывать раз в час. Иначе при низкой нагрузке
// WAL остаётся «вечно открытым», readers в SQLite видят старые версии,
// и на shutdown'е flush растягивается. 1ч — баланс между «дёргаем диск
// слишком часто» и «БД фактически без checkpoint'а сутками».
const WAL_MAX_AGE_MS = Number(process.env.WAL_MAX_AGE_MS) || 60 * 60_000

// Сколько дней хранить бэкапы в data/backups/. Старее — чистятся после
// каждого создания бэкапа + раз в интервал maintenance.
const BACKUP_KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS) || 30

// Авто-бэкап в maintenance: раз в AUTO_BACKUP_INTERVAL_MS делаем VACUUM INTO
// data/backups/. Без этого админу надо самому дёргать /api/admin/backup — и в
// 90% случаев он этого не делает, пока не случится катастрофа. Дефолт 24ч —
// типичный compromise (потеря не более суток при ext4 corruption / диск-фейле).
// 0 = выключено (для дев/CI/контейнеров с внешним бэкапом).
const AUTO_BACKUP_INTERVAL_MS = Number(process.env.AUTO_BACKUP_INTERVAL_MS) || 24 * 60 * 60_000

// Сколько дней хранить записи audit-лога. Старее — подрезаются в maintenance.
// 90 дней покрывает квартальные ретроспективы и compliance-окно по умолчанию,
// при этом не даёт массиву пухнуть на годы. Хард-кап AUDIT_HARD_CAP (10k записей,
// в handlers.js) служит safety-сеткой для бурстов.
const AUDIT_KEEP_DAYS = Number(process.env.AUDIT_KEEP_DAYS) || 90

// Интервал фоновой maintenance-задачи: WAL auto-checkpoint + backup-prune.
// Дёшево (две stat-операции), можно делать часто. 5 минут — компромисс
// между «не реагируем на распухание мгновенно» и «не дёргаем диск зря».
const MAINTENANCE_INTERVAL_MS = Number(process.env.MAINTENANCE_INTERVAL_MS) || 5 * 60_000

// Максимальная длина любого строкового поля в JSON-body. Защищает от
// `name='A'.repeat(10MB)` — без этого DB пухнет, search-индексы тормозят,
// list-ответы превращаются в мегабайты. 64KB достаточно для документов
// (HTML/markdown), на 2 порядка меньше body-limit (10MB).
const MAX_FIELD_LEN = Number(process.env.MAX_FIELD_LEN) || 65_536
// Глубина рекурсии при clamp'е — защита от циклических/глубоких структур.
const MAX_FIELD_DEPTH = 16

// --- per-request timeout cap -------------------------------------------
// Зависший handler (бесконечный цикл в фильтре, забытый await, висящая
// внешняя HTTP-зависимость) держит socket и слот в inflight-квоте до
// бесконечности — несколько таких и весь PER_IP/PER_USER лимит съеден.
// Каждый запрос получает hard-таймаут: на регулярные ручки — 30s, на
// тяжёлые (bulk-upsert, wal-checkpoint, backup) — 120s (импорт 100×
// строк под нагрузкой может занять 30-40s, оставляем запас).
// По истечении: ответ 504 + force-destroy socket'а (TCP RST), чтобы
// клиент не висел в ожидании FIN'а и handler гарантированно отвалился.
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 30_000
const BULK_TIMEOUT_MS = Number(process.env.BULK_TIMEOUT_MS) || 120_000

// --- bootstrap -----------------------------------------------------------

// MOCK_DELAY_MS=200 — искусственная задержка на каждый dispatcher-вызов.
// Используется в load-/смок-тестах, в проде должен быть 0 (default).
setMockDelayMs(Number(process.env.MOCK_DELAY_MS) || 0)
setTokenSigner({ makeAccessToken, makeRefreshToken })
setTokenVerifier(verifyJwt)
setPasswordHasher({ hash: pwHash, verify: pwVerify, isHashed: pwIsHashed })

importLegacyJsonIfEmpty()
const loaded = await loadFromDisk()
serverLog.info(loaded ? 'loaded data from app.db' : 'cold start (empty db)')

const app = express()
if (TRUST_PROXY) app.set('trust proxy', 1)

// --- security & infra middleware ---------------------------------------

app.use(
  helmet({
    contentSecurityPolicy: SERVE_STATIC
      ? {
          // Vite-сборка SPA — inline-стили допустимы; внешних источников нет.
          directives: {
            'default-src': ["'self'"],
            'script-src': ["'self'"],
            'style-src': ["'self'", "'unsafe-inline'"],
            'img-src': ["'self'", 'data:'],
            'font-src': ["'self'", 'data:'],
            'connect-src': ["'self'"]
          }
        }
      : false
  })
)
// CORS: либо «*» (дев), либо строгий allowlist (прод).
const corsOptions = {
  exposedHeaders: ['X-Request-Id', 'ETag'],
  ...(ALLOWED_ORIGINS.includes('*')
    ? {}
    : {
        origin: (origin, cb) => {
          // Запросы без Origin (curl, same-origin server-side) пропускаем —
          // браузерные кросс-доменные обязаны слать Origin.
          if (!origin) return cb(null, true)
          cb(null, ALLOWED_ORIGINS.includes(origin))
        }
      })
}
app.use(cors(corsOptions))
serverLog.info({ cors: ALLOWED_ORIGINS.includes('*') ? 'open' : 'allowlist', origins: ALLOWED_ORIGINS }, 'CORS configured')
if (READ_ONLY) serverLog.warn('READ_ONLY mode: mutations will return 503')
// gzip всех ответов >1KB. JSON-ответы списков сжимаются в 4–10×.
app.use(compression({ threshold: 1024 }))

// --- per-route body-size guard ----------------------------------------
// Глобальный 10MB-лимит express.json — потолок, но не дискриминирующий:
// /auth/login физически не нуждается в 10MB body. Здесь — таблица
// match-prefix → bytes. Срабатывает ДО json-parser'а: если клиент честно
// прислал Content-Length и он превышает лимит, отбиваем 413 без буферизации
// байтов. Если Content-Length нет/соврали — поймает express.json (его
// лимит остаётся 10MB как defence-in-depth).
//
// Порядок имеет значение: первый матч по (method,prefix) выигрывает,
// поэтому более специфичные prefixes — выше.
const BODY_SIZE_LIMITS = [
  { method: 'POST', prefix: '/api/auth/login', bytes: 4 * 1024 },
  { method: 'POST', prefix: '/api/auth/register', bytes: 4 * 1024 },
  { method: 'POST', prefix: '/api/auth/refresh', bytes: 1 * 1024 },
  { method: 'POST', prefix: '/api/auth/logout', bytes: 1 * 1024 },
  { method: 'POST', prefix: '/api/admin/change-password', bytes: 4 * 1024 },
  { method: 'POST', prefix: '/api/client-errors', bytes: 20 * 1024 },
  // Bulk-upsert — единственная ручка, которая легитимно ест мегабайты.
  // 10MB совпадает с глобальным express.json — больше не пустим вообще.
  { method: 'POST', prefix: '/api/inn-registry/bulk-upsert', bytes: 10 * 1024 * 1024 }
]
// Default для всего остального POST/PUT/PATCH. 1MB покрывает запись оборудования
// с длинным description без 10MB фуража для атак.
const DEFAULT_BODY_LIMIT = Number(process.env.DEFAULT_BODY_LIMIT) || 1 * 1024 * 1024

function bodyLimitFor(method, path) {
  for (const e of BODY_SIZE_LIMITS) {
    if (e.method === method && path.startsWith(e.prefix)) return e.bytes
  }
  return DEFAULT_BODY_LIMIT
}

// Округление bytes → MB с заданной точностью. Возвращает Number, чтобы и в
// JSON-ответе /health, и в structured-логе maintenance, поле было числовым
// (а не string из toFixed).
function bytesToMB(bytes, decimals = 1) {
  const f = 10 ** decimals
  return Math.round(((bytes ?? 0) / 1024 / 1024) * f) / f
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])

app.use((req, res, next) => {
  if (!BODY_METHODS.has(req.method)) return next()
  const cl = Number(req.headers['content-length'])
  if (!Number.isFinite(cl) || cl <= 0) return next() // unknown → express.json дожмёт
  const limit = bodyLimitFor(req.method, req.path)
  if (cl > limit) {
    return res.status(413).json({
      error: 'payload_too_large',
      message: `Тело запроса слишком большое (${cl} байт, лимит ${limit}).`,
      limit,
      got: cl
    })
  }
  next()
})

// --- per-request hard timeout -----------------------------------------
// Таблица override'ов: первый prefix-match по (method,path) выигрывает.
// Всё остальное → REQUEST_TIMEOUT_MS. Структурно идентично BODY_SIZE_LIMITS,
// специально — чтобы политика timeout'ов читалась так же, как политика тел.
const TIMEOUT_OVERRIDES = [
  { method: 'POST', prefix: '/api/inn-registry/bulk-upsert', ms: BULK_TIMEOUT_MS },
  { method: 'POST', prefix: '/api/admin/wal-checkpoint', ms: BULK_TIMEOUT_MS },
  { method: 'POST', prefix: '/api/admin/backup', ms: BULK_TIMEOUT_MS }
]
function timeoutFor(method, path) {
  for (const e of TIMEOUT_OVERRIDES) {
    if (e.method === method && path.startsWith(e.prefix)) return e.ms
  }
  return REQUEST_TIMEOUT_MS
}

let requestTimeoutsTotal = 0
app.use((req, res, next) => {
  const ms = timeoutFor(req.method, req.path)
  const timer = setTimeout(() => {
    if (res.headersSent) return // ответ уже пошёл — поздно прерывать
    requestTimeoutsTotal++
    try {
      res.status(504).json({
        error: 'request_timeout',
        message: `Запрос превысил лимит ${ms}мс и был прерван сервером.`,
        limitMs: ms
      })
    } catch {
      // если res уже закрыт — игнорируем, всё равно destroy()
    }
    // force-destroy socket: handler в JS-цикле никак не остановить, но
    // мы хотя бы перестаём держать TCP-соединение и слот в inflight'е.
    try { req.socket?.destroy() } catch { /* socket уже мёртв — ok */ }
  }, ms)
  // clearTimeout как на finish, так и на close — finish не вызывается
  // если клиент оборвал коннект, close — наоборот не вызывается если
  // ответ ушёл штатно. Оба нужны, иначе таймеры протекают.
  const clear = () => clearTimeout(timer)
  res.on('finish', clear)
  res.on('close', clear)
  next()
})

app.use(express.json({ limit: '10mb' }))

// --- field-length clamp ------------------------------------------------
// Идёт сразу после json-парсера: каждое строковое поле в req.body
// усекается до MAX_FIELD_LEN. Это in-place, мутирует input — хендлеры
// получают уже-обработанные данные, обходных путей нет. На non-object
// body (массив, null) применяется тот же walker, который умеет рекурсию.
//
// Trade-off: иногда обрезание невидимо для пользователя — поэтому добавляем
// маркер `[…clamped:N]` в конец, чтобы при debug'е было ясно. На клиенте
// это не парсится (просто часть строки), на сервере отличимо.

function clampStrings(node, depth) {
  if (depth > MAX_FIELD_DEPTH) return node
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i]
      if (typeof v === 'string') {
        if (v.length > MAX_FIELD_LEN) node[i] = v.slice(0, MAX_FIELD_LEN) + `[…clamped:${v.length}]`
      } else if (v && typeof v === 'object') {
        clampStrings(v, depth + 1)
      }
    }
    return node
  }
  for (const k of Object.keys(node)) {
    const v = node[k]
    if (typeof v === 'string') {
      if (v.length > MAX_FIELD_LEN) node[k] = v.slice(0, MAX_FIELD_LEN) + `[…clamped:${v.length}]`
    } else if (v && typeof v === 'object') {
      clampStrings(v, depth + 1)
    }
  }
  return node
}

app.use((req, _res, next) => {
  if (req.body && typeof req.body === 'object') clampStrings(req.body, 0)
  next()
})

// --- inflight tracking + request-id + structured logging ---------------
// Каждый запрос получает UUID (в X-Request-Id и логах). Inflight считаем
// глобально и пер-юзер; декремент по 'close' а не 'finish' — иначе при
// обрыве соединения счётчик утечёт.

let inflight = 0
let peakInflight = 0
const inflightByUser = new Map()
// Парная структура: concurrent count per IP. Анон-запросы и неавторизованные
// (login-flood, slow-POST) ограничиваются именно здесь.
const inflightByIp = new Map()

// --- метрики ------------------------------------------------------------
// Лёгкие in-memory счётчики; не Prometheus-grade, но даёт картину тренда
// без внешних зависимостей. Сбрасываются при рестарте — для большего нужен
// внешний exporter.
const metrics = {
  startedAt: Date.now(),
  totalRequests: 0,
  byStatusClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
  byMethod: {},
  // UA-классы: видно, кто грузит — реальные пользователи (browser), боты-сканеры
  // (bot), скрипты/CLI (cli), либо неопознанные (unknown). Без UA-парсинга
  // (regexp по подстроке) — для трендов достаточно, парсер не нужен.
  byUaClass: { browser: 0, bot: 0, cli: 0, unknown: 0 },
  slowRequests: 0,      // >500ms
  errorResponses: 0,    // 5xx
  totalLatencyMs: 0,    // сумма для подсчёта среднего
  // Сколько запросов отбили по глобальному backpressure-капу (503).
  // Это не то же самое, что 503 от shutdown'а или read-only — это
  // именно перегрузка сервера, нужен отдельный счётчик для тренда.
  backpressureShed: 0
}

// Грубая UA-классификация. Никакой репутации, просто bucket для метрик.
// Порядок проверки важен: 'bot' идёт перед 'browser', т.к. многие краулеры
// маскируются под Chrome (Googlebot и т.п.).
function classifyUa(ua) {
  if (!ua) return 'unknown'
  const s = ua.toLowerCase()
  if (s.includes('bot') || s.includes('crawler') || s.includes('spider') || s.includes('scanner')) return 'bot'
  if (s.startsWith('curl/') || s.startsWith('wget/') || s.includes('python-requests') || s.includes('node-fetch') || s.includes('axios')) return 'cli'
  if (s.includes('mozilla/') || s.includes('chrome/') || s.includes('safari/') || s.includes('firefox/')) return 'browser'
  return 'unknown'
}

// --- per-route latency tracking -----------------------------------------
// Ring-buffer выборка latencies на ручку: O(1) запись, p50/p95/p99 за O(k log k)
// при чтении (только в /metrics, не на горячем пути). k=200 — компромисс:
// статистика стабильная, память ограничена (200 чисел × ~50 ручек × 8 байт ≈ 80KB).
const LATENCY_SAMPLES = 200
// Hard-cap на кол-во отслеживаемых ручек. Если кто-то начнёт фаззить URL'ы —
// после порога новые route'ы складываются в спец-bucket 'other' вместо роста Map.
const ROUTE_METRICS_MAX = 100
const routeMetrics = new Map() // key → {count, totalMs, samples, idx, filled, slow, baselineP95, lastAlertAt}

// Slow-burn detector: после того как ring заполнен впервые, фиксируем baselineP95.
// Дальше каждые SLOW_BURN_CHECK_EVERY сэмплов сравниваем текущий p95: если
// в SLOW_BURN_MULTIPLIER раз хуже baseline — пишем warning. Тротлим на ручку,
// чтобы не зафлудить лог при затяжной деградации. baseline не двигается —
// иначе плавная деградация «нормализуется» через час и алерт замолкнет.
const SLOW_BURN_MULTIPLIER = Number(process.env.SLOW_BURN_MULTIPLIER) || 2
const SLOW_BURN_CHECK_EVERY = 50
const SLOW_BURN_ALERT_THROTTLE_MS = 5 * 60_000
// Ручки с baseline <SLOW_BURN_MIN_BASELINE_MS — слишком шумные для ratio:
// 1мс → 3мс это «×3», но это шум планировщика, не деградация. Игнорим.
const SLOW_BURN_MIN_BASELINE_MS = 5

// Нормализатор пути в стабильный ключ: режем query, заменяем динамические сегменты
// (числовые id, UUID, наши `audit-…`, `sess-…`, `org-…` etc.) на ':id', чтобы
// /api/users/123 и /api/users/456 шли в одну bucket.
const DYNAMIC_PREFIX_RE = /^(audit|sess|org|user|eq|doc|sw|st|threat|inn|psn|set)-/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function normalizeRouteKey(method, url) {
  const q = url.indexOf('?')
  const path = q >= 0 ? url.slice(0, q) : url
  const segs = path.split('/').map((s) => {
    if (!s) return s
    if (/^\d+$/.test(s)) return ':id'
    if (UUID_RE.test(s)) return ':id'
    if (DYNAMIC_PREFIX_RE.test(s)) return ':id'
    return s
  })
  return `${method} ${segs.join('/')}`
}

function recordRouteLatency(key, ms) {
  let r = routeMetrics.get(key)
  if (!r) {
    if (routeMetrics.size >= ROUTE_METRICS_MAX) {
      // Cap-busy: складываем в 'other', чтобы не плодить bucket'ы при фаззинге.
      key = `${key.split(' ', 1)[0]} :other`
      r = routeMetrics.get(key)
    }
    if (!r) {
      r = { count: 0, totalMs: 0, samples: new Array(LATENCY_SAMPLES).fill(0), idx: 0, filled: 0, slow: 0 }
      routeMetrics.set(key, r)
    }
  }
  r.count++
  r.totalMs += ms
  if (ms > 500) r.slow++
  r.samples[r.idx] = ms
  r.idx = (r.idx + 1) % LATENCY_SAMPLES
  if (r.filled < LATENCY_SAMPLES) r.filled++

  // Slow-burn check: запускается только когда ring впервые заполнился (значит
  // baseline репрезентативный, не от 5 запросов) и нечасто — раз в N сэмплов.
  if (r.filled === LATENCY_SAMPLES) {
    if (r.baselineP95 == null) {
      r.baselineP95 = routeQuantile(r, 0.95)
    } else if (r.count % SLOW_BURN_CHECK_EVERY === 0) {
      const cur = routeQuantile(r, 0.95)
      const threshold = Math.max(SLOW_BURN_MIN_BASELINE_MS, r.baselineP95 * SLOW_BURN_MULTIPLIER)
      if (cur >= threshold) {
        const now = Date.now()
        if (!r.lastAlertAt || now - r.lastAlertAt > SLOW_BURN_ALERT_THROTTLE_MS) {
          const ratio = r.baselineP95 > 0 ? (cur / r.baselineP95).toFixed(1) : '∞'
          serverLog.warn({ slowBurn: true, route: key, p95: cur, baseline: r.baselineP95, ratio, samples: r.count }, 'route p95 regressed')
          r.lastAlertAt = now
        }
      }
    }
  }
}

// Sort + index — k log k, не вызывается в горячем пути.
function routeQuantile(r, q) {
  if (r.filled === 0) return 0
  const sorted = r.samples.slice(0, r.filled).sort((a, b) => a - b)
  return sorted[Math.min(r.filled - 1, Math.floor(r.filled * q))]
}

// Снапшот всех route'ов с агрегатами для /metrics. Возвращает массив
// {route, count, meanMs, p50, p95, p99, slowCount}, отсортированный по count desc.
function routeMetricsSnapshot() {
  const out = []
  for (const [key, r] of routeMetrics) {
    out.push({
      route: key,
      count: r.count,
      meanMs: r.count > 0 ? Math.round((r.totalMs / r.count) * 100) / 100 : 0,
      p50: routeQuantile(r, 0.5),
      p95: routeQuantile(r, 0.95),
      p99: routeQuantile(r, 0.99),
      slowCount: r.slow
    })
  }
  out.sort((a, b) => b.count - a.count)
  return out
}

function bumpUser(username, delta) {
  if (!username) return
  const cur = inflightByUser.get(username) || 0
  const next = cur + delta
  if (next <= 0) inflightByUser.delete(username)
  else inflightByUser.set(username, next)
}

// Парная функция к bumpUser — общий контракт для двух Map'ов: при <=0
// удаляем ключ, чтобы Map не пух «нулями» после завершившихся IP.
function bumpIp(ip, delta) {
  if (!ip) return
  const cur = inflightByIp.get(ip) || 0
  const next = cur + delta
  if (next <= 0) inflightByIp.delete(ip)
  else inflightByIp.set(ip, next)
}

// Достаём username из Bearer-токена ПРОВЕРИВ подпись и exp. Это используется
// для per-user квоты и квоты «не учитывать левые токены». Без verify атакующий
// мог подсунуть произвольный sub и сбивать жертве inflight-счётчик.
function callerName(req) {
  // Если уже проверили в jwtVerifyMiddleware — переиспользуем результат.
  if (req._verifiedJwt !== undefined) {
    return req._verifiedJwt?.sub || req._verifiedJwt?.username || null
  }
  const auth = req.headers.authorization || ''
  if (!auth.startsWith('Bearer ')) return null
  const payload = verifyJwt(auth.slice(7))
  return payload?.sub || payload?.username || null
}

app.use((req, res, next) => {
  const reqId = req.headers['x-request-id'] || randomUUID()
  req.reqId = reqId
  res.setHeader('X-Request-Id', reqId)
  const t0 = Date.now()

  inflight++
  if (inflight > peakInflight) peakInflight = inflight
  const user = callerName(req)
  req._user = user
  bumpUser(user, +1)
  const ip = req.ip
  req._ip = ip
  bumpIp(ip, +1)

  let released = false
  const release = () => {
    if (released) return
    released = true
    inflight--
    bumpUser(user, -1)
    bumpIp(ip, -1)
  }
  res.on('close', release)
  res.on('finish', () => {
    const ms = Date.now() - t0
    // Метрики: считаем всё, но без percentile-tracking (лишний overhead).
    metrics.totalRequests++
    metrics.totalLatencyMs += ms
    if (ms > 500) metrics.slowRequests++
    const cls = `${Math.floor(res.statusCode / 100)}xx`
    if (metrics.byStatusClass[cls] !== undefined) metrics.byStatusClass[cls]++
    if (res.statusCode >= 500) metrics.errorResponses++
    metrics.byMethod[req.method] = (metrics.byMethod[req.method] || 0) + 1
    const uaClass = classifyUa(req.headers['user-agent'])
    metrics.byUaClass[uaClass]++
    // Per-route reservoir: O(1) запись, percentile-stats читаются только в /metrics.
    recordRouteLatency(normalizeRouteKey(req.method, req.originalUrl), ms)

    // Логируем все 4xx/5xx + медленные (>100ms). 2xx быстрые — молчим.
    if (ms > 100 || res.statusCode >= 400) {
      const payload = {
        reqId,
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        ms,
        ip: req.ip
      }
      if (res.statusCode >= 500) logger.error(payload, 'req')
      else if (res.statusCode >= 400) logger.warn(payload, 'req')
      else logger.info(payload, 'req')
    }
  })
  next()
})

// --- /health ------------------------------------------------------------
// uptime + БД (count users, db.size), память, inflight, pendingWrites.
// Дёшево (<1ms) — можно дёргать раз в секунду из uptime-чекера.

const STARTED_AT = Date.now()

// Собирает stat по триаде sqlite-файлов (.db, .db-wal, .db-shm). В WAL-режиме
// данные распределены между ними. Отсутствующий файл — норма (ещё не было ни
// одного writer'а), молча пропускаем. Возвращает {db, '-wal', '-shm'} → {sizeBytes, mtime}.
function statDbFiles() {
  const dbPath = getDbPath()
  const out = {}
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      const st = statSync(dbPath + suffix)
      out[suffix || 'db'] = { sizeBytes: st.size, mtime: st.mtime }
    } catch { /* нет файла */ }
  }
  return out
}

// Единое место правды для readiness-логики. И HEAD, и GET /ready ходят сюда,
// чтобы не разъехались критерии готовности. `reason` нужен только GET'у —
// HEAD отбрасывает его и шлёт пустое тело.
function readinessState() {
  if (shuttingDown) return { ok: false, reason: 'shutting_down' }
  if (READ_ONLY) return { ok: false, reason: 'read_only' }
  const users = countUsers()
  if (users < 0) return { ok: false, reason: 'db_unavailable' }
  if (users === 0) return { ok: false, reason: 'db_empty' }
  return { ok: true }
}

// HEAD-варианты для LB-проб: load-balancer'у не нужно тело, достаточно
// статус-кода. Без app.head() Express 404'ит HEAD-запросы на app.get()-роуты.
app.head('/health', (_req, res) => res.status(200).end())
app.head('/version', (_req, res) => res.status(200).end())
app.head('/ready', (_req, res) => res.status(readinessState().ok ? 200 : 503).end())

app.get('/health', (req, res) => {
  const mem = process.memoryUsage()
  // Deep-режим: дополнительно дёргаем SQLite (SELECT 1 + pragma). Полезен
  // в k8s readiness, когда «файл на месте, но БД залочена» — обычный /health
  // об этом не узнает. Стоит в среднем 0.1-0.5мс. Запускаем только по явному
  // запросу — чтобы базовый /health оставался free от БД и не мог упасть
  // во время checkpoint'а/backup'а.
  const deep = req.query.deep === '1' || req.query.deep === 'true'
  const dbProbe = deep ? pingDb() : null
  // app.db + -wal + -shm: в WAL-режиме реальные данные лежат в -wal до
  // checkpoint'а, без суммы размер кажется аномально малым. -wal выносим
  // отдельно (раздутый -wal — частый источник «откуда место кончилось»).
  const files = statDbFiles()
  const dbSize = (files.db?.sizeBytes ?? 0) + (files['-wal']?.sizeBytes ?? 0) + (files['-shm']?.sizeBytes ?? 0)
  const walSize = files['-wal']?.sizeBytes ?? 0
  const walSizeMB = bytesToMB(walSize, 2)

  // Deep-probe сделал select 1 — если упал, /health тоже должен сигналить
  // не-200, иначе LB будет держать pod в ротации с битой БД.
  const overallOk = !dbProbe || dbProbe.ok
  res.status(overallOk ? 200 : 503).json({
    ok: overallOk,
    uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
    node: process.version,
    version: process.env.npm_package_version || '0.0.0',
    env: process.env.NODE_ENV || 'development',
    db: {
      users: countUsers(),
      pendingWrites: hasPendingWrites(),
      sizeMB: bytesToMB(dbSize, 2),
      walSizeMB,
      walAlert: walSizeMB > WAL_ALERT_MB,
      // dbProbe — undefined в обычном режиме, объект {ok, latencyMs, ...} в deep
      probe: dbProbe || undefined
    },
    mem: {
      rssMB: bytesToMB(mem.rss, 2),
      heapUsedMB: bytesToMB(mem.heapUsed, 2),
      heapTotalMB: bytesToMB(mem.heapTotal, 2)
    },
    inflight: {
      total: inflight,
      peak: peakInflight,
      uniqueUsers: inflightByUser.size,
      uniqueIps: inflightByIp.size,
      cap: MAX_INFLIGHT_GLOBAL,
      shed: metrics.backpressureShed
    },
    // Размер lockout-map: важный signal под атакой. Норма <100, тысячи —
    // повод смотреть rate-limit логи и blocking-rules перед сервером.
    // Per-username и per-IP трекеры — разные сигнатуры атак (см. handlers.js).
    lockoutEntries: loginFailuresSize(),
    lockoutIpEntries: loginFailuresByIpSize(),
    // Кумулятивный счётчик 504-таймаутов: ненулевое значение значит —
    // в коде есть зависающие handler'ы (или backend под честной перегрузкой).
    requestTimeouts: requestTimeoutsTotal,
    // Rotation/replay: replays>0 значит был перехват refresh'а (либо bug
    // в клиенте, который шлёт один токен дважды). Любое значение — повод
    // посмотреть audit-лог с action=auth.refresh_replay.
    refresh: refreshRotationStats(),
    // Возраст последнего успешного авто-бэкапа в секундах. lastAutoBackupAt
    // инициализируется STARTED_AT, поэтому до первого бэкапа это просто uptime.
    // Алерт-правило: ageSec > AUTO_BACKUP_INTERVAL_MS * 1.5 → бэкапы встали.
    backup: {
      autoIntervalSec: Math.floor(AUTO_BACKUP_INTERVAL_MS / 1000),
      lastAgeSec: Math.floor((Date.now() - lastAutoBackupAt) / 1000)
    },
    readOnly: READ_ONLY,
    shuttingDown
  })
})

// --- /version -----------------------------------------------------------
// Тонкий endpoint для ops: «какая версия сейчас крутится?». Не требует
// аутентификации (это публичный fingerprint билда). VCS_SHA — короткий
// git-hash, прокидывается CI/build-системой. Если нет — пусто.

app.get('/version', (_req, res) => {
  res.json({
    version: process.env.npm_package_version || '0.0.0',
    node: process.version,
    env: process.env.NODE_ENV || 'development',
    commit: process.env.VCS_SHA || '',
    startedAt: new Date(STARTED_AT).toISOString(),
    uptimeSec: Math.floor((Date.now() - STARTED_AT) / 1000)
  })
})

// --- /ready -------------------------------------------------------------
// Liveness vs readiness: /health всегда отвечает «жив» (включая
// shuttingDown), /ready — «готов принимать трафик». k8s/lb-probe именно
// сюда смотрит, чтобы вывести pod из ротации до shutdown'а.
// 200 — готов; 503 — нет (БД пуста / shutdown / read-only).

app.get('/ready', (_req, res) => {
  const state = readinessState()
  res.status(state.ok ? 200 : 503).json(state)
})

// --- /metrics (admin-only) ---------------------------------------------
// JSON-метрики: для интеграции с дашбордом. Считаем accept-roles из bearer-токена,
// чтобы не тянуть в handlers ради одного эндпоинта.

app.get('/metrics', (req, res) => {
  const auth = req.headers.authorization || ''
  const payload = auth.startsWith('Bearer ') ? verifyJwt(auth.slice(7)) : null
  if (payload?.role !== 'admin') {
    return res.status(403).json({ error: 'admin_only' })
  }
  const uptimeMs = Date.now() - metrics.startedAt
  const meanLatency = metrics.totalRequests > 0
    ? Math.round((metrics.totalLatencyMs / metrics.totalRequests) * 100) / 100
    : 0

  // ?format=prom — text/plain в Prometheus exposition format. Не пытаемся
  // быть полным prom-client (без histogram, без registry merge), но
  // покрываем основное: counters + gauges. node_exporter рядом всё равно
  // даёт CPU/IO/network.
  if (req.query.format === 'prom') {
    const lines = []
    const fmtLabels = (labels) =>
      labels ? `{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')}}` : ''
    const single = (name, help, type, value) => {
      lines.push(`# HELP ${name} ${help}`)
      lines.push(`# TYPE ${name} ${type}`)
      lines.push(`${name} ${value}`)
    }
    const grouped = (name, help, type, entries, labelKey) => {
      lines.push(`# HELP ${name} ${help}`)
      lines.push(`# TYPE ${name} ${type}`)
      for (const [k, v] of Object.entries(entries)) {
        lines.push(`${name}${fmtLabels({ [labelKey]: k })} ${v}`)
      }
    }
    single('apn_uptime_seconds', 'Server uptime in seconds', 'counter', Math.floor(uptimeMs / 1000))
    single('apn_inflight_current', 'Current inflight requests', 'gauge', inflight)
    single('apn_inflight_peak', 'Peak inflight requests since start', 'gauge', peakInflight)
    single('apn_inflight_users', 'Distinct authenticated users with inflight requests', 'gauge', inflightByUser.size)
    single('apn_inflight_ips', 'Distinct IPs with inflight requests', 'gauge', inflightByIp.size)
    single('apn_inflight_cap', 'Global inflight backpressure cap', 'gauge', MAX_INFLIGHT_GLOBAL)
    single('apn_backpressure_shed_total', 'Requests rejected by global backpressure (503)', 'counter', metrics.backpressureShed)
    single('apn_read_only', 'Whether READ_ONLY mode is on (1/0)', 'gauge', READ_ONLY ? 1 : 0)
    single('apn_mean_latency_ms', 'Mean response latency (ms) since start', 'gauge', meanLatency)
    single('apn_slow_requests_total', 'Requests slower than 500ms', 'counter', metrics.slowRequests)
    single('apn_error_responses_total', 'Responses with status >=500', 'counter', metrics.errorResponses)
    single('apn_request_timeouts_total', 'Requests aborted by per-request timeout cap', 'counter', requestTimeoutsTotal)
    const rrs = refreshRotationStats()
    single('apn_refresh_rotated_total', 'Successful refresh-token rotations', 'counter', rrs.rotated)
    single('apn_refresh_replay_total', 'Detected refresh-token replays (compromise indicator)', 'counter', rrs.replays)
    single('apn_refresh_history_size', 'Size of replay-detection history map', 'gauge', rrs.historySize)
    single('apn_backup_last_age_seconds', 'Seconds since last successful auto-backup (0 if disabled)', 'gauge', AUTO_BACKUP_INTERVAL_MS > 0 ? Math.floor((Date.now() - lastAutoBackupAt) / 1000) : 0)
    single('apn_backup_interval_seconds', 'Configured auto-backup interval (0 if disabled)', 'gauge', Math.floor(AUTO_BACKUP_INTERVAL_MS / 1000))
    grouped('apn_requests_total', 'HTTP requests by status class', 'counter', metrics.byStatusClass, 'status')
    grouped('apn_requests_by_method_total', 'HTTP requests by method', 'counter', metrics.byMethod, 'method')
    grouped('apn_requests_by_ua_class_total', 'HTTP requests by UA class (browser/bot/cli/unknown)', 'counter', metrics.byUaClass, 'ua_class')

    // Per-route метрики: top-50 по count (остальные глотает 'other' bucket).
    // Экспортируем как пять gauges + один counter — не настоящий histogram
    // (без cumulative buckets), но дёшево и читаемо в Prom-UI. Для полного
    // histogram'а нужны pre-defined le-bucket'ы, что усложнит code и hot path.
    const snap = routeMetricsSnapshot().slice(0, 50)
    if (snap.length > 0) {
      lines.push('# HELP apn_route_requests_total Per-route request count')
      lines.push('# TYPE apn_route_requests_total counter')
      for (const r of snap) lines.push(`apn_route_requests_total${fmtLabels({ route: r.route })} ${r.count}`)
      lines.push('# HELP apn_route_latency_ms Per-route latency (ms), p50/p95/p99/mean')
      lines.push('# TYPE apn_route_latency_ms gauge')
      for (const r of snap) {
        lines.push(`apn_route_latency_ms${fmtLabels({ route: r.route, quantile: '0.5' })} ${r.p50}`)
        lines.push(`apn_route_latency_ms${fmtLabels({ route: r.route, quantile: '0.95' })} ${r.p95}`)
        lines.push(`apn_route_latency_ms${fmtLabels({ route: r.route, quantile: '0.99' })} ${r.p99}`)
        lines.push(`apn_route_latency_ms${fmtLabels({ route: r.route, quantile: 'mean' })} ${r.meanMs}`)
      }
      lines.push('# HELP apn_route_slow_total Per-route slow requests (>500ms)')
      lines.push('# TYPE apn_route_slow_total counter')
      for (const r of snap) lines.push(`apn_route_slow_total${fmtLabels({ route: r.route })} ${r.slowCount}`)
    }
    res.type('text/plain; version=0.0.4; charset=utf-8').send(lines.join('\n') + '\n')
    return
  }

  res.json({
    uptimeSec: Math.floor(uptimeMs / 1000),
    totalRequests: metrics.totalRequests,
    rps: metrics.totalRequests / (uptimeMs / 1000),
    meanLatencyMs: meanLatency,
    slowRequests: metrics.slowRequests,
    errorResponses: metrics.errorResponses,
    requestTimeouts: requestTimeoutsTotal,
    refresh: refreshRotationStats(),
    byStatusClass: metrics.byStatusClass,
    byMethod: metrics.byMethod,
    byUaClass: metrics.byUaClass,
    inflight: { current: inflight, peak: peakInflight, uniqueUsers: inflightByUser.size, uniqueIps: inflightByIp.size, cap: MAX_INFLIGHT_GLOBAL, shed: metrics.backpressureShed },
    // Top-50 ручек по count: route, p50/p95/p99, mean, slowCount. Достаточно
    // для триажа «какая ручка тормозит» без отдельного APM. Сортировка
    // на сервере, чтобы клиент не возился.
    byRoute: routeMetricsSnapshot().slice(0, 50),
    readOnly: READ_ONLY
  })
})

// --- rate-limit /api ----------------------------------------------------

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Слишком много запросов, попробуйте через минуту.' }
})

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'login_rate_limited', message: 'Слишком много попыток входа. Попробуйте позже.' }
})

// Жёсткий лимит для admin-эндпоинтов (wal-checkpoint, backup, sessions).
// Они дорогие (VACUUM INTO блокирует страницы, checkpoint пишет на диск)
// и при автоматизации легко улететь в шторм. 30/мин — больше чем нужно
// человеку, но мешает циклу. По IP, не по юзеру: если кто-то украл админ-
// токен, лимит всё равно сработает.
const adminLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'admin_rate_limited', message: 'Слишком много admin-запросов. Притормозите.' }
})

// Per-IP лимит на mutating verbs (POST/PUT/PATCH/DELETE). apiLimiter общий
// в 300/мин на всё включая read — один IP мог сжечь все 300 на write'ах и
// положить пайплайн для остальных. 60/мин на write'ы — щедро для UI (десяток
// форм), жёстко для скрипта-фаззера. Bulk-upsert вне счёта: он сам себе
// ограничен (per-user inflight + body 10MB + chunk-cap 100).
const MUTATION_RATE_LIMIT = Number(process.env.MUTATION_RATE_LIMIT) || 60
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const mutationLimiter = rateLimit({
  windowMs: 60_000,
  limit: MUTATION_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'mutation_rate_limited', message: 'Слишком много изменяющих запросов с этого IP. Подождите минуту.' },
  // Считаем только write'ы. GET/HEAD/OPTIONS — мимо. Login/register имеют
  // свой loginLimiter (не считаем их дважды). Bulk-upsert карвим, его рулит
  // inflight-квота + body-limit. Path читаем из originalUrl — после mount'а
  // через app.use('/api', ...) req.path уже без префикса /api.
  skip: (req) => {
    if (!MUTATING_METHODS.has(req.method)) return true
    const url = req.originalUrl || ''
    if (url.startsWith('/api/auth/login')) return true
    if (url.startsWith('/api/auth/register')) return true
    if (url.startsWith('/api/inn-registry/bulk-upsert')) return true
    if (url.startsWith('/api/client-errors')) return true
    return false
  }
})

// Отдельный лимит на client-error reports: 60/мин с IP. Фронт сам клампится
// до 5/мин уникальных, но злоумышленник может бить вручную, надо страховать.
const clientErrLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'client_err_rate_limited' }
})

app.use('/api/auth/login', loginLimiter)
app.use('/api/auth/register', loginLimiter)
app.use('/api/admin', adminLimiter)
app.use('/api', mutationLimiter)
app.use('/api', apiLimiter)

// --- per-user concurrent quota + shutdown guard ------------------------
// Чек после rate-limit (не тратим квоту на отбитые запросы) и до dispatcher'а
// (не запускаем тяжёлую работу). Анон-запросы пропускаем.

app.use('/api', (req, res, next) => {
  if (shuttingDown) {
    return res.status(503).json({ error: 'shutting_down', message: 'Сервер завершает работу.' })
  }
  // Глобальный backpressure: inflight уже учитывает текущий запрос (bump'нули
  // в общем middleware выше), поэтому сравниваем строго >. Retry-After в
  // секундах — RFC 7231 §7.1.3. Клиент видит подсказку и ретраит через паузу,
  // вместо того чтобы долбить и копить очередь, которую мы всё равно дропнем
  // по REQUEST_TIMEOUT_MS.
  if (inflight > MAX_INFLIGHT_GLOBAL) {
    metrics.backpressureShed++
    res.setHeader('Retry-After', String(BACKPRESSURE_RETRY_AFTER_S))
    return res.status(503).json({
      error: 'overloaded',
      message: `Сервер перегружен (inflight=${inflight} > ${MAX_INFLIGHT_GLOBAL}). Повтор через ${BACKPRESSURE_RETRY_AFTER_S}s.`
    })
  }
  // READ_ONLY: мутации → 503. Исключения: login/refresh/logout (нужны для
  // авторизации админа в режиме обслуживания) и /admin/* (это и есть инструменты
  // обслуживания). change-password остаётся заблокированным.
  if (READ_ONLY && MUTATING_METHODS.has(req.method)) {
    const path = req.path
    const exempt = path === '/auth/login' || path === '/auth/refresh' ||
                   path === '/auth/logout' || path.startsWith('/admin/')
    if (!exempt) {
      return res.status(503).json({ error: 'read_only', message: 'Сервер в режиме read-only.' })
    }
  }
  // Per-IP concurrent guard работает до per-user: ловим slow-loris / login-flood
  // на анонимном этапе. Сам запрос УЖЕ в счётчике (bumpIp(+1) в общем middleware),
  // поэтому сравниваем с > limit.
  const ip = req._ip
  if (ip) {
    const ipCur = inflightByIp.get(ip) || 0
    if (ipCur > PER_IP_INFLIGHT_LIMIT) {
      return res.status(429).json({
        error: 'ip_quota_exceeded',
        message: `Слишком много одновременных запросов с этого IP (>${PER_IP_INFLIGHT_LIMIT}). Подождите.`
      })
    }
  }
  const user = req._user
  if (!user) return next()
  // Сам запрос УЖЕ в счётчике (bumpUser(+1) выше), поэтому сравниваем с >.
  const cur = inflightByUser.get(user) || 0
  if (cur > PER_USER_INFLIGHT_LIMIT) {
    return res.status(429).json({
      error: 'user_quota_exceeded',
      message: `Слишком много одновременных запросов (>${PER_USER_INFLIGHT_LIMIT}). Подождите.`
    })
  }
  next()
})

// --- admin maintenance (вне handlers.js) -------------------------------
// Эти эндпоинты живут на уровне сервера, не диспетчера: им нужен доступ к
// sqlite-инстансу и файловой системе. Авторизация — admin-роль из JWT.

function requireAdmin(req, res) {
  const auth = req.headers.authorization || ''
  const payload = auth.startsWith('Bearer ') ? verifyJwt(auth.slice(7)) : null
  if (payload?.role !== 'admin') {
    res.status(403).json({ error: 'admin_only' })
    return null
  }
  return payload
}

app.post('/api/admin/wal-checkpoint', (req, res) => {
  if (!requireAdmin(req, res)) return
  // Перед checkpoint'ом сбрасываем pending-saves, иначе можем пропустить
  // последние мутации.
  flushPending()
  const result = walCheckpoint()
  // Ручной checkpoint тоже сдвигает таймер — иначе maintenance через секунду
  // повторит «по возрасту», хотя только что чекпойнтили.
  lastCheckpointAt = Date.now()
  res.json({ ok: true, ...result })
})

app.post('/api/admin/backup', (req, res) => {
  if (!requireAdmin(req, res)) return
  try { mkdirSync(BACKUP_DIR, { recursive: true }) } catch { /* exists */ }
  flushPending()
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = resolve(BACKUP_DIR, `app-${ts}.db`)
  const info = backupTo(dest)
  if (info.error) return res.status(500).json({ ok: false, ...info })
  // Verify: открыть бэкап в read-only и убедиться что users > 0. Это ловит
  // случаи «бэкап успешно записан, но битый» — например ext4 partial write.
  // Стоит ~10ms, делаем всегда (доверять без проверки нечестно).
  const verify = verifyBackup(dest)
  // Сразу после успешного бэкапа подчищаем старые — чтобы место не копилось.
  const pruned = pruneOldBackups(BACKUP_DIR, BACKUP_KEEP_DAYS)
  const payload = { ok: verify.ok, ...info, verify, pruned }
  // Битый бэкап == провал операции, не «success с предупреждением». Возвращаем
  // 500 чтобы alerting/CI заметили, payload оставляем (info+verify.error) для триажа.
  res.status(verify.ok ? 200 : 500).json(payload)
})

// Ручной trigger всех maintenance-шагов. Полезно когда нужно «прибраться сейчас»
// (перед бэкапом, релизом, миграцией) без ожидания следующего MAINTENANCE_INTERVAL.
// Запускает тот же maintenanceTick(), что и фоновый таймер — никакого
// дублирования логики. Возвращает только подтверждение (детальные логи в stdout).
app.post('/api/admin/maintenance', (req, res) => {
  if (!requireAdmin(req, res)) return
  try {
    maintenanceTick()
    res.json({ ok: true, ranAt: new Date().toISOString() })
  } catch (e) {
    serverLog.error({ err: e }, 'admin/maintenance failed')
    res.status(500).json({ ok: false, error: IS_PROD ? 'internal' : e.message })
  }
})

// Per-table статистика для capacity-планирования: сколько rows + bytes
// в каждой таблице, плюс размеры файлов БД/wal. Дешёво (несколько COUNT'ов),
// можно дёргать по требованию.
app.get('/api/admin/db-stats', (req, res) => {
  if (!requireAdmin(req, res)) return
  const tables = getTableStats()
  const rawFiles = statDbFiles()
  // Для UI/JSON отдаём mtime в ISO — статичная сериализация Date нестабильна.
  const files = {}
  for (const [k, v] of Object.entries(rawFiles)) {
    files[k] = { sizeBytes: v.sizeBytes, mtime: v.mtime.toISOString() }
  }
  // Сумма по таблицам vs размер файла — расхождение = overhead страниц/индексов.
  let totalRows = 0
  let totalBytes = 0
  for (const t of Object.values(tables)) {
    if (t.rows > 0) totalRows += t.rows
    if (t.bytes > 0) totalBytes += t.bytes
  }
  res.json({
    tables,
    totals: { rows: totalRows, bytes: totalBytes },
    files,
    pendingWrites: hasPendingWrites()
  })
})

// --- ETag для read-only справочников -----------------------------------
// sha1 от JSON-ответа → 304 на If-None-Match. Экономит трафик; CPU не
// экономит (ответ всё равно собирается), для этого нужен серверный кеш.

const ETAG_PATHS = new Set(['/threats-catalog', '/security-tools-catalog'])

function isEtagRoute(url) {
  const i = url.indexOf('?')
  const path = i >= 0 ? url.slice(0, i) : url
  if (ETAG_PATHS.has(path)) return true
  if (path.startsWith('/dictionaries/')) return true
  return false
}

// --- client error collection -------------------------------------------
// Анонимный приём ошибок с фронта (Vue errorHandler, window error,
// unhandledrejection). Не пишет в БД — только pino warn-лог. Без auth,
// потому что часть ошибок (логин-форма падает, токен битый) случается
// до авторизации. Защита: dedicated rate-limit, 20kb body cap.
//
// Лимиты дублируем из src/lib/error-reporter.js (CLIENT_ERROR_LIMITS) —
// нельзя доверять клиентскому slice'у: ручной POST мимо фронта прошёл бы
// без обрезки. KEEP IN SYNC с src/lib/error-reporter.js.
const CLIENT_ERROR_LIMITS = {
  message: 500, stack: 4000, source: 300, url: 500, ua: 200, kind: 32, ts: 32
}
const CLIENT_ERROR_KINDS = new Set(['vue', 'window', 'promise', 'unknown'])

app.post('/api/client-errors', clientErrLimiter, (req, res) => {
  const body = req.body || {}
  const msg = String(body.message || '').slice(0, CLIENT_ERROR_LIMITS.message)
  if (!msg) return res.status(400).json({ error: 'empty_message' })
  const rawKind = String(body.kind || '').slice(0, CLIENT_ERROR_LIMITS.kind)
  const kind = CLIENT_ERROR_KINDS.has(rawKind) ? rawKind : 'unknown'
  clientErrLog.warn({
    msg,
    stack: String(body.stack || '').slice(0, CLIENT_ERROR_LIMITS.stack) || undefined,
    kind,
    source: body.source ? String(body.source).slice(0, CLIENT_ERROR_LIMITS.source) : undefined,
    clientUrl: String(body.url || '').slice(0, CLIENT_ERROR_LIMITS.url) || undefined,
    ua: String(body.userAgent || '').slice(0, CLIENT_ERROR_LIMITS.ua) || undefined,
    clientTs: String(body.ts || '').slice(0, CLIENT_ERROR_LIMITS.ts) || undefined,
    ip: req.ip
  }, 'client error')
  res.status(204).end()
})

// --- main API dispatcher -----------------------------------------------

app.all(/^\/api(\/.*)?$/, async (req, res) => {
  const method = req.method.toUpperCase()
  const url = req.originalUrl.replace(/^\/api/, '') || '/'
  const headers = {
    authorization: req.headers.authorization,
    'user-agent': req.headers['user-agent'],
    // `x-real-ip`: синтетический хедер от dispatcher'а. Берём req.ip (Express
    // учитывает TRUST_PROXY и X-Forwarded-For). Хендлеры не должны парсить
    // X-Forwarded-For сами — это работа сервера.
    'x-real-ip': req.ip
  }
  try {
    const result = await handleMockRequest({
      method,
      url,
      body: req.body,
      headers
    })
    // dirty: handler сообщает «я тронул persisted-state, даже если ответ 4xx»
    // (failed login → loginFailures, replay → usedRefreshTokens). Без этого
    // 401/429-ответы не триггерили save и lockout не переживал рестарт.
    if ((MUTATING_METHODS.has(method) && result.status < 400) || result.dirty) scheduleSave()

    if (method === 'GET' && result.status === 200 && isEtagRoute(url)) {
      const body = JSON.stringify(result.data)
      const etag = 'W/"' + createHash('sha1').update(body).digest('base64').slice(0, 22) + '"'
      res.setHeader('ETag', etag)
      res.setHeader('Cache-Control', 'private, max-age=60, must-revalidate')
      if (req.headers['if-none-match'] === etag) return res.status(304).end()
      res.status(200).type('application/json').send(body)
      return
    }

    res.status(result.status).json(result.data)
  } catch (e) {
    logger.error({ err: e, reqId: req.reqId, method, url }, 'api dispatch failed')
    // В prod НЕ возвращаем e.message клиенту — может утечь SQL-детали,
    // file paths, имена таблиц, accidental dumps. reqId — единственная
    // нить для корреляции с server-логом.
    res.status(500).json({
      error: 'internal',
      message: IS_PROD ? 'Внутренняя ошибка сервера.' : e?.message,
      reqId: req.reqId
    })
  }
})

// --- static + SPA fallback ---------------------------------------------

if (SERVE_STATIC) {
  if (!existsSync(DIST_DIR)) {
    serverLog.warn({ distDir: DIST_DIR }, 'SERVE_STATIC=true но dist не существует — сначала npm run build')
  } else {
    app.use(express.static(DIST_DIR, { maxAge: '1h', index: false }))
    app.get(/.*/, (req, res, next) => {
      if (req.path.startsWith('/api') || req.path === '/health') return next()
      res.sendFile(join(DIST_DIR, 'index.html'))
    })
    serverLog.info({ distDir: DIST_DIR }, 'serving static')
  }
}

// --- background maintenance --------------------------------------------
// Раз в MAINTENANCE_INTERVAL_MS:
//   1. если -wal > WAL_AUTO_CHECKPOINT_MB → flushPending + walCheckpoint
//   2. чистим старые бэкапы (старее BACKUP_KEEP_DAYS)
// Дёшево и идемпотентно. Логируем только если что-то реально сделали —
// чтобы не засорять stdout «no-op» строками каждые 5 минут.

let maintenanceTimer = null
// Время последнего успешного checkpoint'а: либо по размеру, либо по времени,
// либо ручное. Инициализируем STARTED_AT'ом — иначе первый tick сразу решит,
// что чекпойнт «древний» (хотя по факту prosseся 0мс назад).
let lastCheckpointAt = Date.now()
// Время последнего успешного авто-бэкапа. Инициализация STARTED_AT'ом важна
// для того же эффекта (иначе первый tick делает бэкап через 5мин после старта).
let lastAutoBackupAt = Date.now()

function maintenanceTick() {
  // 1) WAL auto-checkpoint: по размеру ИЛИ по возрасту (что наступит раньше).
  try {
    const walPath = getDbPath() + '-wal'
    let walBytes = 0
    try { walBytes = statSync(walPath).size } catch { /* no wal yet */ }
    const walMB = bytesToMB(walBytes)
    const sizeOver = walMB > WAL_AUTO_CHECKPOINT_MB
    const ageOver = (Date.now() - lastCheckpointAt) > WAL_MAX_AGE_MS && walBytes > 0
    if (sizeOver || ageOver) {
      flushPending()
      const result = walCheckpoint()
      lastCheckpointAt = Date.now()
      maintLog.info(
        {
          trigger: sizeOver ? 'size' : 'age',
          walMB,
          thresholdMB: WAL_AUTO_CHECKPOINT_MB,
          maxAgeMin: Math.round(WAL_MAX_AGE_MS / 60_000),
          result
        },
        'wal checkpoint'
      )
    }
  } catch (e) {
    maintLog.error({ err: e }, 'wal-checkpoint failed')
  }
  // 2) Auto-backup: VACUUM INTO раз в AUTO_BACKUP_INTERVAL_MS. flushPending
  // перед этим, чтобы pending-мутации тоже попали в снапшот; verify через
  // open-readonly + COUNT(users), битый бэкап логируется как error и НЕ
  // обновляет lastAutoBackupAt (на следующем tick'е попробуем снова).
  if (AUTO_BACKUP_INTERVAL_MS > 0 && (Date.now() - lastAutoBackupAt) >= AUTO_BACKUP_INTERVAL_MS) {
    try {
      mkdirSync(BACKUP_DIR, { recursive: true })
      flushPending()
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      const dest = resolve(BACKUP_DIR, `app-${ts}.db`)
      const info = backupTo(dest)
      if (info.error) {
        maintLog.error({ err: new Error(info.error) }, 'auto-backup failed')
      } else {
        const verify = verifyBackup(dest)
        if (verify.ok) {
          maintLog.info({ ts, sizeMB: bytesToMB(info.sizeBytes), users: verify.users }, 'auto-backup ok')
          lastAutoBackupAt = Date.now()
        } else {
          maintLog.error({ verifyError: verify.error || 'no users' }, 'auto-backup verify failed')
        }
      }
    } catch (e) {
      maintLog.error({ err: e }, 'auto-backup failed')
    }
  }
  // 3) Backup retention
  try {
    const r = pruneOldBackups(BACKUP_DIR, BACKUP_KEEP_DAYS)
    if (r.removed.length > 0) {
      maintLog.info({ removed: r.removed.length, freedMB: bytesToMB(r.freedBytes) }, 'pruned backups')
    }
  } catch (e) {
    maintLog.error({ err: e }, 'backup-prune failed')
  }
  // 4) Expired refresh-sessions: чистим, чтобы массив не рос вечно.
  try {
    const n = cleanupExpiredSessions()
    if (n > 0) {
      maintLog.info({ expired: n }, 'expired refresh-sessions')
      // Сразу планируем save: чтобы persisted db не отставал.
      scheduleSave()
    }
  } catch (e) {
    maintLog.error({ err: e }, 'session-cleanup failed')
  }
  // 5) Audit-ротация по возрасту. Хард-кап тикает at-insert (см. handlers.js),
  // здесь подрезаем «старое». Если AUDIT_KEEP_DAYS=0 — выключено.
  if (AUDIT_KEEP_DAYS > 0) {
    try {
      const n = cleanupAudit(AUDIT_KEEP_DAYS * 86400_000)
      if (n > 0) {
        maintLog.info({ pruned: n, olderThanDays: AUDIT_KEEP_DAYS }, 'pruned audit records')
        scheduleSave()
      }
    } catch (e) {
      maintLog.error({ err: e }, 'audit-cleanup failed')
    }
  }
  // 6) Lockout-map cleanup: евиктим записи с истёкшим окном/локаутом.
  // Без этого Map рос монотонно при атаке с rotation usernames.
  // Чисто in-memory структура — scheduleSave() не нужен.
  try {
    const n = cleanupLoginFailures()
    if (n > 0) {
      maintLog.info({ evicted: n }, 'evicted stale lockout entries')
    }
  } catch (e) {
    maintLog.error({ err: e }, 'lockout-cleanup failed')
  }
}

// --- graceful shutdown -------------------------------------------------
// shuttingDown=true → новые /api отбиваются 503. Ждём дренажа inflight до 0
// (или SHUTDOWN_DRAIN_MS), потом flushSync. Важно для bulk-импорта на 100.

let shuttingDown = false
let httpServer = null

async function waitForDrain(timeoutMs) {
  const start = Date.now()
  while (inflight > 0 && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 50))
  }
  return inflight === 0
}

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  serverLog.info({ signal, inflight }, 'shutdown signal received, draining inflight requests')
  // Останавливаем фоновую maintenance (чтобы не дёргать БД во время flushSync).
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer)
    maintenanceTimer = null
  }
  // close() прекращает приём новых соединений, keep-alive дослуживаются.
  if (httpServer) httpServer.close()
  const drained = await waitForDrain(SHUTDOWN_DRAIN_MS)
  if (drained) {
    serverLog.info('drained, flushing db')
  } else {
    serverLog.warn({ drainTimeoutMs: SHUTDOWN_DRAIN_MS, inflight }, 'drain timeout, forcing flush')
  }
  flushSync()
  process.exit(0)
}

process.on('SIGINT', () => { shutdown('SIGINT') })
process.on('SIGTERM', () => { shutdown('SIGTERM') })
process.on('uncaughtException', (e) => {
  serverLog.fatal({ err: e }, 'uncaught exception')
  flushSync()
  process.exit(1)
})

httpServer = app.listen(PORT, HOST, () => {
  serverLog.info({ host: HOST, port: PORT, static: SERVE_STATIC }, 'http server listening')
  // Запускаем фоновую maintenance только после успешного listen, чтобы при
  // ошибке bind'а не лезть в БД. unref() — таймер не блокирует event-loop
  // exit'а, если кто-то прибил httpServer мимо shutdown'а.
  maintenanceTimer = setInterval(maintenanceTick, MAINTENANCE_INTERVAL_MS)
  maintenanceTimer.unref()
  maintLog.info(
    {
      intervalSec: Math.round(MAINTENANCE_INTERVAL_MS / 1000),
      walThresholdMB: WAL_AUTO_CHECKPOINT_MB,
      backupKeepDays: BACKUP_KEEP_DAYS,
      auditKeepDays: AUDIT_KEEP_DAYS
    },
    'maintenance enabled'
  )
})
