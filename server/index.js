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
import { handleMockRequest, setMockDelayMs, setTokenSigner, setPasswordHasher, cleanupExpiredSessions, cleanupAudit, cleanupLoginFailures, loginFailuresSize } from '../src/mock/handlers.js'
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
  verifyBackup
} from './storage.js'
import { parseJwt } from '../src/lib/jwt.js'

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

// Сколько ждать дренажа inflight перед shutdown'ом.
const SHUTDOWN_DRAIN_MS = Number(process.env.SHUTDOWN_DRAIN_MS) || 5000

// CORS-allowlist. По умолчанию '*' (дев); в проде задаём список доменов
// через запятую: ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
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

// Сколько дней хранить бэкапы в data/backups/. Старее — чистятся после
// каждого создания бэкапа + раз в интервал maintenance.
const BACKUP_KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS) || 30

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

// --- bootstrap -----------------------------------------------------------

setMockDelayMs(0)
setTokenSigner({ makeAccessToken, makeRefreshToken })
setPasswordHasher({ hash: pwHash, verify: pwVerify, isHashed: pwIsHashed })

importLegacyJsonIfEmpty()
const loaded = await loadFromDisk()
console.log(loaded ? '[server] loaded data from app.db' : '[server] cold start (empty db)')

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
console.log(`[server] CORS: ${ALLOWED_ORIGINS.includes('*') ? 'open (*)' : 'allowlist=' + ALLOWED_ORIGINS.join(',')}`)
if (READ_ONLY) console.warn('[server] READ_ONLY mode: mutations will return 503')
// gzip всех ответов >1KB. JSON-ответы списков сжимаются в 4–10×.
app.use(compression({ threshold: 1024 }))
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

// --- метрики ------------------------------------------------------------
// Лёгкие in-memory счётчики; не Prometheus-grade, но даёт картину тренда
// без внешних зависимостей. Сбрасываются при рестарте — для большего нужен
// внешний exporter.
const metrics = {
  startedAt: Date.now(),
  totalRequests: 0,
  byStatusClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
  byMethod: {},
  slowRequests: 0,      // >500ms
  errorResponses: 0,    // 5xx
  totalLatencyMs: 0     // сумма для подсчёта среднего
}

function bumpUser(username, delta) {
  if (!username) return
  const cur = inflightByUser.get(username) || 0
  const next = cur + delta
  if (next <= 0) inflightByUser.delete(username)
  else inflightByUser.set(username, next)
}

// Достаём username из Bearer-токена без валидации подписи — это для квоты,
// авторизацию делает handlers.js. Битый/просроченный токен → не учитываем.
function callerName(req) {
  const auth = req.headers.authorization || ''
  if (!auth.startsWith('Bearer ')) return null
  const payload = parseJwt(auth.slice(7))
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

  let released = false
  const release = () => {
    if (released) return
    released = true
    inflight--
    bumpUser(user, -1)
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

    // Логируем все 4xx/5xx + медленные (>100ms). 2xx быстрые — молчим.
    if (ms > 100 || res.statusCode >= 400) {
      const line = {
        t: new Date().toISOString(),
        id: reqId,
        m: req.method,
        u: req.originalUrl,
        s: res.statusCode,
        ms,
        ip: req.ip
      }
      const stream = res.statusCode >= 500 ? console.error : console.log
      stream(JSON.stringify(line))
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

app.get('/health', (_req, res) => {
  const mem = process.memoryUsage()
  // app.db + -wal + -shm: в WAL-режиме реальные данные лежат в -wal до
  // checkpoint'а, без суммы размер кажется аномально малым. -wal выносим
  // отдельно (раздутый -wal — частый источник «откуда место кончилось»).
  const files = statDbFiles()
  const dbSize = (files.db?.sizeBytes ?? 0) + (files['-wal']?.sizeBytes ?? 0) + (files['-shm']?.sizeBytes ?? 0)
  const walSize = files['-wal']?.sizeBytes ?? 0
  const walSizeMB = Math.round((walSize / 1024 / 1024) * 100) / 100

  res.json({
    ok: true,
    uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
    node: process.version,
    version: process.env.npm_package_version || '0.0.0',
    env: process.env.NODE_ENV || 'development',
    db: {
      users: countUsers(),
      pendingWrites: hasPendingWrites(),
      sizeMB: Math.round((dbSize / 1024 / 1024) * 100) / 100,
      walSizeMB,
      walAlert: walSizeMB > WAL_ALERT_MB
    },
    mem: {
      rssMB: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      heapTotalMB: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100
    },
    inflight: {
      total: inflight,
      peak: peakInflight,
      uniqueUsers: inflightByUser.size
    },
    // Размер lockout-map: важный signal под атакой. Норма <100, тысячи —
    // повод смотреть rate-limit логи и blocking-rules перед сервером.
    lockoutEntries: loginFailuresSize(),
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
  const payload = auth.startsWith('Bearer ') ? parseJwt(auth.slice(7)) : null
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
    single('apn_read_only', 'Whether READ_ONLY mode is on (1/0)', 'gauge', READ_ONLY ? 1 : 0)
    single('apn_mean_latency_ms', 'Mean response latency (ms) since start', 'gauge', meanLatency)
    single('apn_slow_requests_total', 'Requests slower than 500ms', 'counter', metrics.slowRequests)
    single('apn_error_responses_total', 'Responses with status >=500', 'counter', metrics.errorResponses)
    grouped('apn_requests_total', 'HTTP requests by status class', 'counter', metrics.byStatusClass, 'status')
    grouped('apn_requests_by_method_total', 'HTTP requests by method', 'counter', metrics.byMethod, 'method')
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
    byStatusClass: metrics.byStatusClass,
    byMethod: metrics.byMethod,
    inflight: { current: inflight, peak: peakInflight },
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

app.use('/api/auth/login', loginLimiter)
app.use('/api/auth/register', loginLimiter)
app.use('/api/admin', adminLimiter)
app.use('/api', apiLimiter)

// --- per-user concurrent quota + shutdown guard ------------------------
// Чек после rate-limit (не тратим квоту на отбитые запросы) и до dispatcher'а
// (не запускаем тяжёлую работу). Анон-запросы пропускаем.

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

app.use('/api', (req, res, next) => {
  if (shuttingDown) {
    return res.status(503).json({ error: 'shutting_down', message: 'Сервер завершает работу.' })
  }
  // READ_ONLY: мутации → 503. Исключения: login/refresh/logout (нужны для
  // авторизации админа в режиме обслуживания) и /admin/* (это и есть инструменты
  // обслуживания). change-password остаётся заблокированным.
  if (READ_ONLY && MUTATING.has(req.method)) {
    const path = req.path
    const exempt = path === '/auth/login' || path === '/auth/refresh' ||
                   path === '/auth/logout' || path.startsWith('/admin/')
    if (!exempt) {
      return res.status(503).json({ error: 'read_only', message: 'Сервер в режиме read-only.' })
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
  const payload = auth.startsWith('Bearer ') ? parseJwt(auth.slice(7)) : null
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
    if (MUTATING.has(method) && result.status < 400) scheduleSave()

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
    console.error(JSON.stringify({
      t: new Date().toISOString(),
      id: req.reqId,
      level: 'error',
      m: method,
      u: url,
      err: e?.message,
      stack: e?.stack
    }))
    res.status(500).json({ error: 'internal', message: e?.message, reqId: req.reqId })
  }
})

// --- static + SPA fallback ---------------------------------------------

if (SERVE_STATIC) {
  if (!existsSync(DIST_DIR)) {
    console.warn(`[server] SERVE_STATIC=true но ${DIST_DIR} не существует — сначала npm run build`)
  } else {
    app.use(express.static(DIST_DIR, { maxAge: '1h', index: false }))
    app.get(/.*/, (req, res, next) => {
      if (req.path.startsWith('/api') || req.path === '/health') return next()
      res.sendFile(join(DIST_DIR, 'index.html'))
    })
    console.log(`[server] serving static from ${DIST_DIR}`)
  }
}

// --- background maintenance --------------------------------------------
// Раз в MAINTENANCE_INTERVAL_MS:
//   1. если -wal > WAL_AUTO_CHECKPOINT_MB → flushPending + walCheckpoint
//   2. чистим старые бэкапы (старее BACKUP_KEEP_DAYS)
// Дёшево и идемпотентно. Логируем только если что-то реально сделали —
// чтобы не засорять stdout «no-op» строками каждые 5 минут.

let maintenanceTimer = null

function maintenanceTick() {
  // 1) WAL auto-checkpoint
  try {
    const walPath = getDbPath() + '-wal'
    let walMB = 0
    try { walMB = statSync(walPath).size / 1024 / 1024 } catch { /* no wal yet */ }
    if (walMB > WAL_AUTO_CHECKPOINT_MB) {
      flushPending()
      const result = walCheckpoint()
      console.log(`[maintenance] wal ${walMB.toFixed(1)}MB > ${WAL_AUTO_CHECKPOINT_MB}MB → checkpoint:`, result)
    }
  } catch (e) {
    console.error('[maintenance] wal-checkpoint failed:', e.message)
  }
  // 2) Backup retention
  try {
    const r = pruneOldBackups(BACKUP_DIR, BACKUP_KEEP_DAYS)
    if (r.removed.length > 0) {
      const mb = (r.freedBytes / 1024 / 1024).toFixed(1)
      console.log(`[maintenance] pruned ${r.removed.length} backup(s), freed ${mb}MB`)
    }
  } catch (e) {
    console.error('[maintenance] backup-prune failed:', e.message)
  }
  // 3) Expired refresh-sessions: чистим, чтобы массив не рос вечно.
  try {
    const n = cleanupExpiredSessions()
    if (n > 0) {
      console.log(`[maintenance] expired ${n} refresh-session(s)`)
      // Сразу планируем save: чтобы persisted db не отставал.
      scheduleSave()
    }
  } catch (e) {
    console.error('[maintenance] session-cleanup failed:', e.message)
  }
  // 4) Audit-ротация по возрасту. Хард-кап тикает at-insert (см. handlers.js),
  // здесь подрезаем «старое». Если AUDIT_KEEP_DAYS=0 — выключено.
  if (AUDIT_KEEP_DAYS > 0) {
    try {
      const n = cleanupAudit(AUDIT_KEEP_DAYS * 86400_000)
      if (n > 0) {
        console.log(`[maintenance] pruned ${n} audit record(s) older than ${AUDIT_KEEP_DAYS}d`)
        scheduleSave()
      }
    } catch (e) {
      console.error('[maintenance] audit-cleanup failed:', e.message)
    }
  }
  // 5) Lockout-map cleanup: евиктим записи с истёкшим окном/локаутом.
  // Без этого Map рос монотонно при атаке с rotation usernames.
  // Чисто in-memory структура — scheduleSave() не нужен.
  try {
    const n = cleanupLoginFailures()
    if (n > 0) {
      console.log(`[maintenance] evicted ${n} stale lockout entr${n === 1 ? 'y' : 'ies'}`)
    }
  } catch (e) {
    console.error('[maintenance] lockout-cleanup failed:', e.message)
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
  console.log(`\n[server] ${signal} received, draining ${inflight} inflight req…`)
  // Останавливаем фоновую maintenance (чтобы не дёргать БД во время flushSync).
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer)
    maintenanceTimer = null
  }
  // close() прекращает приём новых соединений, keep-alive дослуживаются.
  if (httpServer) httpServer.close()
  const drained = await waitForDrain(SHUTDOWN_DRAIN_MS)
  if (drained) {
    console.log('[server] drained, flushing db…')
  } else {
    console.warn(`[server] drain timeout (${SHUTDOWN_DRAIN_MS}ms), ${inflight} req still inflight, forcing flush`)
  }
  flushSync()
  process.exit(0)
}

process.on('SIGINT', () => { shutdown('SIGINT') })
process.on('SIGTERM', () => { shutdown('SIGTERM') })
process.on('uncaughtException', (e) => {
  console.error('[server] uncaught:', e)
  flushSync()
  process.exit(1)
})

httpServer = app.listen(PORT, HOST, () => {
  console.log(`[server] http://${HOST}:${PORT} (static=${SERVE_STATIC ? 'on' : 'off'})`)
  // Запускаем фоновую maintenance только после успешного listen, чтобы при
  // ошибке bind'а не лезть в БД. unref() — таймер не блокирует event-loop
  // exit'а, если кто-то прибил httpServer мимо shutdown'а.
  maintenanceTimer = setInterval(maintenanceTick, MAINTENANCE_INTERVAL_MS)
  maintenanceTimer.unref()
  console.log(`[maintenance] enabled (interval=${Math.round(MAINTENANCE_INTERVAL_MS / 1000)}s, walThreshold=${WAL_AUTO_CHECKPOINT_MB}MB, backupKeep=${BACKUP_KEEP_DAYS}d, auditKeep=${AUDIT_KEEP_DAYS}d)`)
})
