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
import { handleMockRequest, setMockDelayMs, setTokenSigner, setPasswordHasher } from '../src/mock/handlers.js'
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
  backupTo
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
app.get('/health', (_req, res) => {
  const mem = process.memoryUsage()
  // Суммируем app.db + -wal + -shm: в WAL-режиме реальные данные лежат
  // в -wal до checkpoint'а, без суммы размер кажется аномально малым.
  let dbSize = 0
  const dbPath = getDbPath()
  for (const suffix of ['', '-wal', '-shm']) {
    try { dbSize += statSync(dbPath + suffix).size } catch { /* нет файла */ }
  }

  res.json({
    ok: true,
    uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
    node: process.version,
    version: process.env.npm_package_version || '0.0.0',
    env: process.env.NODE_ENV || 'development',
    db: {
      users: countUsers(),
      pendingWrites: hasPendingWrites(),
      sizeMB: Math.round((dbSize / 1024 / 1024) * 100) / 100
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
    readOnly: READ_ONLY,
    shuttingDown
  })
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

app.use('/api/auth/login', loginLimiter)
app.use('/api/auth/register', loginLimiter)
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
  res.json({ ok: true, ...info })
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
  const headers = { authorization: req.headers.authorization }
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
})
