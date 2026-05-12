import { db, nextDbId } from './db.js'
import * as defaultSigner from './jwt-sign.js'
import * as defaultPassword from './password.js'
import { fnsLookup } from './fns.js'
import { parseJwt } from '../lib/jwt.js'

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
  if (method === 'POST' && path === '/auth/login') return loginHandler(body)
  if (method === 'POST' && path === '/auth/register') return registerHandler(body)
  if (method === 'POST' && path === '/auth/refresh') return refreshHandler(body)
  if (method === 'POST' && path === '/auth/logout') return logoutHandler(body)
  if (method === 'GET' && path === '/auth/me') return meHandler(headers)
  if (method === 'POST' && path === '/auth/password') return changePasswordHandler(body, getCaller(headers))

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
  const adminUserActionMatch = path.match(/^\/admin\/users\/([^/]+)\/(verify|block|role|password)$/)
  if (method === 'GET' && path === '/admin/users')
    return adminUserListHandler(parseQuery(url), getCaller(headers))
  if (method === 'POST' && adminUserActionMatch)
    return adminUserActionHandler(adminUserActionMatch[1], adminUserActionMatch[2], body, getCaller(headers))
  if (method === 'DELETE' && adminUserMatch)
    return adminUserDeleteHandler(adminUserMatch[1], getCaller(headers))

  // === Журнал действий и статистика =====================================
  if (method === 'GET' && path === '/audit')
    return auditListHandler(parseQuery(url), getCaller(headers))
  if (method === 'GET' && path === '/statistics')
    return statisticsHandler(getCaller(headers))

  return { status: 404, data: { error: `Mock: no handler for ${method} ${path}` } }
}

// ---------- handlers ----------

async function loginHandler(body) {
  const username = String(body?.username ?? '')
  const password = String(body?.password ?? '')
  const idx = db.users.findIndex((x) => x.username === username)
  if (idx < 0) return { status: 401, data: { error: 'Неверный логин или пароль' } }
  const u = db.users[idx]
  if (!(await pwVerify(password, u.password)))
    return { status: 401, data: { error: 'Неверный логин или пароль' } }
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
  db.refreshTokens.set(refreshToken, u.username)
  return { status: 200, data: { token, refreshToken } }
}

async function registerHandler(body) {
  if (!body?.username || !body?.password || !body?.email)
    return { status: 400, data: { error: 'Заполните все поля' } }
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
  return { status: 201, data: { ok: true } }
}

function refreshHandler(body) {
  const username = db.refreshTokens.get(body?.refreshToken)
  if (!username) return { status: 401, data: { error: 'invalid_refresh' } }
  const u = db.users.find((x) => x.username === username)
  if (!u) return { status: 401, data: { error: 'invalid_refresh' } }
  const token = makeAccessToken({
    username: u.username,
    role: u.role,
    verified: u.verified,
    blocked: u.blocked
  })
  const newRefresh = makeRefreshToken(u.username)
  db.refreshTokens.delete(body.refreshToken)
  db.refreshTokens.set(newRefresh, u.username)
  return { status: 200, data: { token, refreshToken: newRefresh } }
}

function logoutHandler(body) {
  if (body?.refreshToken) db.refreshTokens.delete(body.refreshToken)
  return { status: 200, data: { ok: true } }
}

function meHandler(headers) {
  const auth = headers?.authorization
  if (!auth?.startsWith('Bearer ')) return { status: 401, data: { error: 'no_token' } }
  const payload = parseJwt(auth.slice(7))
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

async function changePasswordHandler(body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const current = String(body?.currentPassword ?? '')
  const next = String(body?.newPassword ?? '')
  if (!current || !next) return { status: 400, data: { error: 'missing_fields' } }
  if (next.length < 6) return { status: 400, data: { error: 'password_too_short' } }
  if (next === current) return { status: 400, data: { error: 'password_same' } }
  const idx = db.users.findIndex((x) => x.username === caller.username)
  if (idx === -1) return { status: 404, data: { error: 'no_user' } }
  const u = db.users[idx]
  if (!(await pwVerify(current, u.password))) return { status: 400, data: { error: 'wrong_current' } }
  db.users.splice(idx, 1, { ...u, password: await pwHash(next) })
  return { status: 200, data: { ok: true } }
}

// ---------- organizations ----------

function orgListHandler({ page = 1, pageSize = 20, search = '' }, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const p = Number(page) || 1
  const ps = Number(pageSize) || 20
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
  return { status: 201, data: o }
}

function orgUpdateHandler(id, body, caller) {
  if (!caller) return { status: 401, data: { error: 'no_token' } }
  const idx = db.organizations.findIndex((x) => x.id === id)
  if (idx < 0) return { status: 404, data: { error: 'not_found' } }
  const o = db.organizations[idx]
  if (caller.role === 'user' && o.ownerUsername !== caller.username)
    return { status: 403, data: { error: 'forbidden' } }
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
  const ps = Math.min(Number(pageSize) || 100, 500)
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
  const ps = Number(pageSize) || 20
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
  const ps = Number(pageSize) || 20
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

function logAudit(actor, action, target, details = '') {
  db.audit.unshift({
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    actor,
    action,
    target,
    details,
    at: Date.now()
  })
  if (db.audit.length > 500) db.audit.length = 500
}

function adminUserListHandler({ page = 1, pageSize = 20, search = '', role = '' }, caller) {
  const guard = requireAdmin(caller)
  if (guard) return guard
  const p = Number(page) || 1
  const ps = Number(pageSize) || 20
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

  db.users.splice(idx, 1)
  for (const [tok, owner] of db.refreshTokens) {
    if (owner === username) db.refreshTokens.delete(tok)
  }
  logAudit(caller.username, 'user.delete', username)
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
    db.users.splice(idx, 1, { ...u, verified })
    logAudit(caller.username, 'user.verify', username, verified ? 'подтверждён' : 'снято подтверждение')
    return { status: 200, data: publicUser(db.users[idx]) }
  }

  if (action === 'block') {
    if (isSelf) return { status: 409, data: { error: 'self_block_forbidden' } }
    const blocked = body?.blocked !== undefined ? !!body.blocked : true
    db.users.splice(idx, 1, { ...u, blocked })
    if (blocked) {
      for (const [tok, owner] of db.refreshTokens) {
        if (owner === username) db.refreshTokens.delete(tok)
      }
    }
    logAudit(caller.username, 'user.block', username, blocked ? 'заблокирован' : 'разблокирован')
    return { status: 200, data: publicUser(db.users[idx]) }
  }

  if (action === 'role') {
    if (isSelf) return { status: 409, data: { error: 'self_role_forbidden' } }
    const role = body?.role
    if (!ADMIN_ROLES.includes(role))
      return { status: 400, data: { error: 'invalid_role', allowed: ADMIN_ROLES } }
    db.users.splice(idx, 1, { ...u, role })
    logAudit(caller.username, 'user.role', username, `→ ${role}`)
    return { status: 200, data: publicUser(db.users[idx]) }
  }

  if (action === 'password') {
    const password = String(body?.password ?? '')
    if (password.length < 6)
      return { status: 400, data: { error: 'password_too_short' } }
    db.users.splice(idx, 1, { ...u, password: await pwHash(password) })
    for (const [tok, owner] of db.refreshTokens) {
      if (owner === username) db.refreshTokens.delete(tok)
    }
    logAudit(caller.username, 'user.password', username, 'пароль изменён')
    return { status: 200, data: publicUser(db.users[idx]) }
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
  const ps = Number(pageSize) || 20
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
  const ps = Number(pageSize) || 20
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

function auditListHandler({ page = 1, pageSize = 50, action = '', search = '' }, caller) {
  const guard = requireAdmin(caller)
  if (guard) return guard
  const p = Number(page) || 1
  const ps = Number(pageSize) || 50
  const q = String(search || '').trim().toLowerCase()

  let items = db.audit
  if (action) items = items.filter((a) => a.action === action)
  if (q) {
    items = items.filter(
      (a) =>
        a.actor.toLowerCase().includes(q) ||
        a.target.toLowerCase().includes(q) ||
        (a.details ?? '').toLowerCase().includes(q)
    )
  }
  const total = items.length
  const start = (p - 1) * ps
  return { status: 200, data: { items: items.slice(start, start + ps), total } }
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
  const ps = Number(pageSize) || 20
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
  const ps = Number(pageSize) || 50
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
  const ps = Number(pageSize) || 20
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
  const ps = Number(pageSize) || 20

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
  const ps = Number(pageSize) || 20

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
  const payload = parseJwt(auth.slice(7))
  if (!payload?.sub) return null
  return { username: payload.sub, role: payload.role }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
