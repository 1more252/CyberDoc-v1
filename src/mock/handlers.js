import { db, nextDbId } from './db.js'
import * as defaultSigner from './jwt-sign.js'
import * as defaultPassword from './password.js'
import { fnsLookup } from './fns.js'
import { parseJwt } from '../lib/jwt.js'
import { isInnValid } from '../lib/inn-validate.js'

const FNS_CHUNK_LIMIT = 50
const INN_BULK_LIMIT = 100

let MOCK_DELAY_MS = 80
export function setMockDelayMs(ms) {
  MOCK_DELAY_MS = Math.max(0, Number(ms) || 0)
}

// === TOKEN SIGNER DI ===
// Браузерный мок использует фейковую подпись (`./jwt-sign.js`). Реальный
// сервер инжектит HMAC-подписант через setTokenSigner().
let makeAccessToken = defaultSigner.makeAccessToken
let makeRefreshToken = defaultSigner.makeRefreshToken

export function setTokenSigner({ makeAccessToken: ma, makeRefreshToken: mr }) {
  if (ma) makeAccessToken = ma
  if (mr) makeRefreshToken = mr
}

// === PASSWORD HASHER DI ==================================================
// В браузере используется plain compare (./password.js). Сервер инжектит
// scrypt-реализацию через setPasswordHasher().
let pwHash = defaultPassword.hash
let pwVerify = defaultPassword.verify
let pwIsHashed = defaultPassword.isHashed

export function setPasswordHasher({ hash, verify, isHashed }) {
  if (hash) pwHash = hash
  if (verify) pwVerify = verify
  if (isHashed) pwIsHashed = isHashed
}

// === TOKEN VERIFIER DI ===================================================
// Default — parseJwt (decode-only). Реальный сервер должен инжектить
// verifyJwt (HMAC + exp), иначе getCaller и meHandler принимают любой токен
// без проверки подписи (auth-bypass). Этот DI нужен, чтобы handlers.js
// оставался браузер-совместимым (нет access к crypto.timingSafeEqual)
// и testable без поднятия HTTP-стека.
let tokenVerifier = parseJwt

export function setTokenVerifier(fn) {
  if (typeof fn === 'function') tokenVerifier = fn
}

// === PER-ACCOUNT LOGIN LOCKOUT ==========================================
// In-memory счётчик неудачных попыток входа: после LOGIN_FAILURE_LIMIT
// промахов в окне LOGIN_FAILURE_WINDOW_MS аккаунт блокируется на
// LOGIN_LOCKOUT_MS. По дизайну ephemeral (сбрасывается на рестарте) —
// это анти-bruteforce, а не permanent ban. rate-limit на /api/auth/login
// в Express бьёт по IP; этот слой бьёт по username (защита от ботнета,
// который вертит IP но долбит один логин).
//
// Чтобы не палить существование пользователя по timing'у, считаем фейлы
// для любого username (включая несуществующие). loginFailures держит
// только записи с активным окном — старые лениво вычищаются на следующей
// попытке того же username.
const LOGIN_FAILURE_LIMIT = Number(process.env.LOGIN_FAILURE_LIMIT) || 5
const LOGIN_LOCKOUT_MS = Number(process.env.LOGIN_LOCKOUT_MS) || 15 * 60_000
const LOGIN_FAILURE_WINDOW_MS = Number(process.env.LOGIN_FAILURE_WINDOW_MS) || 15 * 60_000

// Map<username, { count, firstFailAt, lockedUntil }>
const loginFailures = new Map()

// Зеркалируем Map → db.loginFailureMeta после каждой мутации, чтобы запись
// попала в SQLite через общий save-pipeline. Стоимость O(n), n обычно <100
// (даже под атакой, т.к. cleanupLoginFailures чистит протухшие). Map
// остаётся источником истины для O(1) lookup; массив — для персистентности.
function mirrorLoginFailures() {
  db.loginFailureMeta = Array.from(loginFailures.entries()).map(([username, rec]) => ({ username, ...rec }))
}

function checkLockout(username) {
  const rec = loginFailures.get(username)
  if (!rec) return 0
  const now = Date.now()
  if (rec.lockedUntil > now) return Math.ceil((rec.lockedUntil - now) / 1000)
  if (rec.lockedUntil > 0 && rec.lockedUntil <= now) {
    // Lockout истёк — стираем запись, следующая ошибка начнёт окно заново.
    loginFailures.delete(username)
    mirrorLoginFailures()
  }
  return 0
}

function recordLoginFailure(username) {
  const now = Date.now()
  let rec = loginFailures.get(username)
  if (!rec || (now - rec.firstFailAt) > LOGIN_FAILURE_WINDOW_MS) {
    rec = { count: 0, firstFailAt: now, lockedUntil: 0 }
    loginFailures.set(username, rec)
  }
  rec.count++
  if (rec.count >= LOGIN_FAILURE_LIMIT) {
    rec.lockedUntil = now + LOGIN_LOCKOUT_MS
  }
  mirrorLoginFailures()
}

function clearLoginFailures(username) {
  loginFailures.delete(username)
  mirrorLoginFailures()
}

// Test/admin helper: позволяет вручную сбросить локаут (для тестов и
// /api/admin/unlock-user в будущем).
export function _resetLoginFailures(username) {
  if (username) loginFailures.delete(username)
  else loginFailures.clear()
  mirrorLoginFailures()
}

// Сколько записей сейчас в lockout-map. Для /health/metrics — видеть рост.
export function loginFailuresSize() {
  return loginFailures.size
}

// Евиктит «протухшие» записи из loginFailures. Запись протухшая если:
//   - lockout активен, но истёк (lockedUntil > 0 && lockedUntil <= now), ИЛИ
//   - lockout не наступал, а failure-окно истекло
//     (lockedUntil === 0 && now - firstFailAt > LOGIN_FAILURE_WINDOW_MS).
// Активные lockout'ы (lockedUntil > now) и активные окна оставляем.
//
// Без этой функции Map рос монотонно: атакующий с rotation usernames
// (admin1, admin2, ...) оставлял по записи на каждый и они никогда не
// чистились (ленивая очистка в checkLockout срабатывает только при повторе
// того же username). Maintenance-tick вызывает раз в 5 мин.
export function cleanupLoginFailures() {
  const now = Date.now()
  let removed = 0
  let mutatedUser = false
  let mutatedIp = false
  for (const [username, rec] of loginFailures) {
    const lockoutExpired = rec.lockedUntil > 0 && rec.lockedUntil <= now
    const windowExpired = rec.lockedUntil === 0 && (now - rec.firstFailAt) > LOGIN_FAILURE_WINDOW_MS
    if (lockoutExpired || windowExpired) {
      loginFailures.delete(username)
      removed++
      mutatedUser = true
    }
  }
  // Параллельный per-IP трекер (см. ниже): тот же протокол очистки.
  for (const [ip, rec] of loginFailuresByIp) {
    const lockoutExpired = rec.lockedUntil > 0 && rec.lockedUntil <= now
    const windowExpired = rec.lockedUntil === 0 && (now - rec.firstFailAt) > LOGIN_IP_FAILURE_WINDOW_MS
    if (lockoutExpired || windowExpired) {
      loginFailuresByIp.delete(ip)
      removed++
      mutatedIp = true
    }
  }
  // Mirror только если действительно что-то меняли — иначе впустую перебираем
  // Map в Array.from на каждый maintenance-tick.
  if (mutatedUser) mirrorLoginFailures()
  if (mutatedIp) mirrorIpFailures()
  return removed
}

// === PER-IP LOGIN LOCKOUT ==============================================
// Per-username lockout закрывает «один логин, ботнет с разных IP» (=
// classic credential stuffing). Симметричный сценарий — «один IP, перебор
// разных username» (admin/root/user1/…) — обходит per-username threshold
// (по 1 фейлу на юзера, до порога не доходим). Per-IP трекер закрывает
// эту дыру.
//
// Параметры — выше per-username, потому что:
//   - threshold=30: NAT с 50 юзерами легко набирает 5-10 опечаток в норме,
//     30 уверенно сигналит «не human»;
//   - window=10мин: атаки идут потоком, не редко-распределённо;
//   - lockout=30мин: достаточный pain для атакующего, не катастрофа для NAT.
//
// Логика — параллельная: проверяется ОТДЕЛЬНО от per-username. Login проходит
// только если оба чека пропустили (IP не локнут И username не локнут).
const LOGIN_IP_FAILURE_THRESHOLD = Number(process.env.LOGIN_IP_FAILURE_THRESHOLD) || 30
const LOGIN_IP_FAILURE_WINDOW_MS = Number(process.env.LOGIN_IP_FAILURE_WINDOW_MS) || 10 * 60_000
const LOGIN_IP_LOCKOUT_MS = Number(process.env.LOGIN_IP_LOCKOUT_MS) || 30 * 60_000

// Map<ip, { count, firstFailAt, lockedUntil }>
const loginFailuresByIp = new Map()

// Парный mirror для per-IP трекера. Симметричен mirrorLoginFailures.
function mirrorIpFailures() {
  db.loginFailureByIpMeta = Array.from(loginFailuresByIp.entries()).map(([ip, rec]) => ({ ip, ...rec }))
}

function checkIpLockout(ip) {
  if (!ip) return 0
  const rec = loginFailuresByIp.get(ip)
  if (!rec) return 0
  const now = Date.now()
  if (rec.lockedUntil > now) return Math.ceil((rec.lockedUntil - now) / 1000)
  if (rec.lockedUntil > 0 && rec.lockedUntil <= now) {
    loginFailuresByIp.delete(ip)
    mirrorIpFailures()
  }
  return 0
}

function recordIpFailure(ip) {
  if (!ip) return
  const now = Date.now()
  let rec = loginFailuresByIp.get(ip)
  if (!rec || (now - rec.firstFailAt) > LOGIN_IP_FAILURE_WINDOW_MS) {
    rec = { count: 0, firstFailAt: now, lockedUntil: 0 }
    loginFailuresByIp.set(ip, rec)
  }
  rec.count++
  if (rec.count >= LOGIN_IP_FAILURE_THRESHOLD) {
    rec.lockedUntil = now + LOGIN_IP_LOCKOUT_MS
  }
  mirrorIpFailures()
}

function clearIpFailures(ip) {
  if (!ip) return
  loginFailuresByIp.delete(ip)
  mirrorIpFailures()
}

// Размер per-IP map'а — отдельный сигнал в /health (рост = атака с
// rotation usernames). Парный к loginFailuresSize().
export function loginFailuresByIpSize() {
  return loginFailuresByIp.size
}

// Test helper.
export function _resetLoginFailuresByIp(ip) {
  if (ip) loginFailuresByIp.delete(ip)
  else loginFailuresByIp.clear()
}

// Восстанавливает Map'ы lockout/replay-history из db.*Meta после загрузки
// из SQLite. Вызывается из server/storage.js один раз после loadFromDisk.
// Без этого после рестарта Map'ы пустые → активные lockout'ы и replay-history
// «забываются» (атакующий получает бесплатный reset на каждом рестарте).
export function _rehydrateSecurityState() {
  loginFailures.clear()
  if (Array.isArray(db.loginFailureMeta)) {
    for (const rec of db.loginFailureMeta) {
      const { username, ...rest } = rec
      if (username) loginFailures.set(username, rest)
    }
  }
  loginFailuresByIp.clear()
  if (Array.isArray(db.loginFailureByIpMeta)) {
    for (const rec of db.loginFailureByIpMeta) {
      const { ip, ...rest } = rec
      if (ip) loginFailuresByIp.set(ip, rest)
    }
  }
  usedRefreshTokens.clear()
  if (Array.isArray(db.replayHistoryMeta)) {
    for (const rec of db.replayHistoryMeta) {
      const { token, ...rest } = rec
      if (token) usedRefreshTokens.set(token, rest)
    }
  }
}

// === CREDENTIAL VALIDATION ==============================================
// Пароль: min 8 символов, не только цифры (защита от 12345678), хотя бы
// одна буква. Жёстко не требуем смешанный регистр / спец-символы — UX
// важнее, чем «security theater». Длина — главный фактор bruteforce-стойкости.
//
// Логин: 3..32 ASCII-символа [a-zA-Z0-9._-], не начинается с точки/дефиса.
// Кириллицу запрещаем — иначе collation-edge-cases в SQL-сравнениях.
const PASSWORD_MIN_LEN = Number(process.env.PASSWORD_MIN_LEN) || 8
const PASSWORD_MAX_LEN = 200
const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN_LEN) {
    return `Пароль должен быть не короче ${PASSWORD_MIN_LEN} символов`
  }
  if (pw.length > PASSWORD_MAX_LEN) {
    return `Пароль слишком длинный (>${PASSWORD_MAX_LEN} символов)`
  }
  if (/^\d+$/.test(pw)) {
    return 'Пароль не может состоять только из цифр'
  }
  if (!/[a-zA-Zа-яА-ЯёЁ]/.test(pw)) {
    return 'Пароль должен содержать хотя бы одну букву'
  }
  return null
}

function validateUsername(username) {
  if (typeof username !== 'string') return 'Некорректный логин'
  if (!USERNAME_RE.test(username)) {
    return 'Логин: 3–32 латинских символа/цифры, можно ._-, начало — буква или цифра'
  }
  return null
}

// === DATA VALIDATION (server-side, defense-in-depth) ====================
// Фронт валидирует INN/OGRN/email до POST'а, но любой не-браузерный клиент
// (curl, malicious uploader) может скормить мусор напрямую. Сервер — последняя
// линия. Возвращает строку-ошибку или null. Пустая строка трактуется как
// «поле не задано» (большинство полей опциональны, кроме name).

// OGRN: 13 цифр (ЮЛ) или 15 (ИП). Контрольная цифра = (число без последней) mod
// (10 для 13-знаков / 11 для 15-знаков), последний знак сравнивается.
function isOgrnValid(ogrn) {
  if (typeof ogrn !== 'string' || !/^\d+$/.test(ogrn)) return false
  if (ogrn.length === 13) {
    const main = ogrn.slice(0, 12)
    const check = Number(ogrn[12])
    return Number(BigInt(main) % 11n) % 10 === check
  }
  if (ogrn.length === 15) {
    const main = ogrn.slice(0, 14)
    const check = Number(ogrn[14])
    return Number(BigInt(main) % 13n) % 10 === check
  }
  return false
}

// Намеренно простой regex (RFC 5322 целиком — overkill и плохо читается).
// Покрывает 99% практики: один @, не-пустые местная и доменная части, точка
// в домене, нет пробелов/кириллицы. Длина до 254 (RFC 5321 hard-limit).
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
function isEmailValid(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email)
}

// KPP: 9 цифр (для ЮЛ). У ИП нет КПП — пустое значение тоже валидно.
function isKppValid(kpp) {
  return typeof kpp === 'string' && /^\d{9}$/.test(kpp)
}

// Phone: разрешаем цифры, пробелы, скобки, дефисы, плюс. Минимум 6 цифр
// (короче — мусор), максимум 32 символа (длиннее — мусор). Без жёсткой
// нормализации — пользователь может писать +7 (495) 123-45-67 или 84951234567.
function isPhoneValid(phone) {
  if (typeof phone !== 'string') return false
  if (phone.length > 32) return false
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 6 && /^[\d\s()+-]+$/.test(phone)
}

// Валидация payload организации. Empty опциональные поля — OK; присутствие
// требует валидного формата. name — обязателен (без него запись бессмысленна).
// Возвращает строку-ошибку или null.
export function validateOrgPayload(body) {
  if (!body || typeof body !== 'object') return 'Некорректный запрос'
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return 'Поле name обязательно'
  if (name.length > 200) return 'Поле name слишком длинное (>200 символов)'
  if (body.kind && body.kind !== 'ul' && body.kind !== 'ip') {
    return 'Поле kind должно быть "ul" или "ip"'
  }
  if (body.inn && !isInnValid(String(body.inn))) return 'Некорректный ИНН'
  if (body.ogrn && !isOgrnValid(String(body.ogrn))) return 'Некорректный ОГРН/ОГРНИП'
  if (body.kpp && !isKppValid(String(body.kpp))) return 'Некорректный КПП (9 цифр)'
  if (body.email && !isEmailValid(String(body.email))) return 'Некорректный email'
  if (body.phone && !isPhoneValid(String(body.phone))) return 'Некорректный телефон'
  if (body.address && String(body.address).length > 500) return 'Поле address слишком длинное'
  if (body.notes && String(body.notes).length > 2000) return 'Поле notes слишком длинное'
  return null
}

// === PAGE-SIZE CLAMP ====================================================
// Защита от `?pageSize=999999`: возвращать огромные массивы — это и память,
// и сеть, и время сериализации. Все list-хендлеры пропускают `pageSize`
// через clampPageSize → max 200 (или 500 для тех, кому исторически надо).
// fallback на дефолт сохраняется (пустой/невалидный → подставляем).
const PAGE_SIZE_HARD_MAX = Number(process.env.PAGE_SIZE_HARD_MAX) || 500

function clampPageSize(raw, fallback, max = 200) {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, Math.min(max, PAGE_SIZE_HARD_MAX))
}

const RU_COLLATOR = new Intl.Collator('ru')
const cmpRu = RU_COLLATOR.compare

// === SORT CACHES =========================================================
// Кешируем отсортированные «view»-массивы для тяжёлых списков. Версия бьётся
// руками из мутирующих хендлеров — это дешевле, чем хук на каждую запись.
let personalSortVersion = 0
let personalSortedCache = null
function bumpPersonal() { personalSortVersion++ }
function getSortedPersonal() {
  if (personalSortedCache?.v === personalSortVersion) return personalSortedCache.arr
  const arr = [...db.personal].sort(
    (a, b) => cmpRu(a.lastName, b.lastName) || cmpRu(a.firstName, b.firstName)
  )
  personalSortedCache = { v: personalSortVersion, arr }
  return arr
}

// Lowercase-блоб для полнотекстового поиска — кешируется по ссылке на запись
// (WeakMap), при подмене записи (splice → новый объект) старый ключ GC'нется.
const equipmentSearchBlob = new WeakMap()
function equipmentSearchBlobOf(e) {
  let v = equipmentSearchBlob.get(e)
  if (v !== undefined) return v
  v = `${e.name}\x00${e.model ?? ''}\x00${e.serial ?? ''}\x00${e.inventoryNumber ?? ''}`.toLowerCase()
  equipmentSearchBlob.set(e, v)
  return v
}

export async function handleMockRequest({ method, url, body, headers }) {
  if (MOCK_DELAY_MS > 0) await delay(MOCK_DELAY_MS)

  const path = stripQuery(url)

  // === AUTH =============================================================
  if (method === 'POST' && path === '/auth/login') return loginHandler(body, headers)
  if (method === 'POST' && path === '/auth/register') return registerHandler(body, headers)
  if (method === 'POST' && path === '/auth/refresh') return refreshHandler(body, headers)
  if (method === 'POST' && path === '/auth/logout') return logoutHandler(body)
  if (method === 'GET' && path === '/auth/me') return meHandler(headers)
  if (method === 'POST' && path === '/auth/password') return changePasswordHandler(body, getCaller(headers), headers)

  // === AUTH: sessions (refresh-token store) ============================
  const sessionIdMatch = path.match(/^\/auth\/sessions\/([^/]+)$/)
  if (method === 'GET' && path === '/auth/sessions')
    return sessionsListHandler(getCaller(headers))
  if (method === 'DELETE' && sessionIdMatch)
    return sessionsDeleteHandler(sessionIdMatch[1], getCaller(headers))

  // === DICTIONARIES (read-only справочники КиберДок) ====================
  const dictMatch = path.match(/^\/dictionaries\/([a-zA-Z_]+)$/)
  if (method === 'GET' && dictMatch)
    return dictionaryHandler(dictMatch[1], getCaller(headers))

  // === PERSONAL (сотрудники организаций) ================================
  const persIdMatch = path.match(/^\/personal\/([^/]+)$/)
  if (method === 'GET' && path === '/personal')
    return personalListHandler(parseQuery(url), getCaller(headers))
  if (method === 'POST' && path === '/personal/bulk-upsert')
    return personalBulkUpsertHandler(body, getCaller(headers))
  if (method === 'POST' && path === '/personal')
    return personalCreateHandler(body, getCaller(headers))
  if (method === 'GET' && persIdMatch)
    return personalGetHandler(persIdMatch[1], getCaller(headers))
  if (method === 'PUT' && persIdMatch)
    return personalUpdateHandler(persIdMatch[1], body, getCaller(headers))
  if (method === 'DELETE' && persIdMatch)
    return personalDeleteHandler(persIdMatch[1], getCaller(headers))

  // === INFO-SYSTEMS (информационные системы) ============================
  const isIdMatch = path.match(/^\/info-systems\/([^/]+)$/)
  if (method === 'GET' && path === '/info-systems')
    return infoSystemListHandler(parseQuery(url), getCaller(headers))
  if (method === 'POST' && path === '/info-systems')
    return infoSystemCreateHandler(body, getCaller(headers))
  if (method === 'GET' && isIdMatch)
    return infoSystemGetHandler(isIdMatch[1], getCaller(headers))
  if (method === 'PUT' && isIdMatch)
    return infoSystemUpdateHandler(isIdMatch[1], body, getCaller(headers))
  if (method === 'DELETE' && isIdMatch)
    return infoSystemDeleteHandler(isIdMatch[1], getCaller(headers))

  // === FNS proxy (bulk-lookup) ==========================================
  if (method === 'POST' && path === '/fns/lookup') return fnsLookupHandler(body, getCaller(headers))

  // === INN-REGISTRY (сохранённый пользовательский реестр) ==============
  const innIdMatch = path.match(/^\/inn-registry\/([^/]+)$/)
  if (method === 'GET' && path === '/inn-registry')
    return innListHandler(parseQuery(url), getCaller(headers))
  if (method === 'POST' && path === '/inn-registry/bulk-upsert')
    return innBulkUpsertHandler(body, getCaller(headers))
  if (method === 'DELETE' && innIdMatch)
    return innDeleteHandler(innIdMatch[1], getCaller(headers))
  if (method === 'DELETE' && path === '/inn-registry')
    return innClearHandler(getCaller(headers))

  // === ORGANIZATIONS ====================================================
  const orgIdMatch = path.match(/^\/organizations\/([^/]+)$/)
  if (method === 'GET' && path === '/organizations')
    return orgListHandler(parseQuery(url), getCaller(headers))
  if (method === 'POST' && path === '/organizations')
    return orgCreateHandler(body, getCaller(headers))
  if (method === 'GET' && orgIdMatch)
    return orgGetHandler(orgIdMatch[1], getCaller(headers))
  if (method === 'PUT' && orgIdMatch)
    return orgUpdateHandler(orgIdMatch[1], body, getCaller(headers))
  if (method === 'DELETE' && orgIdMatch)
    return orgDeleteHandler(orgIdMatch[1], getCaller(headers))

  // === EQUIPMENT ========================================================
  const eqIdMatch = path.match(/^\/equipment\/([^/]+)$/)
  if (method === 'GET' && path === '/equipment')
    return equipmentListHandler(parseQuery(url), getCaller(headers))
  if (method === 'POST' && path === '/equipment')
    return equipmentCreateHandler(body, getCaller(headers))
  if (method === 'GET' && eqIdMatch)
    return equipmentGetHandler(eqIdMatch[1], getCaller(headers))
  if (method === 'PUT' && eqIdMatch)
    return equipmentUpdateHandler(eqIdMatch[1], body, getCaller(headers))
  if (method === 'DELETE' && eqIdMatch)
    return equipmentDeleteHandler(eqIdMatch[1], getCaller(headers))

  // === SOFTWARE (системное + прикладное ПО) =============================
  const swIdMatch = path.match(/^\/software\/([^/]+)$/)
  if (method === 'GET' && path === '/software')
    return softwareListHandler(parseQuery(url), getCaller(headers))
  if (method === 'POST' && path === '/software')
    return softwareCreateHandler(body, getCaller(headers))
  if (method === 'GET' && swIdMatch)
    return softwareGetHandler(swIdMatch[1], getCaller(headers))
  if (method === 'PUT' && swIdMatch)
    return softwareUpdateHandler(swIdMatch[1], body, getCaller(headers))
  if (method === 'DELETE' && swIdMatch)
    return softwareDeleteHandler(swIdMatch[1], getCaller(headers))

  // === SECURITY-TOOLS-CATALOG (read-only справочник СЗИ ФСТЭК) ==========
  const stcIdMatch = path.match(/^\/security-tools-catalog\/([^/]+)$/)
  if (method === 'GET' && path === '/security-tools-catalog')
    return stCatalogListHandler(parseQuery(url), getCaller(headers))
  if (method === 'POST' && path === '/security-tools-catalog')
    return stCatalogCreateHandler(body, getCaller(headers))
  if (method === 'GET' && stcIdMatch)
    return stCatalogGetHandler(stcIdMatch[1], getCaller(headers))
  if (method === 'PUT' && stcIdMatch)
    return stCatalogUpdateHandler(stcIdMatch[1], body, getCaller(headers))
  if (method === 'DELETE' && stcIdMatch)
    return stCatalogDeleteHandler(stcIdMatch[1], getCaller(headers))

  // === SECURITY-TOOLS (экземпляры СЗИ у организации) ===================
  const stIdMatch = path.match(/^\/security-tools\/([^/]+)$/)
  if (method === 'GET' && path === '/security-tools')
    return stListHandler(parseQuery(url), getCaller(headers))
  if (method === 'POST' && path === '/security-tools')
    return stCreateHandler(body, getCaller(headers))
  if (method === 'GET' && stIdMatch)
    return stGetHandler(stIdMatch[1], getCaller(headers))
  if (method === 'PUT' && stIdMatch)
    return stUpdateHandler(stIdMatch[1], body, getCaller(headers))
  if (method === 'DELETE' && stIdMatch)
    return stDeleteHandler(stIdMatch[1], getCaller(headers))

  // === THREAT-MODELS (модели угроз ФСТЭК) ==============================
  if (method === 'GET' && path === '/threats-catalog')
    return threatsCatalogListHandler(parseQuery(url), getCaller(headers))

  const tmIdMatch = path.match(/^\/threat-models\/([^/]+)$/)
  if (method === 'GET' && path === '/threat-models')
    return tmListHandler(parseQuery(url), getCaller(headers))
  if (method === 'POST' && path === '/threat-models')
    return tmCreateHandler(body, getCaller(headers))
  if (method === 'GET' && tmIdMatch)
    return tmGetHandler(tmIdMatch[1], getCaller(headers))
  if (method === 'PUT' && tmIdMatch)
    return tmUpdateHandler(tmIdMatch[1], body, getCaller(headers))
  if (method === 'DELETE' && tmIdMatch)
    return tmDeleteHandler(tmIdMatch[1], getCaller(headers))

  // === DOCUMENT-SETS (пакеты ОРД) ======================================
  if (method === 'GET' && path === '/document-set-templates')
    return dsTemplateListHandler(getCaller(headers))
  const dsTemplateIdMatch = path.match(/^\/document-set-templates\/([^/]+)$/)
  if (method === 'GET' && dsTemplateIdMatch)
    return dsTemplateGetHandler(dsTemplateIdMatch[1], getCaller(headers))

  const dsIdMatch = path.match(/^\/document-sets\/([^/]+)$/)
  if (method === 'GET' && path === '/document-sets')
    return dsListHandler(parseQuery(url), getCaller(headers))
  if (method === 'POST' && path === '/document-sets')
    return dsCreateHandler(body, getCaller(headers))
  if (method === 'GET' && dsIdMatch)
    return dsGetHandler(dsIdMatch[1], getCaller(headers))
  if (method === 'DELETE' && dsIdMatch)
    return dsDeleteHandler(dsIdMatch[1], getCaller(headers))

  // === DOCUMENTS (registry) ============================================
  const docIdMatch = path.match(/^\/registry\/([^/]+)$/)
  const docActionMatch = path.match(/^\/registry\/([^/]+)\/(submit|approve|reject)$/)
  if (method === 'GET' && path === '/registry')
    return docListHandler(parseQuery(url), getCaller(headers))
  if (method === 'POST' && path === '/registry')
    return docCreateHandler(body, getCaller(headers))
  if (method === 'POST' && docActionMatch)
    return docActionHandler(docActionMatch[1], docActionMatch[2], body, getCaller(headers))
  if (method === 'GET' && docIdMatch)
    return docGetHandler(docIdMatch[1], getCaller(headers))
  if (method === 'PUT' && docIdMatch)
    return docUpdateHandler(docIdMatch[1], body, getCaller(headers))
  if (method === 'DELETE' && docIdMatch)
    return docDeleteHandler(docIdMatch[1], getCaller(headers))

  // === ADMIN: users =====================================================
  const adminUserMatch = path.match(/^\/admin\/users\/([^/]+)$/)
  const adminUserActionMatch = path.match(/^\/admin\/users\/([^/]+)\/(verify|block|role|password|unlock)$/)
  if (method === 'GET' && path === '/admin/users')
    return adminUserListHandler(parseQuery(url), getCaller(headers))
  if (method === 'POST' && adminUserActionMatch)
    return adminUserActionHandler(adminUserActionMatch[1], adminUserActionMatch[2], body, getCaller(headers))
  if (method === 'DELETE' && adminUserMatch)
    return adminUserDeleteHandler(adminUserMatch[1], getCaller(headers))

  // === ADMIN: sessions ==================================================
  // GET    /admin/sessions[?username=X]  — список (всех или фильтр)
  // DELETE /admin/sessions/:id           — отзыв любой сессии (есть и в /auth/, но та для своих)
  // POST   /admin/users/:u/logout-all    — массовый отзыв всех сессий юзера
  const adminSessionIdMatch = path.match(/^\/admin\/sessions\/([^/]+)$/)
  const adminLogoutAllMatch = path.match(/^\/admin\/users\/([^/]+)\/logout-all$/)
  if (method === 'GET' && path === '/admin/sessions')
    return adminSessionsListHandler(parseQuery(url), getCaller(headers))
  if (method === 'DELETE' && adminSessionIdMatch)
    return adminSessionsDeleteHandler(adminSessionIdMatch[1], getCaller(headers))
  if (method === 'POST' && adminLogoutAllMatch)
    return adminLogoutAllHandler(adminLogoutAllMatch[1], getCaller(headers))

  // === Журнал действий и статистика =====================================
  if (method === 'GET' && path === '/audit')
    return auditListHandler(parseQuery(url), getCaller(headers))
  if (method === 'GET' && path === '/statistics')
    return statisticsHandler(getCaller(headers))

  return { status: 404, data: { error: `Mock: no handler for ${method} ${path}` } }
}

// ---------- handlers ----------

async function loginHandler(body, headers) {
  const username = String(body?.username ?? '')
  const password = String(body?.password ?? '')
  const ip = String(headers?.['x-real-ip'] ?? '')

  // 1. Лок-чеки до обращения к БД и pwVerify (scrypt дорогой) — даже если
  // юзер закидывает запросами, мы быстро отбиваемся. Чек ДВА: per-username
  // (классический lockout) и per-IP (закрывает rotation usernames).
  const lockedFor = checkLockout(username)
  if (lockedFor > 0) {
    const minutes = Math.ceil(lockedFor / 60)
    // Audit: эти события — сигнал «кого-то долбят». Видно в /audit и в SIEM.
    logAudit(username || '(anon)', 'auth.login.locked', username, `lock ${minutes}мин`, ip)
    return {
      status: 429,
      data: {
        error: 'account_locked',
        message: `Слишком много неудачных попыток. Аккаунт временно заблокирован, попробуйте через ${minutes} мин.`,
        retryAfterSec: lockedFor
      }
    }
  }
  const ipLockedFor = checkIpLockout(ip)
  if (ipLockedFor > 0) {
    const minutes = Math.ceil(ipLockedFor / 60)
    logAudit('(ip)', 'auth.login.locked_ip', ip, `lock ${minutes}мин`, ip)
    return {
      status: 429,
      data: {
        error: 'ip_locked',
        message: `Слишком много неудачных попыток с этого IP. Подождите ${minutes} мин.`,
        retryAfterSec: ipLockedFor
      }
    }
  }

  const idx = db.users.findIndex((x) => x.username === username)
  if (idx < 0) {
    // Считаем фейл даже для несуществующих логинов — иначе атакующий
    // отличает «нет такого юзера» (без лимита) от «есть, но пароль не тот».
    recordLoginFailure(username)
    recordIpFailure(ip)
    logAudit(username || '(anon)', 'auth.login.fail', username, 'unknown_user', ip)
    return { status: 401, dirty: true, data: { error: 'Неверный логин или пароль' } }
  }
  const u = db.users[idx]
  if (!(await pwVerify(password, u.password))) {
    recordLoginFailure(username)
    recordIpFailure(ip)
    logAudit(username, 'auth.login.fail', username, 'wrong_password', ip)
    return { status: 401, dirty: true, data: { error: 'Неверный логин или пароль' } }
  }
  // Успех — гасим счётчики, чтобы прошлые промахи не накапливались.
  clearLoginFailures(username)
  clearIpFailures(ip)
  // Ленивая миграция: первый успешный логин для legacy plain → пересохраняем hash.
  if (!pwIsHashed(u.password)) {
    db.users.splice(idx, 1, { ...u, password: await pwHash(password) })
  }
  const token = makeAccessToken({
    username: u.username,
    role: u.role,
    verified: u.verified,
    blocked: u.blocked
  })
  const refreshToken = makeRefreshToken(u.username)
  registerSession(refreshToken, u.username, headers)
  logAudit(u.username, 'auth.login.ok', u.username, u.role, ip)
  return { status: 200, data: { token, refreshToken } }
}

async function registerHandler(body, headers) {
  if (!body?.username || !body?.password || !body?.email)
    return { status: 400, data: { error: 'Заполните все поля' } }
  const userErr = validateUsername(body.username)
  if (userErr) return { status: 400, data: { error: 'invalid_username', message: userErr } }
  const pwErr = validatePassword(body.password)
  if (pwErr) return { status: 400, data: { error: 'invalid_password', message: pwErr } }
  if (db.users.some((x) => x.username === body.username))
    return { status: 409, data: { error: 'Пользователь с таким логином уже есть' } }
  db.users.push({
    id: nextDbId(),
    username: body.username,
    email: body.email,
    password: await pwHash(body.password),
    role: 'user',
    verified: true,
    blocked: false,
    createdAt: Date.now()
  })
  const ip = String(headers?.['x-real-ip'] ?? '')
  logAudit(body.username, 'auth.register', body.username, body.email, ip)
  return { status: 201, data: { ok: true } }
}

function refreshHandler(body, headers) {
  const presented = body?.refreshToken
  const ip = String(headers?.['x-real-ip'] ?? '')
  const username = db.refreshTokens.get(presented)
  if (!username) {
    // Replay-detection: если токена нет в активных, но он ЕСТЬ в истории
    // использованных — это повторное использование уже отработавшего токена.
    // Сценарий: атакующий перехватил refresh, legit-юзер тем временем уже
    // использовал его (rotation сжёг старый), потом атакующий приходит с
    // тем же токеном. Реакция: ревокать ВСЕ сессии юзера — не знаем кто
    // из двух «настоящий», обоим придётся залогиниться заново. Это правильно:
    // legit увидит «логнули из всех устройств» и сменит пароль.
    const replayed = presented && usedRefreshTokens.get(presented)
    if (replayed) {
      refreshReplayCount++
      revokeAllSessionsOf(replayed.username)
      // Помечаем все остальные refresh-токены этого юзера тоже как «used» —
      // иначе атакующий подберёт следующий refresh из перехваченной партии.
      usedRefreshTokens.delete(presented) // конкретно этот уже отработал
      mirrorReplayHistory()
      logAudit(replayed.username, 'auth.refresh_replay', `user:${replayed.username}`,
        'all_sessions_revoked', ip)
      return { status: 401, dirty: true, data: { error: 'token_replayed', message: 'Подозрение на компрометацию токена. Все сессии отозваны, войдите заново.' } }
    }
    return { status: 401, data: { error: 'invalid_refresh' } }
  }
  const u = db.users.find((x) => x.username === username)
  if (!u) return { status: 401, data: { error: 'invalid_refresh' } }
  // TTL-чек: absolute lifetime + idle timeout. Если сессия слишком стара ИЛИ
  // ей не пользовались дольше idle — отзываем и требуем повторный login.
  const meta = db.refreshTokenMeta.find((s) => s.token === presented)
  if (meta) {
    const now = Date.now()
    if ((now - meta.createdAt) > REFRESH_TTL_MS || (now - meta.lastUsed) > REFRESH_IDLE_MS) {
      revokeSession(presented)
      return { status: 401, data: { error: 'session_expired' } }
    }
  }
  const token = makeAccessToken({
    username: u.username,
    role: u.role,
    verified: u.verified,
    blocked: u.blocked
  })
  const newRefresh = makeRefreshToken(u.username)
  // Rotation: убираем старый, регистрируем новый, ЗАПОМИНАЕМ старый в replay-store.
  revokeSession(presented)
  markRefreshUsed(presented, u.username)
  registerSession(newRefresh, u.username, headers)
  refreshRotatedCount++
  return { status: 200, data: { token, refreshToken: newRefresh } }
}

function logoutHandler(body) {
  if (body?.refreshToken) revokeSession(body.refreshToken)
  return { status: 200, data: { ok: true } }
}

// ---------- session store helpers ----------
// refreshTokens (Map) + refreshTokenMeta (array) обновляются вместе.
// Источник истины — массив (он персистится в SQLite); Map — это derived view
// для O(1) lookup. Обе структуры должны быть в синхроне.
//
// TTL: absolute (30d) и idle (7d). После absolute сессия гарантированно
// мертва — клиент идёт через login заново. Idle защищает от «забытых
// токенов на старом ноутбуке»: не использовался неделю — отзываем.
// Cleanup делается лениво при refresh + раз в maintenance-tick.

const REFRESH_TTL_MS = Number(process.env.REFRESH_TTL_MS) || 30 * 86400_000
const REFRESH_IDLE_MS = Number(process.env.REFRESH_IDLE_MS) || 7 * 86400_000

// История ОТРАБОТАННЫХ refresh-токенов: после rotation старый токен невалиден,
// но мы помним его REPLAY_HISTORY_TTL_MS, чтобы отличить «токен никогда не
// существовал» (просто 401) от «токен был валиден, но уже использован»
// (replay → токен украден, надо ревокать все сессии этого юзера).
// Map: token → {username, usedAt}. Hard-cap на размер чтобы не утечь.
const REPLAY_HISTORY_TTL_MS = Number(process.env.REPLAY_HISTORY_TTL_MS) || 7 * 86400_000
const REPLAY_HISTORY_MAX = Number(process.env.REPLAY_HISTORY_MAX) || 5000
const usedRefreshTokens = new Map()

// Mirror для replay-history. Без него после рестарта Map пустеет → украденный
// токен будет «никогда не существовал» (просто 401), а не «использован → revoke
// all sessions». Phase 16 без персистентности был частично декорацией.
function mirrorReplayHistory() {
  db.replayHistoryMeta = Array.from(usedRefreshTokens.entries()).map(([token, meta]) => ({ token, ...meta }))
}

// Метрики rotation/replay. Экспортируются через export'ы ниже, в /metrics
// собирает server/index.js. Сбрасываются при рестарте — для накопления
// нужен внешний exporter (TODO Phase: structured logs/pino).
let refreshRotatedCount = 0
let refreshReplayCount = 0

export function refreshRotationStats() {
  return { rotated: refreshRotatedCount, replays: refreshReplayCount, historySize: usedRefreshTokens.size }
}

// Запоминаем использованный токен. При переполнении выкидываем самый старый
// (Map сохраняет insertion order — берём first key через iterator).
function markRefreshUsed(token, username) {
  if (usedRefreshTokens.size >= REPLAY_HISTORY_MAX) {
    const firstKey = usedRefreshTokens.keys().next().value
    if (firstKey) usedRefreshTokens.delete(firstKey)
  }
  usedRefreshTokens.set(token, { username, usedAt: Date.now() })
  mirrorReplayHistory()
}

// Чистим протухшие записи из replay-истории. Вызывается из cleanupExpiredSessions
// в maintenance-tick — общий цикл, не плодим таймеров.
function cleanupReplayHistory() {
  const cutoff = Date.now() - REPLAY_HISTORY_TTL_MS
  let removed = 0
  for (const [tok, meta] of usedRefreshTokens) {
    if (meta.usedAt < cutoff) {
      usedRefreshTokens.delete(tok)
      removed++
    }
  }
  if (removed > 0) mirrorReplayHistory()
  return removed
}

// Максимум одновременных refresh-сессий на одного юзера. При превышении —
// FIFO eviction (выкидываем самую старую по createdAt), новая сессия проходит.
// Альтернатива «отбить новый логин» = DoS на легитимного юзера: достаточно
// одного «протухшего» tab'а из 5 чтобы он не смог залогиниться. Поэтому
// предпочитаем silent revoke старой + audit-запись для трейсабельности.
// 5 покрывает realistic-сценарий (десктоп + ноут + телефон + работа + запас).
const SESSIONS_PER_USER_MAX = Number(process.env.SESSIONS_PER_USER_MAX) || 5

// Чистит просроченные сессии. Возвращает кол-во удалённых. Идемпотентно.
// Вызывается из server/index.js в maintenance-tick.
// Заодно подрезаем replay-историю — оба касаются refresh-механики, разносить
// в отдельный maintenance-шаг смысла нет.
export function cleanupExpiredSessions() {
  const now = Date.now()
  const before = db.refreshTokenMeta.length
  const survivors = []
  for (const s of db.refreshTokenMeta) {
    const expired = (now - s.createdAt) > REFRESH_TTL_MS || (now - s.lastUsed) > REFRESH_IDLE_MS
    if (expired) {
      db.refreshTokens.delete(s.token)
    } else {
      survivors.push(s)
    }
  }
  if (survivors.length !== before) db.refreshTokenMeta = survivors
  cleanupReplayHistory()
  return before - survivors.length
}

function registerSession(token, username, headers) {
  const now = Date.now()
  const ua = String(headers?.['user-agent'] ?? '').slice(0, 200)
  const ip = String(headers?.['x-real-ip'] ?? '').slice(0, 64)
  db.refreshTokens.set(token, username)
  db.refreshTokenMeta.push({
    id: `sess-${now}-${Math.random().toString(36).slice(2, 8)}`,
    token,
    username,
    createdAt: now,
    lastUsed: now,
    userAgent: ua
  })
  // FIFO eviction: после вставки новая сессия — последняя из ≤MAX. Если у юзера
  // больше — выкидываем самые старые (по createdAt asc). Делать ПОСЛЕ push,
  // чтобы новая всегда выжила (см. doc выше про DoS). Линейный проход дёшев:
  // на одного юзера обычно <10 записей.
  enforceSessionQuota(username, ip)
}

// Подрезает refresh-сессии конкретного юзера до SESSIONS_PER_USER_MAX.
// Удаляемые — самые старые по createdAt; синхронно вычищает их из db.refreshTokens
// и пишет audit-запись `session_evicted` с reason=`over_quota`. Идемпотентна
// (≤MAX → no-op). Возвращает кол-во удалённых.
function enforceSessionQuota(username, ip = '') {
  const own = db.refreshTokenMeta.filter((s) => s.username === username)
  if (own.length <= SESSIONS_PER_USER_MAX) return 0
  own.sort((a, b) => a.createdAt - b.createdAt)
  const victims = own.slice(0, own.length - SESSIONS_PER_USER_MAX)
  const victimIds = new Set(victims.map((s) => s.id))
  for (const v of victims) db.refreshTokens.delete(v.token)
  db.refreshTokenMeta = db.refreshTokenMeta.filter((s) => !victimIds.has(s.id))
  // Один audit-record на eviction-волну (а не на каждую сессию): меньше шума,
  // details содержат IDs всех удалённых. Detector в SIEM ловит этот action.
  logAudit(
    username,
    'session_evicted',
    `user:${username}`,
    `reason=over_quota max=${SESSIONS_PER_USER_MAX} evicted=${victims.map((v) => v.id).join(',')}`,
    ip
  )
  return victims.length
}

function revokeSession(token) {
  if (!token) return false
  const had = db.refreshTokens.delete(token)
  const idx = db.refreshTokenMeta.findIndex((s) => s.token === token)
  if (idx >= 0) db.refreshTokenMeta.splice(idx, 1)
  return had
}

function revokeAllSessionsOf(username) {
  for (const [tok, owner] of db.refreshTokens) {
    if (owner === username) db.refreshTokens.delete(tok)
  }
  db.refreshTokenMeta = db.refreshTokenMeta.filter((s) => s.username !== username)
}

function sessionsListHandler(caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const items = db.refreshTokenMeta
    .filter((s) => s.username === caller.username)
    .map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastUsed: s.lastUsed,
      userAgent: s.userAgent
      // Сам token не возвращаем — это secret. ID хватает для revoke.
    }))
    .sort((a, b) => b.lastUsed - a.lastUsed)
  return { status: 200, data: { items, total: items.length } }
}

function sessionsDeleteHandler(sessionId, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.refreshTokenMeta.findIndex((s) => s.id === sessionId)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const sess = db.refreshTokenMeta[idx]
  // user → только свои; admin → любые.
  if (caller.role !== 'admin' && sess.username !== caller.username) {
    return { status: 403, data: { error: 'forbidden' } }
  }
  revokeSession(sess.token)
  return { status: 200, data: { ok: true } }
}

// ---------- admin sessions ----------
// «Дублирующие» эндпоинты под /admin/* для админ-консоли: тот же стор,
// другой scope (любой юзер). Это удобно для UI: фронт не должен знать
// «можно ли админу дёрнуть /auth/sessions с username=...». Маршруты
// явные, права проверяются здесь.

function adminSessionsListHandler({ username = '' }, caller) {
  const guard = requireAdmin(caller)
  if (guard) return guard
  const filter = String(username || '').trim()
  let items = db.refreshTokenMeta
  if (filter) items = items.filter((s) => s.username === filter)
  return {
    status: 200,
    data: {
      items: items
        .map((s) => ({
          id: s.id,
          username: s.username,
          createdAt: s.createdAt,
          lastUsed: s.lastUsed,
          userAgent: s.userAgent
        }))
        .sort((a, b) => b.lastUsed - a.lastUsed),
      total: items.length
    }
  }
}

function adminSessionsDeleteHandler(sessionId, caller) {
  const guard = requireAdmin(caller)
  if (guard) return guard
  const idx = db.refreshTokenMeta.findIndex((s) => s.id === sessionId)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const sess = db.refreshTokenMeta[idx]
  revokeSession(sess.token)
  logAudit(caller.username, 'session.revoke', sess.username, `сессия ${sess.id}`)
  return { status: 200, data: { ok: true } }
}

function adminLogoutAllHandler(username, caller) {
  const guard = requireAdmin(caller)
  if (guard) return guard
  // Считаем сессии до отзыва — для аудита и ответа.
  const before = db.refreshTokenMeta.filter((s) => s.username === username).length
  revokeAllSessionsOf(username)
  logAudit(caller.username, 'session.logout-all', username, `отозвано ${before} сессий`)
  return { status: 200, data: { ok: true, revoked: before } }
}

function meHandler(headers) {
  const auth = headers?.authorization
  if (!auth?.startsWith('Bearer ')) return { status: 401, data: { error: 'no_token' } }
  const payload = tokenVerifier(auth.slice(7))
  if (!payload?.sub) return { status: 401, data: { error: 'invalid_token' } }
  const u = db.users.find((x) => x.username === payload.sub)
  if (!u) return { status: 404, data: { error: 'no_user' } }
  return {
    status: 200,
    data: {
      username: u.username,
      email: u.email,
      role: u.role,
      verified: u.verified,
      blocked: u.blocked,
      createdAt: u.createdAt ?? null
    }
  }
}

async function changePasswordHandler(body, caller, headers) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const current = String(body?.currentPassword ?? '')
  const next = String(body?.newPassword ?? '')
  if (!current || !next) return { status: 400, data: { error: 'missing_fields' } }
  const pwErr = validatePassword(next)
  if (pwErr) return { status: 400, data: { error: 'invalid_password', message: pwErr } }
  if (next === current) return { status: 400, data: { error: 'password_same' } }
  const idx = db.users.findIndex((x) => x.username === caller.username)
  if (idx === -1) return { status: 404, data: { error: 'no_user' } }
  const u = db.users[idx]
  if (!(await pwVerify(current, u.password))) return { status: 400, data: { error: 'wrong_current' } }
  db.users.splice(idx, 1, { ...u, password: await pwHash(next) })
  const ip = String(headers?.['x-real-ip'] ?? '')
  logAudit(caller.username, 'auth.password.change', caller.username, 'self', ip)
  return { status: 200, data: { ok: true } }
}

// ---------- organizations ----------

function orgListHandler({ page = 1, pageSize = 20, search = '' }, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const p = Number(page) || 1
  const ps = clampPageSize(pageSize, 20)
  const q = String(search || '').trim().toLowerCase()

  let items = db.organizations
  if (caller.role === 'user') items = items.filter((o) => o.ownerUsername === caller.username)
  if (q) {
    items = items.filter(
      (o) => o.name.toLowerCase().includes(q) || o.inn.includes(q)
    )
  }

  const total = items.length
  const start = (p - 1) * ps
  const slice = items.slice(start, start + ps)
  return { status: 200, data: { items: slice, total } }
}

function orgGetHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const o = db.organizations.find((x) => x.id === id)
  if (!o) return { status: 404, data: { error: 'not_found' } }
  if (caller.role === 'user' && o.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  return { status: 200, data: o }
}

function orgCreateHandler(body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  if (caller.role === 'expert') return { status: 403, data: { error: 'forbidden' } }
  const err = validateOrgPayload(body)
  if (err) return { status: 422, data: { error: 'invalid_payload', message: err } }
  const now = Date.now()
  const o = {
    id: `org-${now}-${Math.random().toString(36).slice(2, 6)}`,
    ownerUsername: caller.username,
    kind: body?.kind ?? 'ul',
    name: body?.name ?? '',
    inn: body?.inn ?? '',
    ogrn: body?.ogrn ?? '',
    kpp: body?.kpp ?? '',
    address: body?.address ?? '',
    phone: body?.phone ?? '',
    email: body?.email ?? '',
    notes: body?.notes ?? '',
    createdAt: now,
    updatedAt: now
  }
  db.organizations.unshift(o)
  logAudit(caller.username, 'org.create', o.id, JSON.stringify({ after: { name: o.name, inn: o.inn, kind: o.kind } }))
  return { status: 201, data: o }
}

function orgUpdateHandler(id, body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.organizations.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const o = db.organizations[idx]
  if (caller.role === 'user' && o.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  // На update проверяем «эффективный» payload (то, что реально запишем): для
  // отсутствующих полей берём из текущей записи, чтобы PATCH-style не падал
  // на name=undefined при частичном update'е.
  const effective = {
    kind: body?.kind ?? o.kind,
    name: body?.name ?? o.name,
    inn: body?.inn ?? o.inn,
    ogrn: body?.ogrn ?? o.ogrn,
    kpp: body?.kpp ?? o.kpp,
    address: body?.address ?? o.address,
    phone: body?.phone ?? o.phone,
    email: body?.email ?? o.email,
    notes: body?.notes ?? o.notes
  }
  const err = validateOrgPayload(effective)
  if (err) return { status: 422, data: { error: 'invalid_payload', message: err } }
  const merged = {
    ...o,
    kind: body?.kind ?? o.kind,
    name: body?.name ?? o.name,
    inn: body?.inn ?? o.inn,
    ogrn: body?.ogrn ?? o.ogrn,
    kpp: body?.kpp ?? o.kpp,
    address: body?.address ?? o.address,
    phone: body?.phone ?? o.phone,
    email: body?.email ?? o.email,
    notes: body?.notes ?? o.notes,
    updatedAt: Date.now()
  }
  db.organizations.splice(idx, 1, merged)
  logAuditDiff(caller.username, 'org.update', id, o, merged, ORG_DIFF_FIELDS)
  return { status: 200, data: merged }
}

function orgDeleteHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.organizations.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const o = db.organizations[idx]
  if (caller.role === 'user' && o.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  db.organizations.splice(idx, 1)
  // Снапшот удалённой организации в before — позволяет реконструировать факт.
  const snap = {}
  for (const f of ORG_DIFF_FIELDS) snap[f] = o[f]
  logAudit(caller.username, 'org.delete', id, JSON.stringify({ before: snap }))
  return { status: 200, data: { ok: true } }
}

// ---------- FNS proxy + inn-registry ----------

function fnsLookupHandler(body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const inns = Array.isArray(body?.inns) ? body.inns : []
  if (!inns.length) return { status: 400, data: { error: 'empty' } }
  if (inns.length > FNS_CHUNK_LIMIT) {
    return { status: 413, data: { error: 'chunk_too_large', limit: FNS_CHUNK_LIMIT } }
  }
  const items = inns.map((inn) => {
    const r = fnsLookup(inn)
    if (r.ok) return { inn, status: 'done', data: r.data }
    return { inn, status: 'error', error: r.error }
  })
  return { status: 200, data: { items } }
}

function innListHandler({ search = '', page = 1, pageSize = 100 }, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const p = Number(page) || 1
  // ИНН-реестр исторически разрешает page=500 (bulk-импорт справочников).
  const ps = clampPageSize(pageSize, 100, 500)
  const q = String(search || '').trim().toLowerCase()
  let items = db.innRegistry.filter((x) => x.ownerUsername === caller.username)
  if (q) {
    items = items.filter(
      (x) => x.inn.includes(q) || (x.data?.orgName ?? '').toLowerCase().includes(q)
    )
  }
  const total = items.length
  const start = (p - 1) * ps
  return { status: 200, data: { items: items.slice(start, start + ps), total } }
}

function innBulkUpsertHandler(body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const incoming = Array.isArray(body?.items) ? body.items : []
  if (!incoming.length) return { status: 400, data: { error: 'empty' } }
  if (incoming.length > INN_BULK_LIMIT) {
    return { status: 413, data: { error: 'chunk_too_large', limit: INN_BULK_LIMIT } }
  }
  const now = Date.now()
  const saved = []
  for (const item of incoming) {
    const inn = String(item.inn ?? '').trim()
    if (!inn) continue
    const existingIdx = db.innRegistry.findIndex(
      (x) => x.ownerUsername === caller.username && x.inn === inn
    )
    const record = {
      id: existingIdx >= 0 ? db.innRegistry[existingIdx].id : `inn-${nextDbId()}`,
      ownerUsername: caller.username,
      inn,
      status: item.status ?? 'done',
      data: item.data ?? null,
      error: item.error ?? null,
      createdAt: existingIdx >= 0 ? db.innRegistry[existingIdx].createdAt : now,
      updatedAt: now
    }
    if (existingIdx >= 0) db.innRegistry.splice(existingIdx, 1, record)
    else db.innRegistry.push(record)
    saved.push(record)
  }
  return { status: 200, data: { items: saved } }
}

function innDeleteHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.innRegistry.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  if (db.innRegistry[idx].ownerUsername !== caller.username && caller.role === 'user')
    return { status: 403, data: { error: 'forbidden' } }
  db.innRegistry.splice(idx, 1)
  return { status: 200, data: { ok: true } }
}

function innClearHandler(caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  db.innRegistry = db.innRegistry.filter((x) => x.ownerUsername !== caller.username)
  return { status: 200, data: { ok: true } }
}

// ---------- equipment ----------

function equipmentListHandler(
  { page = 1, pageSize = 20, search = '', organizationId = '', infoSystemId = '', status = '' },
  caller
) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const p = Number(page) || 1
  const ps = clampPageSize(pageSize, 20)
  const q = String(search || '').trim().toLowerCase()

  let items = db.equipment
  if (caller.role === 'user') items = items.filter((e) => e.ownerUsername === caller.username)
  if (organizationId) items = items.filter((e) => e.organizationId === organizationId)
  if (infoSystemId === 'none') items = items.filter((e) => !e.infoSystemId)
  else if (infoSystemId) items = items.filter((e) => e.infoSystemId === infoSystemId)
  if (status) items = items.filter((e) => e.status === status)
  if (q) items = items.filter((e) => equipmentSearchBlobOf(e).includes(q))

  const total = items.length
  const start = (p - 1) * ps
  const slice = items.slice(start, start + ps)
  return { status: 200, data: { items: slice, total } }
}

function equipmentGetHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const e = db.equipment.find((x) => x.id === id)
  if (!e) return { status: 404, data: { error: 'not_found' } }
  if (caller.role === 'user' && e.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  return { status: 200, data: e }
}

function equipmentCreateHandler(body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  if (caller.role === 'expert') return { status: 403, data: { error: 'forbidden' } }
  const orgId = body?.organizationId
  if (!orgId) return { status: 400, data: { error: 'organizationId_required' } }
  const org = db.organizations.find((o) => o.id === orgId)
  if (!org) return { status: 404, data: { error: 'organization_not_found' } }
  if (caller.role === 'user' && org.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden_org' } }

  const isId = body?.infoSystemId || ''
  if (isId) {
    const is = db.infoSystems.find((i) => i.id === isId)
    if (!is) return { status: 404, data: { error: 'info_system_not_found' } }
    if (is.organizationId !== orgId)
      return { status: 400, data: { error: 'info_system_org_mismatch' } }
  }

  const now = Date.now()
  const e = {
    id: `eq-${now}-${Math.random().toString(36).slice(2, 6)}`,
    ownerUsername: caller.username,
    organizationId: orgId,
    infoSystemId: isId,
    name: String(body?.name ?? '').trim(),
    kind: body?.kind ?? 'other',
    model: body?.model ?? '',
    manufacturer: body?.manufacturer ?? '',
    serial: body?.serial ?? '',
    inventoryNumber: body?.inventoryNumber ?? '',
    yearMade: body?.yearMade ? Number(body.yearMade) : null,
    location: body?.location ?? '',
    status: body?.status ?? 'active',
    notes: body?.notes ?? '',
    createdAt: now,
    updatedAt: now
  }
  if (!e.name) return { status: 400, data: { error: 'name_required' } }
  db.equipment.unshift(e)
  return { status: 201, data: e }
}

function equipmentUpdateHandler(id, body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.equipment.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const e = db.equipment[idx]
  if (caller.role === 'user' && e.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  let nextInfoSystemId = e.infoSystemId
  if (body?.infoSystemId !== undefined) {
    const v = body.infoSystemId || ''
    if (v) {
      const is = db.infoSystems.find((i) => i.id === v)
      if (!is) return { status: 404, data: { error: 'info_system_not_found' } }
      if (is.organizationId !== e.organizationId)
        return { status: 400, data: { error: 'info_system_org_mismatch' } }
    }
    nextInfoSystemId = v
  }

  const merged = {
    ...e,
    infoSystemId: nextInfoSystemId,
    name: body?.name ?? e.name,
    kind: body?.kind ?? e.kind,
    model: body?.model ?? e.model,
    manufacturer: body?.manufacturer ?? e.manufacturer,
    serial: body?.serial ?? e.serial,
    inventoryNumber: body?.inventoryNumber ?? e.inventoryNumber,
    yearMade: body?.yearMade !== undefined ? (body.yearMade ? Number(body.yearMade) : null) : e.yearMade,
    location: body?.location ?? e.location,
    status: body?.status ?? e.status,
    notes: body?.notes ?? e.notes,
    updatedAt: Date.now()
  }
  db.equipment.splice(idx, 1, merged)
  return { status: 200, data: merged }
}

function equipmentDeleteHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.equipment.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const e = db.equipment[idx]
  if (caller.role === 'user' && e.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  db.equipment.splice(idx, 1)
  return { status: 200, data: { ok: true } }
}

// ---------- documents (registry) ----------

function docListHandler(
  { page = 1, pageSize = 20, search = '', organizationId = '', status = '', mine = '' },
  caller
) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const p = Number(page) || 1
  const ps = clampPageSize(pageSize, 20)
  const q = String(search || '').trim().toLowerCase()

  let items = db.documents
  if (caller.role === 'user') items = items.filter((d) => d.ownerUsername === caller.username)
  else if (mine === '1') items = items.filter((d) => d.ownerUsername === caller.username)

  if (organizationId) items = items.filter((d) => d.organizationId === organizationId)
  if (status) items = items.filter((d) => d.status === status)
  if (q) {
    items = items.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        (d.number ?? '').toLowerCase().includes(q) ||
        (d.content ?? '').toLowerCase().includes(q)
    )
  }
  items = [...items].sort((a, b) => b.updatedAt - a.updatedAt)

  const total = items.length
  const start = (p - 1) * ps
  return { status: 200, data: { items: items.slice(start, start + ps), total } }
}

function docGetHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const d = db.documents.find((x) => x.id === id)
  if (!d) return { status: 404, data: { error: 'not_found' } }
  if (caller.role === 'user' && d.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  return { status: 200, data: d }
}

function docCreateHandler(body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  if (caller.role === 'expert') return { status: 403, data: { error: 'forbidden' } }
  const orgId = body?.organizationId
  if (!orgId) return { status: 400, data: { error: 'organizationId_required' } }
  const org = db.organizations.find((o) => o.id === orgId)
  if (!org) return { status: 404, data: { error: 'organization_not_found' } }
  if (caller.role === 'user' && org.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden_org' } }
  if (!body?.title?.trim()) return { status: 400, data: { error: 'title_required' } }

  const now = Date.now()
  const d = {
    id: `doc-${now}-${Math.random().toString(36).slice(2, 6)}`,
    ownerUsername: caller.username,
    organizationId: orgId,
    equipmentId: body?.equipmentId || '',
    title: String(body.title).trim(),
    type: body?.type ?? 'act',
    number: body?.number ?? '',
    date: body?.date ?? '',
    content: body?.content ?? '',
    status: 'draft',
    reviewedBy: '',
    reviewedAt: null,
    reviewComment: '',
    createdAt: now,
    updatedAt: now
  }
  db.documents.unshift(d)
  return { status: 201, data: d }
}

function docUpdateHandler(id, body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.documents.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const d = db.documents[idx]
  if (caller.role === 'user' && d.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  if (!['draft', 'rejected'].includes(d.status))
    return { status: 409, data: { error: 'wrong_status', current: d.status } }

  const merged = {
    ...d,
    title: body?.title ?? d.title,
    type: body?.type ?? d.type,
    number: body?.number ?? d.number,
    date: body?.date ?? d.date,
    content: body?.content ?? d.content,
    equipmentId: body?.equipmentId !== undefined ? body.equipmentId : d.equipmentId,
    updatedAt: Date.now()
  }
  db.documents.splice(idx, 1, merged)
  return { status: 200, data: merged }
}

function docDeleteHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.documents.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const d = db.documents[idx]
  if (caller.role === 'user' && d.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  if (d.status === 'approved' && caller.role !== 'admin')
    return { status: 409, data: { error: 'approved_protected' } }
  db.documents.splice(idx, 1)
  return { status: 200, data: { ok: true } }
}

function docActionHandler(id, action, body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.documents.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const d = db.documents[idx]
  const now = Date.now()

  if (action === 'submit') {
    if (caller.role === 'user' && d.ownerUsername !== caller.username)
      return { status: 403, data: { error: 'forbidden' } }
    if (!['draft', 'rejected'].includes(d.status))
      return { status: 409, data: { error: 'wrong_status', current: d.status } }
    const merged = { ...d, status: 'pending', updatedAt: now }
    db.documents.splice(idx, 1, merged)
    return { status: 200, data: merged }
  }

  if (action === 'approve' || action === 'reject') {
    if (!['expert', 'admin'].includes(caller.role))
      return { status: 403, data: { error: 'forbidden' } }
    if (d.status !== 'pending')
      return { status: 409, data: { error: 'wrong_status', current: d.status } }
    const comment = String(body?.comment ?? '').trim()
    if (action === 'reject' && !comment)
      return { status: 400, data: { error: 'comment_required' } }
    const merged = {
      ...d,
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewedBy: caller.username,
      reviewedAt: now,
      reviewComment: comment,
      updatedAt: now
    }
    db.documents.splice(idx, 1, merged)
    return { status: 200, data: merged }
  }

  return { status: 400, data: { error: 'unknown_action' } }
}

function countByStatus(docs) {
  const out = { draft: 0, pending: 0, approved: 0, rejected: 0 }
  for (const d of docs) {
    if (out[d.status] !== undefined) out[d.status] += 1
  }
  return out
}

// ---------- admin: users ----------

const ADMIN_ROLES = ['admin', 'expert', 'user']

function requireAdmin(caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  if (caller.role !== 'admin') return { status: 403, data: { error: 'forbidden' } }
  return null
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    verified: u.verified,
    blocked: u.blocked,
    createdAt: u.createdAt
  }
}

// Жёсткий потолок размера audit-лога. Срабатывает at insert time — гарантирует,
// что даже без maintenance-tick'а лог не растёт за горизонт. Дополнительно
// maintenance-tick подрезает по возрасту (см. cleanupAudit). 10k записей —
// потолок «свежего», глубже хранится в файловых бэкапах.
const AUDIT_HARD_CAP = 10_000

function logAudit(actor, action, target, details = '', ip = '') {
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
function logAuditDiff(actor, action, target, before, after, fields) {
  const diff = diffFields(before, after, fields)
  if (Object.keys(diff.before).length === 0) return
  logAudit(actor, action, target, JSON.stringify(diff))
}

// Поля организации, которые попадают в diff. password/createdAt/updatedAt
// логировать не имеет смысла.
const ORG_DIFF_FIELDS = ['kind', 'name', 'inn', 'ogrn', 'kpp', 'address', 'phone', 'email', 'notes']
// Пользовательские поля для diff'а. Сам password не логируем — только сам
// факт смены через `user.password` action.
const USER_DIFF_FIELDS = ['role', 'verified', 'blocked', 'email']

function adminUserListHandler({ page = 1, pageSize = 20, search = '', role = '' }, caller) {
  const guard = requireAdmin(caller)
  if (guard) return guard
  const p = Number(page) || 1
  const ps = clampPageSize(pageSize, 20)
  const q = String(search || '').trim().toLowerCase()

  let items = db.users
  if (role) items = items.filter((u) => u.role === role)
  if (q) {
    items = items.filter(
      (u) => u.username.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q)
    )
  }
  items = [...items].sort((a, b) => b.createdAt - a.createdAt)
  const total = items.length
  const start = (p - 1) * ps
  return {
    status: 200,
    data: { items: items.slice(start, start + ps).map(publicUser), total }
  }
}

function adminUserDeleteHandler(username, caller) {
  const guard = requireAdmin(caller)
  if (guard) return guard
  if (username === caller.username)
    return { status: 409, data: { error: 'self_delete_forbidden' } }
  const idx = db.users.findIndex((x) => x.username === username)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const hasOrgs = db.organizations.some((o) => o.ownerUsername === username)
  const hasEq = db.equipment.some((e) => e.ownerUsername === username)
  const hasDocs = db.documents.some((d) => d.ownerUsername === username)
  if (hasOrgs || hasEq || hasDocs)
    return { status: 409, data: { error: 'has_dependencies' } }

  const deleted = db.users[idx]
  db.users.splice(idx, 1)
  revokeAllSessionsOf(username)
  // Снапшот без password, чтобы хеш не утёк в общий лог.
  const snap = { username: deleted.username, email: deleted.email, role: deleted.role, verified: deleted.verified, blocked: deleted.blocked }
  logAudit(caller.username, 'user.delete', username, JSON.stringify({ before: snap }))
  return { status: 200, data: { ok: true } }
}

async function adminUserActionHandler(username, action, body, caller) {
  const guard = requireAdmin(caller)
  if (guard) return guard
  const idx = db.users.findIndex((x) => x.username === username)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const u = db.users[idx]
  const isSelf = username === caller.username

  if (action === 'verify') {
    const verified = body?.verified !== undefined ? !!body.verified : true
    const updated = { ...u, verified }
    db.users.splice(idx, 1, updated)
    logAuditDiff(caller.username, 'user.verify', username, u, updated, USER_DIFF_FIELDS)
    return { status: 200, data: publicUser(db.users[idx]) }
  }

  if (action === 'block') {
    if (isSelf) return { status: 409, data: { error: 'self_block_forbidden' } }
    const blocked = body?.blocked !== undefined ? !!body.blocked : true
    const updated = { ...u, blocked }
    db.users.splice(idx, 1, updated)
    if (blocked) revokeAllSessionsOf(username)
    logAuditDiff(caller.username, 'user.block', username, u, updated, USER_DIFF_FIELDS)
    return { status: 200, data: publicUser(db.users[idx]) }
  }

  if (action === 'role') {
    if (isSelf) return { status: 409, data: { error: 'self_role_forbidden' } }
    const role = body?.role
    if (!ADMIN_ROLES.includes(role))
      return { status: 400, data: { error: 'invalid_role', allowed: ADMIN_ROLES } }
    const updated = { ...u, role }
    db.users.splice(idx, 1, updated)
    logAuditDiff(caller.username, 'user.role', username, u, updated, USER_DIFF_FIELDS)
    return { status: 200, data: publicUser(db.users[idx]) }
  }

  if (action === 'password') {
    const password = String(body?.password ?? '')
    const pwErr = validatePassword(password)
    if (pwErr) return { status: 400, data: { error: 'invalid_password', message: pwErr } }
    db.users.splice(idx, 1, { ...u, password: await pwHash(password) })
    revokeAllSessionsOf(username)
    logAudit(caller.username, 'user.password', username, 'пароль изменён')
    return { status: 200, data: publicUser(db.users[idx]) }
  }

  if (action === 'unlock') {
    // Сбрасывает счётчик неудачных попыток (per-account lockout). Не путать
    // с `block=false` — это разные слои: lockout — анти-bruteforce,
    // blocked — административный бан.
    const had = loginFailures.has(username)
    loginFailures.delete(username)
    logAudit(caller.username, 'user.unlock', username, had ? 'снят лок' : 'локаут не был активен')
    return { status: 200, data: { ok: true, wasLocked: had } }
  }

  return { status: 400, data: { error: 'unknown_action' } }
}

// ---------- dictionaries (КиберДок) ----------

function dictionaryHandler(name, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const dict = db.dictionaries[name]
  if (!Array.isArray(dict)) return { status: 404, data: { error: 'unknown_dictionary' } }
  return { status: 200, data: { items: dict, name, total: dict.length } }
}

// ---------- personal (сотрудники) ----------

const PERSONAL_BULK_LIMIT = 100

function personalListHandler(
  { page = 1, pageSize = 20, search = '', organizationId = '' },
  caller
) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const p = Number(page) || 1
  const ps = clampPageSize(pageSize, 20)
  const q = String(search || '').trim().toLowerCase()

  // Берём предсортированный кеш и фильтруем (filter сохраняет порядок) —
  // O(N) вместо O(N log N) на каждый запрос.
  let items = getSortedPersonal()
  if (caller.role === 'user') items = items.filter((x) => x.ownerUsername === caller.username)
  if (organizationId) items = items.filter((x) => x.organizationId === organizationId)
  if (q) {
    items = items.filter(
      (x) =>
        x.lastName.toLowerCase().includes(q) ||
        x.firstName.toLowerCase().includes(q) ||
        (x.middleName ?? '').toLowerCase().includes(q) ||
        (x.position ?? '').toLowerCase().includes(q) ||
        (x.email ?? '').toLowerCase().includes(q)
    )
  }
  const total = items.length
  const start = (p - 1) * ps
  return { status: 200, data: { items: items.slice(start, start + ps), total } }
}

function personalGetHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const x = db.personal.find((p) => p.id === id)
  if (!x) return { status: 404, data: { error: 'not_found' } }
  if (caller.role === 'user' && x.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  return { status: 200, data: x }
}

function personalCreateHandler(body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  if (caller.role === 'expert') return { status: 403, data: { error: 'forbidden' } }
  const orgId = body?.organizationId
  if (!orgId) return { status: 400, data: { error: 'organizationId_required' } }
  const org = db.organizations.find((o) => o.id === orgId)
  if (!org) return { status: 404, data: { error: 'organization_not_found' } }
  if (caller.role === 'user' && org.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden_org' } }
  if (!body?.lastName?.trim() || !body?.firstName?.trim())
    return { status: 400, data: { error: 'name_required' } }

  const now = Date.now()
  const x = {
    id: `pers-${now}-${Math.random().toString(36).slice(2, 6)}`,
    ownerUsername: caller.username,
    organizationId: orgId,
    lastName: String(body.lastName).trim(),
    firstName: String(body.firstName).trim(),
    middleName: String(body.middleName ?? '').trim(),
    position: String(body.position ?? '').trim(),
    department: String(body.department ?? '').trim(),
    phone: String(body.phone ?? '').trim(),
    email: String(body.email ?? '').trim(),
    hasAdminRights: !!body.hasAdminRights,
    notes: String(body.notes ?? '').trim(),
    createdAt: now,
    updatedAt: now
  }
  db.personal.unshift(x)
  bumpPersonal()
  return { status: 201, data: x }
}

function personalUpdateHandler(id, body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.personal.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const x = db.personal[idx]
  if (caller.role === 'user' && x.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  const merged = {
    ...x,
    lastName: body?.lastName !== undefined ? String(body.lastName).trim() : x.lastName,
    firstName: body?.firstName !== undefined ? String(body.firstName).trim() : x.firstName,
    middleName: body?.middleName !== undefined ? String(body.middleName).trim() : x.middleName,
    position: body?.position !== undefined ? String(body.position).trim() : x.position,
    department: body?.department !== undefined ? String(body.department).trim() : x.department,
    phone: body?.phone !== undefined ? String(body.phone).trim() : x.phone,
    email: body?.email !== undefined ? String(body.email).trim() : x.email,
    hasAdminRights:
      body?.hasAdminRights !== undefined ? !!body.hasAdminRights : x.hasAdminRights,
    notes: body?.notes !== undefined ? String(body.notes).trim() : x.notes,
    updatedAt: Date.now()
  }
  db.personal.splice(idx, 1, merged)
  bumpPersonal()
  return { status: 200, data: merged }
}

function personalDeleteHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.personal.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const x = db.personal[idx]
  if (caller.role === 'user' && x.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  db.personal.splice(idx, 1)
  bumpPersonal()
  return { status: 200, data: { ok: true } }
}

function personalBulkUpsertHandler(body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  if (caller.role === 'expert') return { status: 403, data: { error: 'forbidden' } }
  const orgId = body?.organizationId
  const incoming = Array.isArray(body?.items) ? body.items : []
  if (!orgId) return { status: 400, data: { error: 'organizationId_required' } }
  if (!incoming.length) return { status: 400, data: { error: 'empty' } }
  if (incoming.length > PERSONAL_BULK_LIMIT) {
    return { status: 413, data: { error: 'chunk_too_large', limit: PERSONAL_BULK_LIMIT } }
  }
  const org = db.organizations.find((o) => o.id === orgId)
  if (!org) return { status: 404, data: { error: 'organization_not_found' } }
  if (caller.role === 'user' && org.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden_org' } }

  const now = Date.now()
  const saved = []
  const errors = []
  for (const raw of incoming) {
    const lastName = String(raw?.lastName ?? '').trim()
    const firstName = String(raw?.firstName ?? '').trim()
    if (!lastName || !firstName) {
      errors.push({ row: raw, error: 'name_required' })
      continue
    }
    const key = (s) => String(s ?? '').trim().toLowerCase()
    const existIdx = db.personal.findIndex(
      (p) =>
        p.ownerUsername === caller.username &&
        p.organizationId === orgId &&
        key(p.lastName) === key(lastName) &&
        key(p.firstName) === key(firstName) &&
        key(p.middleName) === key(raw?.middleName) &&
        key(p.email) === key(raw?.email)
    )
    const record = {
      id: existIdx >= 0 ? db.personal[existIdx].id : `pers-${nextDbId()}-${Math.random().toString(36).slice(2, 6)}`,
      ownerUsername: caller.username,
      organizationId: orgId,
      lastName,
      firstName,
      middleName: String(raw?.middleName ?? '').trim(),
      position: String(raw?.position ?? '').trim(),
      department: String(raw?.department ?? '').trim(),
      phone: String(raw?.phone ?? '').trim(),
      email: String(raw?.email ?? '').trim(),
      hasAdminRights: !!raw?.hasAdminRights,
      notes: String(raw?.notes ?? '').trim(),
      createdAt: existIdx >= 0 ? db.personal[existIdx].createdAt : now,
      updatedAt: now
    }
    if (existIdx >= 0) db.personal.splice(existIdx, 1, record)
    else db.personal.push(record)
    saved.push(record)
  }
  if (saved.length) bumpPersonal()
  return { status: 200, data: { items: saved, errors } }
}

// ---------- info-systems ----------

function infoSystemListHandler(
  { page = 1, pageSize = 20, search = '', organizationId = '', typeId = '', status = '' },
  caller
) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const p = Number(page) || 1
  const ps = clampPageSize(pageSize, 20)
  const q = String(search || '').trim().toLowerCase()

  let items = db.infoSystems
  if (caller.role === 'user') items = items.filter((x) => x.ownerUsername === caller.username)
  if (organizationId) items = items.filter((x) => x.organizationId === organizationId)
  if (typeId) items = items.filter((x) => x.typeId === typeId)
  if (status) items = items.filter((x) => x.status === status)
  if (q) {
    items = items.filter(
      (x) =>
        x.name.toLowerCase().includes(q) ||
        (x.purpose ?? '').toLowerCase().includes(q) ||
        (x.classification ?? '').toLowerCase().includes(q)
    )
  }
  items = [...items].sort((a, b) => b.updatedAt - a.updatedAt)
  const total = items.length
  const start = (p - 1) * ps
  return { status: 200, data: { items: items.slice(start, start + ps), total } }
}

function infoSystemGetHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const x = db.infoSystems.find((i) => i.id === id)
  if (!x) return { status: 404, data: { error: 'not_found' } }
  if (caller.role === 'user' && x.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  return { status: 200, data: x }
}

function infoSystemCreateHandler(body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  if (caller.role === 'expert') return { status: 403, data: { error: 'forbidden' } }
  const orgId = body?.organizationId
  if (!orgId) return { status: 400, data: { error: 'organizationId_required' } }
  const org = db.organizations.find((o) => o.id === orgId)
  if (!org) return { status: 404, data: { error: 'organization_not_found' } }
  if (caller.role === 'user' && org.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden_org' } }
  if (!body?.name?.trim()) return { status: 400, data: { error: 'name_required' } }
  if (!body?.typeId) return { status: 400, data: { error: 'typeId_required' } }

  const now = Date.now()
  const x = {
    id: `is-${now}-${Math.random().toString(36).slice(2, 6)}`,
    ownerUsername: caller.username,
    organizationId: orgId,
    name: String(body.name).trim(),
    typeId: body.typeId,
    regimId: body?.regimId ?? '',
    strukId: body?.strukId ?? '',
    inetId: body?.inetId ?? '',
    codId: body?.codId ?? '',
    classification: String(body?.classification ?? '').trim(),
    purpose: String(body?.purpose ?? '').trim(),
    address: String(body?.address ?? '').trim(),
    operatorName: String(body?.operatorName ?? org.name ?? '').trim(),
    operatorInn: String(body?.operatorInn ?? org.inn ?? '').trim(),
    operatorOgrn: String(body?.operatorOgrn ?? org.ogrn ?? '').trim(),
    hasPdn: !!body?.hasPdn,
    pdnCategories: Array.isArray(body?.pdnCategories) ? body.pdnCategories : [],
    pdnSubjectsCount: Number(body?.pdnSubjectsCount) || 0,
    kiiCategory: String(body?.kiiCategory ?? '').trim(),
    gisLevel: String(body?.gisLevel ?? '').trim(),
    notes: String(body?.notes ?? '').trim(),
    status: body?.status ?? 'draft',
    createdAt: now,
    updatedAt: now
  }
  db.infoSystems.unshift(x)
  return { status: 201, data: x }
}

function infoSystemUpdateHandler(id, body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.infoSystems.findIndex((i) => i.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const x = db.infoSystems[idx]
  if (caller.role === 'user' && x.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  const merged = {
    ...x,
    name: body?.name !== undefined ? String(body.name).trim() : x.name,
    typeId: body?.typeId ?? x.typeId,
    regimId: body?.regimId !== undefined ? body.regimId : x.regimId,
    strukId: body?.strukId !== undefined ? body.strukId : x.strukId,
    inetId: body?.inetId !== undefined ? body.inetId : x.inetId,
    codId: body?.codId !== undefined ? body.codId : x.codId,
    classification:
      body?.classification !== undefined ? String(body.classification).trim() : x.classification,
    purpose: body?.purpose !== undefined ? String(body.purpose).trim() : x.purpose,
    address: body?.address !== undefined ? String(body.address).trim() : x.address,
    operatorName:
      body?.operatorName !== undefined ? String(body.operatorName).trim() : x.operatorName,
    operatorInn:
      body?.operatorInn !== undefined ? String(body.operatorInn).trim() : x.operatorInn,
    operatorOgrn:
      body?.operatorOgrn !== undefined ? String(body.operatorOgrn).trim() : x.operatorOgrn,
    hasPdn: body?.hasPdn !== undefined ? !!body.hasPdn : x.hasPdn,
    pdnCategories: Array.isArray(body?.pdnCategories) ? body.pdnCategories : x.pdnCategories,
    pdnSubjectsCount:
      body?.pdnSubjectsCount !== undefined ? Number(body.pdnSubjectsCount) || 0 : x.pdnSubjectsCount,
    kiiCategory:
      body?.kiiCategory !== undefined ? String(body.kiiCategory).trim() : x.kiiCategory,
    gisLevel: body?.gisLevel !== undefined ? String(body.gisLevel).trim() : x.gisLevel,
    notes: body?.notes !== undefined ? String(body.notes).trim() : x.notes,
    status: body?.status ?? x.status,
    updatedAt: Date.now()
  }
  db.infoSystems.splice(idx, 1, merged)
  return { status: 200, data: merged }
}

function infoSystemDeleteHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.infoSystems.findIndex((i) => i.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const x = db.infoSystems[idx]
  if (caller.role === 'user' && x.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  db.infoSystems.splice(idx, 1)
  return { status: 200, data: { ok: true } }
}

// ---------- audit + statistics ----------

function auditListHandler(
  { page = 1, pageSize = 50, action = '', search = '', actor = '', dateFrom = '', dateTo = '' },
  caller
) {
  const guard = requireAdmin(caller)
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

function statisticsHandler(caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const isPriv = caller.role === 'admin' || caller.role === 'expert'
  const orgs = isPriv ? db.organizations : db.organizations.filter((o) => o.ownerUsername === caller.username)
  const docs = isPriv ? db.documents : db.documents.filter((d) => d.ownerUsername === caller.username)
  const eq = isPriv ? db.equipment : db.equipment.filter((e) => e.ownerUsername === caller.username)

  return {
    status: 200,
    data: {
      organizations: orgs.length,
      documents: docs.length,
      equipment: eq.length,
      documentsByStatus: countByStatus(docs),
      ...(caller.role === 'admin' ? { users: db.users.length } : {})
    }
  }
}

// ---------- software ----------

function softwareListHandler(
  {
    page = 1,
    pageSize = 20,
    search = '',
    organizationId = '',
    infoSystemId = '',
    category = '',
    kindId = ''
  },
  caller
) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const p = Number(page) || 1
  const ps = clampPageSize(pageSize, 20)
  const q = String(search || '').trim().toLowerCase()

  let items = db.software
  if (caller.role === 'user') items = items.filter((s) => s.ownerUsername === caller.username)
  if (organizationId) items = items.filter((s) => s.organizationId === organizationId)
  if (infoSystemId === 'none') items = items.filter((s) => !s.infoSystemId)
  else if (infoSystemId) items = items.filter((s) => s.infoSystemId === infoSystemId)
  if (category) items = items.filter((s) => s.category === category)
  if (kindId) items = items.filter((s) => s.kindId === kindId)
  if (q) {
    items = items.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.vendor ?? '').toLowerCase().includes(q) ||
        (s.version ?? '').toLowerCase().includes(q)
    )
  }
  const total = items.length
  const start = (p - 1) * ps
  return { status: 200, data: { items: items.slice(start, start + ps), total } }
}

function softwareGetHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const s = db.software.find((x) => x.id === id)
  if (!s) return { status: 404, data: { error: 'not_found' } }
  if (caller.role === 'user' && s.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  return { status: 200, data: s }
}

function softwareCreateHandler(body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  if (caller.role === 'expert') return { status: 403, data: { error: 'forbidden' } }
  const orgId = body?.organizationId
  if (!orgId) return { status: 400, data: { error: 'organizationId_required' } }
  const org = db.organizations.find((o) => o.id === orgId)
  if (!org) return { status: 404, data: { error: 'organization_not_found' } }
  if (caller.role === 'user' && org.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden_org' } }

  const isId = body?.infoSystemId || ''
  if (isId) {
    const is = db.infoSystems.find((i) => i.id === isId)
    if (!is) return { status: 404, data: { error: 'info_system_not_found' } }
    if (is.organizationId !== orgId)
      return { status: 400, data: { error: 'info_system_org_mismatch' } }
  }
  const cat = body?.category === 'application' ? 'application' : 'system'

  const now = Date.now()
  const s = {
    id: `sw-${now}-${Math.random().toString(36).slice(2, 6)}`,
    ownerUsername: caller.username,
    organizationId: orgId,
    infoSystemId: isId,
    category: cat,
    kindId: body?.kindId ?? '',
    name: String(body?.name ?? '').trim(),
    version: body?.version ?? '',
    vendor: body?.vendor ?? '',
    licenseType: body?.licenseType ?? 'commercial',
    licenseInfo: body?.licenseInfo ?? '',
    installPath: body?.installPath ?? '',
    notes: body?.notes ?? '',
    createdAt: now,
    updatedAt: now
  }
  if (!s.name) return { status: 400, data: { error: 'name_required' } }
  db.software.unshift(s)
  return { status: 201, data: s }
}

function softwareUpdateHandler(id, body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.software.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const s = db.software[idx]
  if (caller.role === 'user' && s.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  let nextInfoSystemId = s.infoSystemId
  if (body?.infoSystemId !== undefined) {
    const v = body.infoSystemId || ''
    if (v) {
      const is = db.infoSystems.find((i) => i.id === v)
      if (!is) return { status: 404, data: { error: 'info_system_not_found' } }
      if (is.organizationId !== s.organizationId)
        return { status: 400, data: { error: 'info_system_org_mismatch' } }
    }
    nextInfoSystemId = v
  }
  const merged = {
    ...s,
    infoSystemId: nextInfoSystemId,
    category:
      body?.category === 'application' || body?.category === 'system'
        ? body.category
        : s.category,
    kindId: body?.kindId ?? s.kindId,
    name: body?.name ?? s.name,
    version: body?.version ?? s.version,
    vendor: body?.vendor ?? s.vendor,
    licenseType: body?.licenseType ?? s.licenseType,
    licenseInfo: body?.licenseInfo ?? s.licenseInfo,
    installPath: body?.installPath ?? s.installPath,
    notes: body?.notes ?? s.notes,
    updatedAt: Date.now()
  }
  db.software.splice(idx, 1, merged)
  return { status: 200, data: merged }
}

function softwareDeleteHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.software.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const s = db.software[idx]
  if (caller.role === 'user' && s.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  db.software.splice(idx, 1)
  return { status: 200, data: { ok: true } }
}

// ---------- security-tools-catalog ----------

function stCatalogListHandler(
  { page = 1, pageSize = 50, search = '', kindId = '' },
  caller
) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const p = Number(page) || 1
  const ps = clampPageSize(pageSize, 50)
  const q = String(search || '').trim().toLowerCase()

  let items = db.securityToolsCatalog
  if (kindId) items = items.filter((c) => c.kindId === kindId)
  if (q) {
    items = items.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.vendor ?? '').toLowerCase().includes(q) ||
        (c.certNumber ?? '').toLowerCase().includes(q)
    )
  }
  items = [...items].sort((a, b) => cmpRu(a.name, b.name))

  const total = items.length
  const start = (p - 1) * ps
  return { status: 200, data: { items: items.slice(start, start + ps), total } }
}

function stCatalogGetHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const c = db.securityToolsCatalog.find((x) => x.id === id)
  if (!c) return { status: 404, data: { error: 'not_found' } }
  return { status: 200, data: c }
}

function stCatalogCreateHandler(body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  if (caller.role !== 'admin') return { status: 403, data: { error: 'admin_only' } }
  if (!body?.name?.trim()) return { status: 400, data: { error: 'name_required' } }

  const now = Date.now()
  const c = {
    id: `stc-${now}-${Math.random().toString(36).slice(2, 6)}`,
    kindId: body?.kindId ?? '',
    name: String(body.name).trim(),
    vendor: body?.vendor ?? '',
    certNumber: body?.certNumber ?? '',
    certClass: body?.certClass ?? '',
    certDate: body?.certDate ?? '',
    certExpiry: body?.certExpiry ?? '',
    description: body?.description ?? '',
    createdAt: now,
    updatedAt: now
  }
  db.securityToolsCatalog.unshift(c)
  return { status: 201, data: c }
}

function stCatalogUpdateHandler(id, body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  if (caller.role !== 'admin') return { status: 403, data: { error: 'admin_only' } }
  const idx = db.securityToolsCatalog.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const c = db.securityToolsCatalog[idx]
  const merged = {
    ...c,
    kindId: body?.kindId ?? c.kindId,
    name: body?.name ?? c.name,
    vendor: body?.vendor ?? c.vendor,
    certNumber: body?.certNumber ?? c.certNumber,
    certClass: body?.certClass ?? c.certClass,
    certDate: body?.certDate ?? c.certDate,
    certExpiry: body?.certExpiry ?? c.certExpiry,
    description: body?.description ?? c.description,
    updatedAt: Date.now()
  }
  db.securityToolsCatalog.splice(idx, 1, merged)
  return { status: 200, data: merged }
}

function stCatalogDeleteHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  if (caller.role !== 'admin') return { status: 403, data: { error: 'admin_only' } }
  const used = db.securityTools.some((s) => s.catalogId === id)
  if (used) return { status: 409, data: { error: 'catalog_in_use' } }
  const idx = db.securityToolsCatalog.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  db.securityToolsCatalog.splice(idx, 1)
  return { status: 200, data: { ok: true } }
}

// ---------- security-tools (instances) ----------

function stListHandler(
  {
    page = 1,
    pageSize = 20,
    search = '',
    organizationId = '',
    infoSystemId = '',
    status = '',
    kindId = ''
  },
  caller
) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const p = Number(page) || 1
  const ps = clampPageSize(pageSize, 20)
  const q = String(search || '').trim().toLowerCase()

  const catalogIndex = new Map(db.securityToolsCatalog.map((c) => [c.id, c]))
  const needsCatalogFilter = kindId || q

  let items = db.securityTools
  if (caller.role === 'user') items = items.filter((s) => s.ownerUsername === caller.username)
  if (organizationId) items = items.filter((s) => s.organizationId === organizationId)
  if (infoSystemId === 'none') items = items.filter((s) => !s.infoSystemId)
  else if (infoSystemId) items = items.filter((s) => s.infoSystemId === infoSystemId)
  if (status) items = items.filter((s) => s.status === status)

  if (needsCatalogFilter) {
    items = items.filter((s) => {
      const c = catalogIndex.get(s.catalogId)
      const cn = (c?.name ?? '').toLowerCase()
      if (kindId && c?.kindId !== kindId) return false
      if (q) {
        if (
          !cn.includes(q) &&
          !(s.serialNumber ?? '').toLowerCase().includes(q) &&
          !(s.licenseKey ?? '').toLowerCase().includes(q)
        )
          return false
      }
      return true
    })
  }

  const total = items.length
  const start = (p - 1) * ps
  const page1 = items.slice(start, start + ps).map((s) => {
    const c = catalogIndex.get(s.catalogId)
    return {
      ...s,
      catalogName: c?.name ?? '',
      catalogVendor: c?.vendor ?? '',
      catalogKindId: c?.kindId ?? ''
    }
  })
  return { status: 200, data: { items: page1, total } }
}

function stGetHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const s = db.securityTools.find((x) => x.id === id)
  if (!s) return { status: 404, data: { error: 'not_found' } }
  if (caller.role === 'user' && s.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  const c = db.securityToolsCatalog.find((x) => x.id === s.catalogId) ?? null
  return { status: 200, data: { ...s, catalog: c } }
}

function stCreateHandler(body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  if (caller.role === 'expert') return { status: 403, data: { error: 'forbidden' } }
  const orgId = body?.organizationId
  if (!orgId) return { status: 400, data: { error: 'organizationId_required' } }
  const org = db.organizations.find((o) => o.id === orgId)
  if (!org) return { status: 404, data: { error: 'organization_not_found' } }
  if (caller.role === 'user' && org.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden_org' } }

  const catalogId = body?.catalogId
  if (!catalogId) return { status: 400, data: { error: 'catalogId_required' } }
  const c = db.securityToolsCatalog.find((x) => x.id === catalogId)
  if (!c) return { status: 404, data: { error: 'catalog_not_found' } }

  const isId = body?.infoSystemId || ''
  if (isId) {
    const is = db.infoSystems.find((i) => i.id === isId)
    if (!is) return { status: 404, data: { error: 'info_system_not_found' } }
    if (is.organizationId !== orgId)
      return { status: 400, data: { error: 'info_system_org_mismatch' } }
  }

  const now = Date.now()
  const s = {
    id: `st-${now}-${Math.random().toString(36).slice(2, 6)}`,
    ownerUsername: caller.username,
    organizationId: orgId,
    infoSystemId: isId,
    catalogId,
    serialNumber: body?.serialNumber ?? '',
    licenseKey: body?.licenseKey ?? '',
    licenseExpiresAt: body?.licenseExpiresAt ?? '',
    deployedAt: body?.deployedAt ?? '',
    status: body?.status ?? 'active',
    responsiblePersonId: body?.responsiblePersonId ?? '',
    notes: body?.notes ?? '',
    createdAt: now,
    updatedAt: now
  }
  db.securityTools.unshift(s)
  return { status: 201, data: s }
}

function stUpdateHandler(id, body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.securityTools.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const s = db.securityTools[idx]
  if (caller.role === 'user' && s.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }

  let nextInfoSystemId = s.infoSystemId
  if (body?.infoSystemId !== undefined) {
    const v = body.infoSystemId || ''
    if (v) {
      const is = db.infoSystems.find((i) => i.id === v)
      if (!is) return { status: 404, data: { error: 'info_system_not_found' } }
      if (is.organizationId !== s.organizationId)
        return { status: 400, data: { error: 'info_system_org_mismatch' } }
    }
    nextInfoSystemId = v
  }
  let nextCatalogId = s.catalogId
  if (body?.catalogId !== undefined && body.catalogId !== s.catalogId) {
    const c = db.securityToolsCatalog.find((x) => x.id === body.catalogId)
    if (!c) return { status: 404, data: { error: 'catalog_not_found' } }
    nextCatalogId = body.catalogId
  }

  const merged = {
    ...s,
    infoSystemId: nextInfoSystemId,
    catalogId: nextCatalogId,
    serialNumber: body?.serialNumber ?? s.serialNumber,
    licenseKey: body?.licenseKey ?? s.licenseKey,
    licenseExpiresAt: body?.licenseExpiresAt ?? s.licenseExpiresAt,
    deployedAt: body?.deployedAt ?? s.deployedAt,
    status: body?.status ?? s.status,
    responsiblePersonId: body?.responsiblePersonId ?? s.responsiblePersonId,
    notes: body?.notes ?? s.notes,
    updatedAt: Date.now()
  }
  db.securityTools.splice(idx, 1, merged)
  return { status: 200, data: merged }
}

function stDeleteHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.securityTools.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const s = db.securityTools[idx]
  if (caller.role === 'user' && s.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  db.securityTools.splice(idx, 1)
  return { status: 200, data: { ok: true } }
}

// ---------- document-set templates ----------

function dsTemplateListHandler(caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const items = [...db.documentSetTemplates].sort((a, b) =>
    a.name.localeCompare(b.name, 'ru')
  )
  return { status: 200, data: { items, total: items.length } }
}

function dsTemplateGetHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const t = db.documentSetTemplates.find((x) => x.id === id)
  if (!t) return { status: 404, data: { error: 'not_found' } }
  return { status: 200, data: t }
}

// ---------- document-sets (история генераций) ----------

function dsListHandler(
  { page = 1, pageSize = 20, organizationId = '', infoSystemId = '', templateId = '' },
  caller
) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const p = Number(page) || 1
  const ps = clampPageSize(pageSize, 20)

  let items = db.documentSets
  if (caller.role === 'user') items = items.filter((d) => d.ownerUsername === caller.username)
  if (organizationId) items = items.filter((d) => d.organizationId === organizationId)
  if (infoSystemId === 'none') items = items.filter((d) => !d.infoSystemId)
  else if (infoSystemId) items = items.filter((d) => d.infoSystemId === infoSystemId)
  if (templateId) items = items.filter((d) => d.templateId === templateId)

  const tplIndex = new Map(db.documentSetTemplates.map((t) => [t.id, t]))
  const orgIndex = new Map(db.organizations.map((o) => [o.id, o]))
  const isIndex = new Map(db.infoSystems.map((i) => [i.id, i]))
  const enriched = items.map((d) => ({
    ...d,
    templateName: tplIndex.get(d.templateId)?.name ?? '',
    organizationName: orgIndex.get(d.organizationId)?.name ?? '',
    infoSystemName: d.infoSystemId ? isIndex.get(d.infoSystemId)?.name ?? '' : ''
  }))
  enriched.sort((a, b) => b.generatedAt - a.generatedAt)

  const total = enriched.length
  const start = (p - 1) * ps
  return { status: 200, data: { items: enriched.slice(start, start + ps), total } }
}

function dsGetHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const d = db.documentSets.find((x) => x.id === id)
  if (!d) return { status: 404, data: { error: 'not_found' } }
  if (caller.role === 'user' && d.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  return { status: 200, data: d }
}

function dsCreateHandler(body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  if (caller.role === 'expert') return { status: 403, data: { error: 'forbidden' } }

  const orgId = body?.organizationId
  if (!orgId) return { status: 400, data: { error: 'organizationId_required' } }
  const org = db.organizations.find((o) => o.id === orgId)
  if (!org) return { status: 404, data: { error: 'organization_not_found' } }
  if (caller.role === 'user' && org.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden_org' } }

  const tplId = body?.templateId
  if (!tplId) return { status: 400, data: { error: 'templateId_required' } }
  const tpl = db.documentSetTemplates.find((t) => t.id === tplId)
  if (!tpl) return { status: 404, data: { error: 'template_not_found' } }

  let infoSystemId = ''
  if (tpl.requiresIs) {
    infoSystemId = body?.infoSystemId || ''
    if (!infoSystemId) return { status: 400, data: { error: 'info_system_required' } }
    const is = db.infoSystems.find((i) => i.id === infoSystemId)
    if (!is) return { status: 404, data: { error: 'info_system_not_found' } }
    if (is.organizationId !== orgId)
      return { status: 400, data: { error: 'info_system_org_mismatch' } }
  }

  const now = Date.now()
  const d = {
    id: `ds-${now}-${Math.random().toString(36).slice(2, 6)}`,
    ownerUsername: caller.username,
    organizationId: orgId,
    infoSystemId,
    templateId: tplId,
    filename: String(body?.filename ?? '').trim() || 'ОРД.docx',
    sectionsCount: Number(body?.sectionsCount) || tpl.sections.length,
    generatedAt: now
  }
  db.documentSets.unshift(d)
  return {
    status: 201,
    data: {
      ...d,
      templateName: tpl.name,
      organizationName: org.name,
      infoSystemName: infoSystemId
        ? db.infoSystems.find((i) => i.id === infoSystemId)?.name ?? ''
        : ''
    }
  }
}

function dsDeleteHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.documentSets.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const d = db.documentSets[idx]
  if (caller.role === 'user' && d.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  db.documentSets.splice(idx, 1)
  return { status: 200, data: { ok: true } }
}

// ---------- threats catalog (БДУ ФСТЭК — имитация) ----------

function threatsCatalogListHandler({ category = '', search = '' }, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const q = String(search || '').trim().toLowerCase()
  let items = db.threatsCatalog
  if (category) items = items.filter((t) => t.category === category)
  if (q) {
    items = items.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q)
    )
  }
  items = [...items].sort((a, b) => a.code.localeCompare(b.code))
  return { status: 200, data: { items, total: items.length } }
}

// ---------- threat models ----------

const RELEVANCE_MATRIX = {
  low: { low: false, medium: false, high: false },
  medium: { low: false, medium: true, high: true },
  high: { low: false, medium: true, high: true }
}

function isRelevant(probability, damage) {
  return RELEVANCE_MATRIX[probability]?.[damage] ?? false
}

function tmListHandler(
  { page = 1, pageSize = 20, organizationId = '', infoSystemId = '', status = '' },
  caller
) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const p = Number(page) || 1
  const ps = clampPageSize(pageSize, 20)

  let items = db.threatModels
  if (caller.role === 'user') items = items.filter((m) => m.ownerUsername === caller.username)
  if (organizationId) items = items.filter((m) => m.organizationId === organizationId)
  if (infoSystemId) items = items.filter((m) => m.infoSystemId === infoSystemId)
  if (status) items = items.filter((m) => m.status === status)

  if (items === db.threatModels) items = items.slice()
  items.sort((a, b) => b.updatedAt - a.updatedAt)

  const total = items.length
  const start = (p - 1) * ps
  const slice = items.slice(start, start + ps)

  const isIndex = new Map(db.infoSystems.map((i) => [i.id, i]))
  const orgIndex = new Map(db.organizations.map((o) => [o.id, o]))
  const enriched = slice.map((m) => ({
    ...m,
    infoSystemName: isIndex.get(m.infoSystemId)?.name ?? '',
    organizationName: orgIndex.get(m.organizationId)?.name ?? '',
    threatsCount: m.threats?.length ?? 0,
    relevantCount: (m.threats ?? []).filter((t) => t.isRelevant).length
  }))
  return { status: 200, data: { items: enriched, total } }
}

function tmGetHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const m = db.threatModels.find((x) => x.id === id)
  if (!m) return { status: 404, data: { error: 'not_found' } }
  if (caller.role === 'user' && m.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  const catIndex = new Map(db.threatsCatalog.map((c) => [c.id, c]))
  const is = db.infoSystems.find((i) => i.id === m.infoSystemId) ?? null
  const org = db.organizations.find((o) => o.id === m.organizationId) ?? null
  return {
    status: 200,
    data: {
      ...m,
      infoSystem: is,
      organization: org,
      threats: (m.threats ?? []).map((t) => ({ ...t, catalog: catIndex.get(t.catalogId) ?? null }))
    }
  }
}

function normalizeThreats(threats) {
  if (!Array.isArray(threats)) return []
  return threats.map((t) => {
    const probability = ['low', 'medium', 'high'].includes(t.probability)
      ? t.probability
      : 'medium'
    const damage = ['low', 'medium', 'high'].includes(t.damage) ? t.damage : 'medium'
    return {
      catalogId: String(t.catalogId ?? ''),
      probability,
      damage,
      isRelevant: typeof t.isRelevant === 'boolean' ? t.isRelevant : isRelevant(probability, damage),
      justification: String(t.justification ?? ''),
      mitigation: String(t.mitigation ?? '')
    }
  })
}

function tmCreateHandler(body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  if (caller.role === 'expert') return { status: 403, data: { error: 'forbidden' } }

  const isId = body?.infoSystemId
  if (!isId) return { status: 400, data: { error: 'infoSystemId_required' } }
  const is = db.infoSystems.find((i) => i.id === isId)
  if (!is) return { status: 404, data: { error: 'info_system_not_found' } }
  const org = db.organizations.find((o) => o.id === is.organizationId)
  if (!org) return { status: 404, data: { error: 'organization_not_found' } }
  if (caller.role === 'user' && org.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden_org' } }

  const now = Date.now()
  const m = {
    id: `tm-${now}-${Math.random().toString(36).slice(2, 6)}`,
    ownerUsername: caller.username,
    organizationId: org.id,
    infoSystemId: isId,
    name: String(body?.name ?? '').trim() || `Модель угроз ИС «${is.name}»`,
    status: body?.status === 'finalized' ? 'finalized' : 'draft',
    intruder: {
      type: body?.intruder?.type ?? 'external',
      potential: body?.intruder?.potential ?? 'basic',
      capabilities: Array.isArray(body?.intruder?.capabilities)
        ? body.intruder.capabilities
        : [],
      motivation: String(body?.intruder?.motivation ?? '')
    },
    threats: normalizeThreats(body?.threats),
    conclusion: String(body?.conclusion ?? ''),
    createdAt: now,
    updatedAt: now
  }
  db.threatModels.unshift(m)
  return { status: 201, data: m }
}

function tmUpdateHandler(id, body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.threatModels.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const m = db.threatModels[idx]
  if (caller.role === 'user' && m.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }

  const merged = {
    ...m,
    name: body?.name !== undefined ? String(body.name).trim() || m.name : m.name,
    status:
      body?.status === 'draft' || body?.status === 'finalized' ? body.status : m.status,
    intruder: body?.intruder
      ? {
          type: body.intruder.type ?? m.intruder.type,
          potential: body.intruder.potential ?? m.intruder.potential,
          capabilities: Array.isArray(body.intruder.capabilities)
            ? body.intruder.capabilities
            : m.intruder.capabilities,
          motivation:
            body.intruder.motivation !== undefined
              ? String(body.intruder.motivation)
              : m.intruder.motivation
        }
      : m.intruder,
    threats: body?.threats !== undefined ? normalizeThreats(body.threats) : m.threats,
    conclusion: body?.conclusion !== undefined ? String(body.conclusion) : m.conclusion,
    updatedAt: Date.now()
  }
  db.threatModels.splice(idx, 1, merged)
  return { status: 200, data: merged }
}

function tmDeleteHandler(id, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.threatModels.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const m = db.threatModels[idx]
  if (caller.role === 'user' && m.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
  db.threatModels.splice(idx, 1)
  return { status: 200, data: { ok: true } }
}

// ---------- utils ----------

function stripQuery(url) {
  const i = url.indexOf('?')
  return i < 0 ? url : url.slice(0, i)
}

function parseQuery(url) {
  const i = url.indexOf('?')
  if (i < 0) return {}
  const out = {}
  const params = new URLSearchParams(url.slice(i + 1))
  for (const [k, v] of params) out[k] = v
  return out
}

function getCaller(headers) {
  const auth = headers?.authorization
  if (!auth?.startsWith('Bearer ')) return null
  const payload = tokenVerifier(auth.slice(7))
  if (!payload?.sub) return null
  return { username: payload.sub, role: payload.role }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
