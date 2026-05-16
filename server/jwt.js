// ===========================================================================
// Реальная подпись JWT через HMAC SHA-256 (HS256). Заменяет фейковую
// `cyberdoc-mock`-подпись из `src/mock/jwt-sign.js`. Секрет читается из
// env (JWT_SECRET), при отсутствии генерится случайный — это удобно для дева,
// но НЕЛЬЗЯ для прода: при рестарте все токены инвалидируются.
//
// Парсинг на фронте (src/lib/jwt.js) не меняется — там и так не проверяют
// подпись (это работа сервера).
// ===========================================================================

import { createHmac, randomBytes } from 'node:crypto'
import { jwtLog } from './logger.js'

const SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === 'production'
    ? (() => {
        throw new Error('JWT_SECRET is required in production')
      })()
    : randomBytes(32).toString('hex'))

if (!process.env.JWT_SECRET) {
  jwtLog.warn('JWT_SECRET not set — using random secret (dev only)')
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function b64urlJson(obj) {
  return b64url(JSON.stringify(obj))
}

function signSegment(header, payload) {
  const data = `${header}.${payload}`
  return b64url(createHmac('sha256', SECRET).update(data).digest())
}

export function signJwt(payload) {
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' })
  const body = b64urlJson(payload)
  const sig = signSegment(header, body)
  return `${header}.${body}.${sig}`
}

// Верификация подписи + exp. Возвращает payload или null. Никаких throw —
// caller проверяет null и решает сам (401 / игнор). Используется timing-safe
// сравнение: обычный === позволяет атаковать подпись побайтово по времени
// ответа (HMAC утечка). Не выполняем JSON.parse до проверки подписи —
// это бесплатная DoS-поверхность (стрёмный payload может бросить).
import { timingSafeEqual } from 'node:crypto'

export function verifyJwt(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  const expectedSig = signSegment(header, body)
  // Длины различаются → подпись точно левая, сразу мимо (без timingSafe-сравнения,
  // которое требует Buffer'ов одной длины).
  if (sig.length !== expectedSig.length) return null
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null
  } catch {
    return null
  }
  // Подпись верна — payload теперь trusted, можно парсить.
  let payload
  try {
    const json = Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    payload = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof payload !== 'object' || !payload) return null
  // exp в секундах (см. RFC 7519). 0 / отсутствие → не принимаем — это закрывает
  // токены без срока (если кто-то закодит signJwt без exp).
  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null
  return payload
}

// ---------- compatibility shim ------------------------------------------
//
// `src/mock/handlers.js` импортирует `makeAccessToken`, `makeRefreshToken`
// из `./jwt-sign.js`. Чтобы реальный сервер не зависел от мок-модуля,
// мы здесь экспортируем те же функции — handlers подменим через
// module-resolution-хак в `server/index.js`.

export function makeAccessToken({ username, role, verified, blocked, ttlSeconds = 3600 }) {
  const now = Math.floor(Date.now() / 1000)
  return signJwt({
    sub: username,
    role,
    verified,
    blocked,
    iat: now,
    exp: now + ttlSeconds
  })
}

export function makeRefreshToken(username) {
  const random = randomBytes(24).toString('base64url')
  return b64url(`${username}.${Date.now()}.${random}`)
}
