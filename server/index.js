// ===========================================================================
// Express-бэк для apn-vue.
//
// Слои:
//   • helmet           — security-заголовки
//   • CORS             — для дева (фронт на 5173, бэк на 3001)
//   • rate-limit       — защита /api/* от перебора
//   • express.json     — парсинг тел запросов
//   • request logging  — медленные ответы (>100ms) + inflight-счётчик
//   • per-user quota   — не более N одновременных запросов на одного юзера
//   • ETag             — для read-only справочников (304 Not Modified)
//   • /health          — расширенный пинг: БД, RAM, inflight, db-size
//   • /api/*           — диспетчер на handleMockRequest
//   • static + SPA     — если SERVE_STATIC=true, отдаём dist/
//
// Запуск:
//   npm run server           — только бэк, dev (порт 3001)
//   SERVE_STATIC=true npm run server  — отдаёт ещё и dist/ (prod)
//   JWT_SECRET=... npm run server     — реальный секрет для прода
// ===========================================================================

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import { randomUUID, createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleMockRequest, setMockDelayMs, setTokenSigner, setPasswordHasher } from '../src/mock/handlers.js'
import { makeAccessToken, makeRefreshToken } from './jwt.js'
import { hash as pwHash, verify as pwVerify, isHashed as pwIsHashed } from './password.js'
import {
  loadFromDisk,
  scheduleSave,
  flushSync,
  importLegacyJsonIfEmpty,
  hasPendingWrites,
  getDbPath,
  countUsers
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
app.use(cors({ exposedHeaders: ['X-Request-Id', 'ETag'] }))
// gzip всех ответов >1KB. JSON-ответы списков сжимаются в 4–10×.
app.use(compression({ threshold: 1024 }))
app.use(express.json({ limit: '10mb' }))

// --- inflight tracking + request-id + structured logging ---------------
// Каждый запрос получает UUID (в X-Request-Id и логах). Inflight считаем
// глобально и пер-юзер; декремент по 'close' а не 'finish' — иначе при
// обрыве соединения счётчик утечёт.

let inflight = 0
const inflightByUser = new Map()

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
      uniqueUsers: inflightByUser.size
    },
    shuttingDown
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

app.use('/api', (req, res, next) => {
  if (shuttingDown) {
    return res.status(503).json({ error: 'shutting_down', message: 'Сервер завершает работу.' })
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

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

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
