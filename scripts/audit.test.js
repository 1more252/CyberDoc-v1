import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../src/mock/db.js'
import { logAudit, cleanupAudit, logAuditDiff, auditListHandler } from '../src/mock/audit.js'

const admin = { username: 'admin', role: 'admin' }
const user = { username: 'user', role: 'user' }
const BASE_AT = Date.parse('2026-05-01T00:00:00Z')

beforeEach(() => {
  db.audit = []
})

describe('logAudit', () => {
  it('пишет запись в начало массива с обязательными полями', () => {
    logAudit('admin', 'org.create', 'org-1', 'details')
    expect(db.audit).toHaveLength(1)
    const e = db.audit[0]
    expect(e.actor).toBe('admin')
    expect(e.action).toBe('org.create')
    expect(e.target).toBe('org-1')
    expect(e.details).toBe('details')
    expect(typeof e.id).toBe('string')
    expect(typeof e.at).toBe('number')
    expect(e.at).toBeGreaterThan(0)
  })

  it('новейшие записи в начале (unshift order)', () => {
    logAudit('a', 'x', 't1')
    logAudit('a', 'x', 't2')
    logAudit('a', 'x', 't3')
    expect(db.audit.map((e) => e.target)).toEqual(['t3', 't2', 't1'])
  })

  it('ip добавляется только если передан непустым', () => {
    logAudit('admin', 'login', 'with-ip', '', '1.2.3.4')
    logAudit('admin', 'login', 'no-ip', '')
    const withIp = db.audit.find((e) => e.target === 'with-ip')
    const noIp = db.audit.find((e) => e.target === 'no-ip')
    expect(withIp.ip).toBe('1.2.3.4')
    expect(noIp).not.toHaveProperty('ip')
  })

  it('details дефолтит к пустой строке', () => {
    logAudit('admin', 'x', 't')
    expect(db.audit[0].details).toBe('')
  })

  it('хард-кап обрезает массив до 10 000 записей (drop tail)', () => {
    db.audit = Array.from({ length: 10_000 }, (_, i) => ({
      id: `seed-${i}`,
      actor: 'a',
      action: 'x',
      target: `t-${i}`,
      details: '',
      at: i
    }))
    logAudit('admin', 'new', 'new-target')
    expect(db.audit).toHaveLength(10_000)
    expect(db.audit[0].target).toBe('new-target')
    // unshift сдвигает все вправо, хвостовой seed-9999 теряется, выживший хвост — seed-9998
    expect(db.audit.at(-1).id).toBe('seed-9998')
  })
})

describe('cleanupAudit', () => {
  it('возвращает 0 на пустом массиве', () => {
    expect(cleanupAudit(1000)).toBe(0)
  })

  it('удаляет записи старше maxAgeMs', () => {
    const now = Date.now()
    db.audit = [
      { id: 'a', actor: 'x', action: 'y', target: 't', details: '', at: now },
      { id: 'b', actor: 'x', action: 'y', target: 't', details: '', at: now - 1000 },
      { id: 'c', actor: 'x', action: 'y', target: 't', details: '', at: now - 1_000_000 }
    ]
    const removed = cleanupAudit(60_000)
    expect(removed).toBe(1)
    expect(db.audit.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('maxAgeMs=0 — пропускает фильтрацию по возрасту', () => {
    db.audit = [
      { id: 'old', actor: 'x', action: 'y', target: 't', details: '', at: 1 }
    ]
    expect(cleanupAudit(0)).toBe(0)
    expect(db.audit).toHaveLength(1)
  })

  it('обрезает по maxRows (берёт префикс — новейшие)', () => {
    db.audit = Array.from({ length: 100 }, (_, i) => ({
      id: `id-${i}`,
      actor: 'x',
      action: 'y',
      target: 't',
      details: '',
      at: 1000 - i
    }))
    const removed = cleanupAudit(0, 30)
    expect(removed).toBe(70)
    expect(db.audit).toHaveLength(30)
    expect(db.audit[0].id).toBe('id-0')
    expect(db.audit.at(-1).id).toBe('id-29')
  })

  it('идемпотентна — повторный вызов возвращает 0', () => {
    const now = Date.now()
    db.audit = [
      { id: 'a', actor: 'x', action: 'y', target: 't', details: '', at: now - 999_999 }
    ]
    cleanupAudit(60_000)
    expect(cleanupAudit(60_000)).toBe(0)
  })

  it('запись без поля at обрабатывается как at=0 (удаляется при ненулевом maxAge)', () => {
    db.audit = [
      { id: 'no-at', actor: 'x', action: 'y', target: 't', details: '' }
    ]
    const removed = cleanupAudit(1000)
    expect(removed).toBe(1)
    expect(db.audit).toHaveLength(0)
  })
})

describe('logAuditDiff', () => {
  it('не пишет, если поля не менялись', () => {
    logAuditDiff('admin', 'org.update', 'org-1', { name: 'A' }, { name: 'A' }, ['name'])
    expect(db.audit).toHaveLength(0)
  })

  it('пишет JSON-diff в details при изменении', () => {
    logAuditDiff(
      'admin',
      'org.update',
      'org-1',
      { name: 'A', inn: '1' },
      { name: 'B', inn: '1' },
      ['name', 'inn']
    )
    expect(db.audit).toHaveLength(1)
    const parsed = JSON.parse(db.audit[0].details)
    expect(parsed).toEqual({ before: { name: 'A' }, after: { name: 'B' } })
  })

  it('игнорирует поля, не входящие в список fields', () => {
    logAuditDiff(
      'admin',
      'org.update',
      'org-1',
      { name: 'A', secret: 'x' },
      { name: 'A', secret: 'y' },
      ['name']
    )
    expect(db.audit).toHaveLength(0)
  })

  it('пустой before — пишет (after-значения как «новое»)', () => {
    logAuditDiff('admin', 'org.create', 'org-1', {}, { name: 'B' }, ['name'])
    expect(db.audit).toHaveLength(1)
    const parsed = JSON.parse(db.audit[0].details)
    expect(parsed.before).toEqual({ name: undefined })
    expect(parsed.after).toEqual({ name: 'B' })
  })
})

describe('auditListHandler — guards', () => {
  it('401 без caller', () => {
    const r = auditListHandler({}, null)
    expect(r.status).toBe(401)
    expect(r.data.error).toBe('no_token')
  })

  it('403 для не-админа', () => {
    const r = auditListHandler({}, user)
    expect(r.status).toBe(403)
    expect(r.data.error).toBe('forbidden')
  })

  it('200 для админа на пустом аудите', () => {
    const r = auditListHandler({}, admin)
    expect(r.status).toBe(200)
    expect(r.data.items).toEqual([])
    expect(r.data.total).toBe(0)
  })
})

describe('auditListHandler — пагинация и фильтры', () => {
  beforeEach(() => {
    db.audit = [
      { id: '1', actor: 'admin', action: 'login', target: 'admin', details: 'ok', at: BASE_AT + 5000, ip: '1.1.1.1' },
      { id: '2', actor: 'admin', action: 'org.create', target: 'org-1', details: 'name=Foo', at: BASE_AT + 4000 },
      { id: '3', actor: 'expert', action: 'org.update', target: 'org-2', details: '{"a":1}', at: BASE_AT + 3000 },
      { id: '4', actor: 'user', action: 'login', target: 'user', details: 'ok', at: BASE_AT + 2000 },
      { id: '5', actor: 'admin', action: 'logout', target: 'admin', details: '', at: BASE_AT + 1000 }
    ]
  })

  it('возвращает все записи без фильтров', () => {
    const r = auditListHandler({ page: 1, pageSize: 50 }, admin)
    expect(r.data.total).toBe(5)
    expect(r.data.items).toHaveLength(5)
  })

  it('пагинация: pageSize=2, page=2 → записи 3-4', () => {
    const r = auditListHandler({ page: 2, pageSize: 2 }, admin)
    expect(r.data.total).toBe(5)
    expect(r.data.items.map((e) => e.id)).toEqual(['3', '4'])
  })

  it('фильтр по action — точное совпадение', () => {
    const r = auditListHandler({ action: 'login' }, admin)
    expect(r.data.total).toBe(2)
    expect(r.data.items.map((e) => e.id).sort()).toEqual(['1', '4'])
  })

  it('фильтр по actor — точное совпадение, case-insensitive', () => {
    const r = auditListHandler({ actor: 'ADMIN' }, admin)
    expect(r.data.total).toBe(3)
    expect(r.data.items).toHaveLength(3)
    expect(r.data.items.every((e) => e.actor === 'admin')).toBe(true)
  })

  it('search ищет в actor/target/details/ip', () => {
    const r1 = auditListHandler({ search: 'org-1' }, admin)
    expect(r1.data.total).toBe(1)
    expect(r1.data.items[0].id).toBe('2')

    const r2 = auditListHandler({ search: '1.1.1.1' }, admin)
    expect(r2.data.total).toBe(1)
    expect(r2.data.items[0].id).toBe('1')

    const r3 = auditListHandler({ search: 'foo' }, admin)
    expect(r3.data.total).toBe(1)
    expect(r3.data.items[0].id).toBe('2')
  })

  it('dateFrom (ISO) — отсекает по at >= cutoff', () => {
    const r = auditListHandler({ dateFrom: new Date(BASE_AT + 3000).toISOString() }, admin)
    expect(r.data.total).toBe(3)
    expect(r.data.items.map((e) => e.id).sort()).toEqual(['1', '2', '3'])
  })

  it('dateTo (YYYY-MM-DD) включает весь день (+24h-1ms граница)', () => {
    // На границе: запись внутри дня (включена), запись на следующих суток (исключена)
    db.audit = [
      { id: 'inside', actor: 'a', action: 'x', target: 't', details: '', at: BASE_AT + 86_400_000 - 1 },
      { id: 'edge-day-start', actor: 'a', action: 'x', target: 't', details: '', at: BASE_AT + 86_400_000 }
    ]
    const r = auditListHandler({ dateTo: '2026-05-01' }, admin)
    expect(r.data.items.map((e) => e.id)).toEqual(['inside'])
  })

  it('dateTo (ISO) — отсекает по at <= cutoff (без расширения дня)', () => {
    const r = auditListHandler({ dateTo: new Date(BASE_AT + 3000).toISOString() }, admin)
    expect(r.data.total).toBe(3)
    expect(r.data.items.map((e) => e.id).sort()).toEqual(['3', '4', '5'])
  })

  it('невалидные dateFrom/dateTo — игнорируются (не валит запрос)', () => {
    const r = auditListHandler({ dateFrom: 'not-a-date', dateTo: 'also-bad' }, admin)
    expect(r.status).toBe(200)
    expect(r.data.total).toBe(5)
  })

  it('unix-ms в dateFrom тоже работает', () => {
    const r = auditListHandler({ dateFrom: BASE_AT + 3000 }, admin)
    expect(r.data.total).toBe(3)
  })

  it('комбинация фильтров: action + actor + search', () => {
    const r = auditListHandler({ action: 'login', actor: 'admin', search: 'ok' }, admin)
    expect(r.data.total).toBe(1)
    expect(r.data.items[0].id).toBe('1')
  })

  it('pageSize клампится по верхней границе (200 по умолчанию)', () => {
    db.audit = Array.from({ length: 300 }, (_, i) => ({
      id: `${i}`, actor: 'a', action: 'x', target: 't', details: '', at: i
    }))
    const r = auditListHandler({ pageSize: 9999 }, admin)
    expect(r.data.items.length).toBe(200)
    expect(r.data.total).toBe(300)
  })

  it('некорректные page/pageSize — fallback к page=1, pageSize=50', () => {
    const r = auditListHandler({ page: 'abc', pageSize: -5 }, admin)
    expect(r.status).toBe(200)
    expect(r.data.total).toBe(5)
    expect(r.data.items).toHaveLength(5)
  })
})
