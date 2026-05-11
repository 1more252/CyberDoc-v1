// ===========================================================================
// Express-бэк для apn-vue.
//
// Слои:
//   • helmet           — security-заголовки
//   • CORS             — для дева (фронт на 5173, бэк на 3001)
//   • rate-limit       — защита /api/* от перебора
//   • express.json     — парсинг тел запросов
//   • request logging  — медленные ответы (>100ms)
//   • /health          — пинг + uptime + версия
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
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleMockRequest, setMockDelayMs, setTokenSigner, setPasswordHasher } from '../src/mock/handlers.js'
import { makeAccessToken, makeRefreshToken } from './jwt.js'
import { hash as pwHash, verify as pwVerify, isHashed as pwIsHashed } from './password.js'
import { loadFromDisk, scheduleSave, flushSync, importLegacyJsonIfEmpty } from './storage.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = resolve(HERE, '..', 'dist')

const PORT = Number(process.env.PORT) || 3001
const HOST = process.env.HOST || '127.0.0.1'
const SERVE_STATIC = process.env.SERVE_STATIC === 'true'
const TRUST_PROXY = process.env.TRUST_PROXY === 'true'

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
app.use(cors({ exposedHeaders: ['X-Request-Id'] }))
// gzip всех ответов >1KB. JSON-ответы списков сжимаются в 4–10×.
app.use(compression({ threshold: 1024 }))
app.use(express.json({ limit: '10mb' }))

// --- request-id + structured logging -----------------------------------
// Каждый запрос получает UUID — он попадает в логи и в заголовок X-Request-Id
// ответа. Клиент может прицепить тот же UUID к ошибке и найти строку в логе.

app.use((req, res, next) => {
  const reqId = req.headers['x-request-id'] || randomUUID()
  req.reqId = reqId
  res.setHeader('X-Request-Id', reqId)
  const t0 = Date.now()
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

const STARTED_AT = Date.now()
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
    node: process.version,
    version: process.env.npm_package_version || '0.0.0',
    env: process.env.NODE_ENV || 'development'
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

let shuttingDown = false
function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n[server] ${signal} received, flushing db…`)
  flushSync()
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('uncaughtException', (e) => {
  console.error('[server] uncaught:', e)
  flushSync()
  process.exit(1)
})

app.listen(PORT, HOST, () => {
  console.log(`[server] http://${HOST}:${PORT} (static=${SERVE_STATIC ? 'on' : 'off'})`)
})
