// ===========================================================================
// SQLite-персистенс через better-sqlite3. Это drop-in замена JSON-файла:
// сохраняем дампом таблиц при изменениях, но в SQLite, а не на диск целиком.
//
// Схема: одна таблица на каждый ключ `db` (users, organizations, ...).
// Колонки: `id TEXT PRIMARY KEY, data TEXT NOT NULL`. Сама сущность лежит
// в `data` как JSON. Это «минимальный» шаг — handlers.js по-прежнему работает
// с in-memory объектом, мы просто переезжаем с JSON-файла на SQLite.
//
// Когда захочется реальной схемы (типизированные колонки, индексы по полям,
// JOIN-ы между сущностями) — добавляйте новые таблицы и переводите конкретные
// handlers на SQL-запросы по одной. handlers.js трогать не обязательно для
// миграции — он использует абстрактный `db.users.filter(...)`, который можно
// заменить на view поверх SQL.
// ===========================================================================

import Database from 'better-sqlite3'
import { mkdirSync, existsSync, statSync, unlinkSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from '../src/mock/db.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(HERE, '..', 'data')
const DB_PATH = resolve(DATA_DIR, 'app.db')

const SAVE_KEYS = [
  'users',
  'organizations',
  'innRegistry',
  'personal',
  'infoSystems',
  'equipment',
  'software',
  'securityToolsCatalog',
  'securityTools',
  'threatsCatalog',
  'threatModels',
  'documentSets',
  'documents',
  'audit',
  'refreshTokenMeta'
]

mkdirSync(DATA_DIR, { recursive: true })
const sqlite = new Database(DB_PATH)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('synchronous = NORMAL')

for (const key of SAVE_KEYS) {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS "${key}" (id TEXT PRIMARY KEY, data TEXT NOT NULL)`
  )
}

// ---------- load ---------------------------------------------------------

export async function loadFromDisk() {
  let any = false
  for (const key of SAVE_KEYS) {
    const rows = sqlite.prepare(`SELECT data FROM "${key}"`).all()
    if (rows.length > 0) {
      db[key] = rows.map((r) => JSON.parse(r.data))
      any = true
    }
  }
  // refreshTokens (Map<token, username>) — derived view от refreshTokenMeta.
  // Перестраиваем после load, чтобы handlers.js видел сохранённые сессии.
  if (Array.isArray(db.refreshTokenMeta)) {
    db.refreshTokens = new Map(db.refreshTokenMeta.map((s) => [s.token, s.username]))
  }
  return any
}

// ---------- save ---------------------------------------------------------
//
// Алгоритм: после каждой мутации фиксируем «грязные» таблицы по чек-сумме
// (длина + хэш последнего id). Если изменилась — переписываем таблицу
// одной транзакцией. Это не идеально по скорости (для 100k записей —
// сотни мс), но просто и безопасно.

const checksums = new Map()

// Cheap content-aware fingerprint: rolling djb2 over JSON of каждой записи.
// Срабатывает на splice-замену объекта (новый ref → новый JSON), что критично
// для in-place мутаций (смена пароля, role, block-флаги, ленивая миграция
// хеша). Стоимость O(n) на каждый save-цикл — приемлемо при debounce 500ms.
function checksumOf(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '0'
  let h = 5381 >>> 0
  h = ((h * 33) ^ arr.length) >>> 0
  for (let i = 0; i < arr.length; i++) {
    const s = JSON.stringify(arr[i]) || ''
    for (let j = 0; j < s.length; j++) {
      h = ((h * 33) ^ s.charCodeAt(j)) >>> 0
    }
  }
  return String(h)
}

function writeTable(key) {
  const arr = db[key] ?? []
  const tx = sqlite.transaction(() => {
    sqlite.prepare(`DELETE FROM "${key}"`).run()
    const ins = sqlite.prepare(`INSERT INTO "${key}" (id, data) VALUES (?, ?)`)
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i]
      const id = typeof item === 'object' && item ? String(item.id ?? item.username ?? i) : String(i)
      ins.run(id, JSON.stringify(item))
    }
  })
  tx()
}

let pending = null
let lastSave = 0
const DEBOUNCE_MS = 500
const MAX_DELAY_MS = 5000

function flushNow() {
  pending = null
  lastSave = Date.now()
  for (const key of SAVE_KEYS) {
    const cs = checksumOf(db[key])
    if (checksums.get(key) === cs) continue
    try {
      writeTable(key)
      checksums.set(key, cs)
    } catch (e) {
      console.error(`[storage] write ${key} failed:`, e.message)
    }
  }
}

export function scheduleSave() {
  const sinceLast = Date.now() - lastSave
  if (sinceLast > MAX_DELAY_MS && !pending) {
    flushNow()
    return
  }
  if (pending) clearTimeout(pending)
  pending = setTimeout(flushNow, DEBOUNCE_MS)
}

// ---------- explicit flush (без закрытия БД) ----------------------------
// Для admin-операций (checkpoint, backup) нужно дописать pending мутации
// в файл, но БД оставить открытой. flushSync дополнительно закрывает БД —
// он только для shutdown'а.

export function flushPending() {
  if (pending) {
    clearTimeout(pending)
    pending = null
  }
  flushNow()
}

// ---------- graceful shutdown -------------------------------------------

export function flushSync() {
  flushPending()
  try { sqlite.close() } catch { void 0 }
}

// ---------- introspection (для /health) --------------------------------

export function hasPendingWrites() {
  return pending !== null
}

export function getDbPath() {
  return DB_PATH
}

// Дешёвый COUNT(*) по users — sanity-чек что БД жива. -1 при ошибке.
export function countUsers() {
  try {
    return sqlite.prepare('SELECT COUNT(*) AS c FROM "users"').get().c
  } catch {
    return -1
  }
}

// WAL-checkpoint(TRUNCATE): переносит -wal в .db и усекает -wal до 0.
// Возвращает {busy, log, checkpointed}.
export function walCheckpoint() {
  return sqlite.pragma('wal_checkpoint(TRUNCATE)')
}

// Атомарный бэкап через VACUUM INTO — консистентный снапшот без блокировок.
export function backupTo(destPath) {
  try { unlinkSync(destPath) } catch { void 0 }
  sqlite.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`)
  try {
    const st = statSync(destPath)
    return { path: destPath, sizeBytes: st.size, mtime: st.mtime.toISOString() }
  } catch (e) {
    return { path: destPath, error: e.message }
  }
}

// ---------- legacy JSON import (one-shot) -------------------------------
//
// При первом запуске после миграции с JSON: если data/app.db пустая, но есть
// data/db.json — подгружаем оттуда и сохраняем в SQLite. Это позволяет не
// потерять данные при апгрейде.

const LEGACY_JSON = resolve(DATA_DIR, 'db.json')

export function importLegacyJsonIfEmpty() {
  if (!existsSync(LEGACY_JSON)) return false
  let dbEmpty = true
  for (const key of SAVE_KEYS) {
    const count = sqlite.prepare(`SELECT COUNT(*) as c FROM "${key}"`).get().c
    if (count > 0) { dbEmpty = false; break }
  }
  if (!dbEmpty) return false
  try {
    const parsed = JSON.parse(readFileSync(LEGACY_JSON, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return false
    for (const key of SAVE_KEYS) {
      if (Array.isArray(parsed[key])) db[key] = parsed[key]
    }
    flushNow()
    console.log('[storage] imported legacy db.json into app.db')
    return true
  } catch (e) {
    console.error('[storage] legacy import failed:', e.message)
    return false
  }
}
