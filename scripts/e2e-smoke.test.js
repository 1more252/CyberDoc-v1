// ===========================================================================
// E2E smoke-тесты: spawn реального server/index.js на эфемерном порту с
// изолированным DATA_DIR (mkdtemp), проверяем что happy-path работает.
//
// Цель — ловить регрессии, которые unit-тесты против mock-handlers пропускают:
//   • Helmet security headers (CSP/HSTS/Permissions-Policy — Phase 37)
//   • Body-size limits 413 (Phase 32)
//   • JWT path до handler'а
//   • Admin guards (verifyJwt + role check)
//   • Bootstrap не падает на cold start с пустой БД
//
// НЕ покрываем (это для будущих Phase'ов):
//   • rate-limit (требует 300+ запросов, медленно)
//   • backup/restore (требует диск-IO, отдельный сценарий)
//   • WAL checkpoint (требует мутаций под нагрузкой)
//
// Изоляция:
//   • DATA_DIR=<tmpdir>/apn-e2e-XXX — каждый запуск получает свежую БД
//   • PORT=<эфемерный> — выбираем через net.createServer(0)
//   • JWT_SECRET=test-secret — фиксированный для воспроизводимости
// ===========================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_ENTRY = resolve(HERE, '..', 'server', 'index.js')

// Получаем свободный порт: создаём socket на 0, читаем выданный порт, закрываем.
// Race-condition теоретически есть (между close и наш spawn), но в локальной/CI
// среде вероятность коллизии околонулевая.
function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

// Ждём пока сервер ответит 200 на /health. Polling каждые 200ms, max 15s —
// cold start с integrity check может занять 2-3s.
async function waitForReady(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`)
      if (r.ok) return
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`server did not become ready in ${timeoutMs}ms`)
}

let serverProc
let dataDir
let port
let baseUrl
let adminAccess

const fetchJson = (path, init = {}) =>
  fetch(`${baseUrl}${path}`, init).then(async (r) => ({
    status: r.status,
    headers: r.headers,
    body: r.headers.get('content-type')?.includes('application/json') ? await r.json() : await r.text()
  }))

beforeAll(async () => {
  port = await pickFreePort()
  baseUrl = `http://127.0.0.1:${port}`
  dataDir = await mkdtemp(join(tmpdir(), 'apn-e2e-'))

  serverProc = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      JWT_SECRET: 'test-secret-do-not-use-in-prod',
      NODE_ENV: 'test',
      // Без логов в stdout — pretty-transport дорогой при spawn'е, а в тесте
      // не нужен. На stderr оставляем — увидим crash.
      LOG_LEVEL: 'silent'
    },
    stdio: ['ignore', 'ignore', 'inherit']
  })

  await waitForReady(port)
}, 30_000)

afterAll(async () => {
  if (serverProc && !serverProc.killed) {
    serverProc.kill('SIGTERM')
    // 500ms на graceful shutdown — без inflight-запросов drain мгновенный.
    await new Promise((r) => {
      const t = setTimeout(() => { serverProc.kill('SIGKILL'); r() }, 500)
      serverProc.once('exit', () => { clearTimeout(t); r() })
    })
  }
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true }).catch(() => {})
  }
})

describe('e2e: health + security headers', () => {
  // Один /health-ответ на всю секцию — заголовки и body не меняются между
  // запросами, нет смысла делать 4 round-trip'а.
  let health
  beforeAll(async () => { health = await fetchJson('/health') })

  it('GET /health → 200 ok', () => {
    expect(health.status).toBe(200)
    expect(health.body.uptime).toBeTypeOf('number')
    expect(health.body.db).toBeTypeOf('object')
  })

  it('HSTS заголовок выставлен (1 год)', () => {
    expect(health.headers.get('strict-transport-security')).toMatch(/max-age=31536000/)
  })

  it('Permissions-Policy отключает sensitive features', () => {
    const pp = health.headers.get('permissions-policy')
    expect(pp).toContain('camera=()')
    expect(pp).toContain('microphone=()')
    expect(pp).toContain('geolocation=()')
  })

  it('X-Powered-By скрыт helmet-ом', () => {
    expect(health.headers.get('x-powered-by')).toBeNull()
  })
})

describe('e2e: auth flow', () => {
  it('POST /api/auth/login с неверным паролем → 401', async () => {
    const r = await fetchJson('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong-password' })
    })
    expect(r.status).toBe(401)
    expect(r.body.error).toBeTypeOf('string')
  })

  it('POST /api/auth/login admin/admin123 → 200 + token', async () => {
    const r = await fetchJson('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })
    expect(r.status).toBe(200)
    // Response shape: { token, refreshToken } — см. loginHandler в handlers.js.
    expect(r.body.token).toBeTypeOf('string')
    expect(r.body.refreshToken).toBeTypeOf('string')
    adminAccess = r.body.token
  })

  it('POST /api/auth/login с body > 4KB → 413', async () => {
    // Body-size guard для /auth/login = 4KB (Phase 32). Срабатывает по
    // Content-Length до парсинга json — поэтому ответ возвращается мгновенно.
    const huge = 'A'.repeat(5 * 1024)
    const r = await fetchJson('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: huge })
    })
    expect(r.status).toBe(413)
    expect(r.body.error).toBe('payload_too_large')
  })
})

describe('e2e: admin guards', () => {
  it('GET /api/admin/audit-retention без токена → 403', async () => {
    // requireAdmin возвращает 403 для всех failure-кейсов (no token, bad token,
    // non-admin role) — единый сигнал «не admin», без раскрытия деталей.
    const r = await fetchJson('/api/admin/audit-retention')
    expect(r.status).toBe(403)
    expect(r.body.error).toBe('admin_only')
  })

  it('GET /api/admin/audit-retention с admin-токеном → 200', async () => {
    // adminAccess выставлен в предыдущем describe (vitest гонит describes
    // последовательно). Если он пуст — login-тест упал, и здесь правильное
    // поведение — тоже упасть с явной причиной, а не маскировать через re-login.
    const r = await fetchJson('/api/admin/audit-retention', {
      headers: { authorization: `Bearer ${adminAccess}` }
    })
    expect(r.status).toBe(200)
    expect(r.body.hardCap).toBeTypeOf('number')
    expect(r.body.keepDays).toBeTypeOf('number')
  })
})
