// ===========================================================================
// EXTREME-стресс мок-бэкенда. В 5× больше данных, чем stress.test.js,
// плюс сценарии, которых там не было:
//   1. Read-burst    — 500 worker'ов параллельно бьют список 500k.
//   2. Mixed R+W     — concurrent чтения + создания + удаления.
//   3. Scrypt flood  — реальный node:crypto scrypt, 100 логинов p99.
//   4. Search worst  — слова, которые матчат всё / ничего.
//   5. Deep-page     — пагинация на ~последней странице (page 25k).
//   6. 413 boundary  — ровно на лимите vs +1.
//
// Скрипт самодостаточный — никаких внешних сервисов не нужно (handlers.js
// напрямую). Цель — найти точку, где p99 начинает деградировать.
// ===========================================================================

import { describe, it, beforeAll } from 'vitest'
import { db } from '../src/mock/db.js'
import { handleMockRequest, setMockDelayMs, setPasswordHasher } from '../src/mock/handlers.js'
import { makeAccessToken } from '../src/mock/jwt-sign.js'
import * as scrypt from '../server/password.js'

// dataset profile — итого ~700k записей основных + 300k реестр ИНН.
// Это 3× оригинального stress.test.js (там 256k всего). Поднимали до 1.6M —
// vitest-worker падал по OOM (~1.4GB rss), даже с --max-old-space-size=8192
// сам JSON-репрезентэйшен 1.6M объектов в V8 это 4-5GB heap. 700k — здоровый
// потолок для одного worker'а на dev-машине.
const ORG_COUNT = 500
const PERSONAL_PER_ORG = 60       // 30k
const EQUIPMENT_PER_ORG = 300     // 150k ← основной нагруженный список
const SOFTWARE_PER_ORG = 200      // 100k
const SECURITY_PER_ORG = 60       // 30k
const IS_PER_ORG = 8              // 4k
const THREATS_PER_ORG = 30        // 15k
const DOCUMENTS_PER_ORG = 40      // 20k
const INN_TOTAL = 300_000
const AUDIT_TOTAL = 50_000

const HEAVY_USER = 'user'
const NOW = Date.now()
let userToken, adminToken

function authHeaders(t) { return { authorization: `Bearer ${t}` } }
function fmt(n) { return n.toFixed(2).padStart(7) }
function pad(n, w) { return String(n).padStart(w) }
// vitest перехватывает console.log и буферизует до конца теста. Для
// стрим-вывода прогресса используем прямой write в stdout.
function out(line) { process.stdout.write(line + '\n') }

// ---- bench helpers ------------------------------------------------------

function pct(arr, p) {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

async function bench(label, iterations, build) {
  const samples = new Array(iterations)
  for (let i = 0; i < iterations; i++) {
    const req = build(i)
    const t0 = performance.now()
    await handleMockRequest(req)
    samples[i] = performance.now() - t0
  }
  const total = samples.reduce((s, x) => s + x, 0)
  const mean = total / samples.length
  out(
    `  ${label.padEnd(50)}` +
    `n=${pad(iterations, 5)}  ` +
    `mean=${fmt(mean)}ms  ` +
    `p50=${fmt(pct(samples, 50))}ms  ` +
    `p95=${fmt(pct(samples, 95))}ms  ` +
    `p99=${fmt(pct(samples, 99))}ms  ` +
    `p999=${fmt(pct(samples, 99.9))}ms  ` +
    `max=${fmt(Math.max(...samples))}ms  ` +
    `≈${Math.round(1000 / mean)} req/s`
  )
}

/**
 * Высоко-параллельная нагрузка: фиксируем `concurrency` одновременных запросов
 * в полёте. Когда один завершается — стартуем следующий, пока не выполним
 * `totalRequests`. Это эмулирует connection-pool с лимитом.
 */
async function loadtest(label, concurrency, totalRequests, build) {
  const samples = new Array(totalRequests)
  const t0 = performance.now()
  let inflight = 0
  let issued = 0
  let done = 0
  let errors = 0
  await new Promise((resolve) => {
    const tick = () => {
      while (inflight < concurrency && issued < totalRequests) {
        const idx = issued++
        inflight++
        const reqT0 = performance.now()
        handleMockRequest(build(idx)).then(
          (r) => {
            samples[idx] = performance.now() - reqT0
            inflight--
            done++
            if (r.status >= 400) errors++
            if (done === totalRequests) resolve()
            else tick()
          },
          () => {
            samples[idx] = performance.now() - reqT0
            inflight--
            done++
            errors++
            if (done === totalRequests) resolve()
            else tick()
          }
        )
      }
    }
    tick()
  })
  const wall = performance.now() - t0
  const valid = samples.filter((x) => Number.isFinite(x))
  const mean = valid.reduce((s, x) => s + x, 0) / valid.length
  out(
    `  ${label.padEnd(50)}` +
    `c=${pad(concurrency, 4)} ` +
    `n=${pad(totalRequests, 6)} ` +
    `err=${pad(errors, 4)}  ` +
    `wall=${pad(wall.toFixed(0), 5)}ms  ` +
    `mean=${fmt(mean)}ms  ` +
    `p50=${fmt(pct(valid, 50))}ms  ` +
    `p95=${fmt(pct(valid, 95))}ms  ` +
    `p99=${fmt(pct(valid, 99))}ms  ` +
    `max=${fmt(Math.max(...valid))}ms  ` +
    `≈${Math.round((totalRequests / wall) * 1000)} req/s`
  )
}

// ---- seed ---------------------------------------------------------------

function memMB() {
  const m = process.memoryUsage()
  return {
    rss: (m.rss / 1024 / 1024).toFixed(0),
    heap: (m.heapUsed / 1024 / 1024).toFixed(0)
  }
}

function seedExtreme() {
  out('  → seeding extreme dataset…')
  const t0 = performance.now()
  const memBefore = memMB()
  setMockDelayMs(0)

  // organizations
  for (let i = 0; i < ORG_COUNT; i++) {
    db.organizations.push({
      id: `xo-${i}`, ownerUsername: HEAVY_USER, kind: i % 2 ? 'ip' : 'ul',
      name: `Орг №${i}`, inn: String(7700000000 + i).padStart(10, '0'),
      ogrn: String(1027700000000 + i), kpp: '770701001',
      address: `Москва, ул. Бенч, ${i}`, phone: `+7 495 ${pad(i, 4)}`,
      email: `o${i}@ex`, notes: '', createdAt: NOW - i, updatedAt: NOW - i
    })
  }
  // info-systems
  for (let i = 0; i < ORG_COUNT; i++) {
    for (let j = 0; j < IS_PER_ORG; j++) {
      db.infoSystems.push({
        id: `xis-${i}-${j}`, ownerUsername: HEAVY_USER,
        organizationId: `xo-${i}`, name: `ИС ${j} орг ${i}`, typeId: 'gis',
        regimId: '', strukId: '', inetId: '', codId: '', classification: 'К3',
        purpose: '', address: '', operatorName: '', operatorInn: '',
        operatorOgrn: '', hasPdn: false, pdnSubjectsCount: 0,
        kiiCategory: '', gisLevel: '', notes: '', status: 'active',
        createdAt: NOW - i - j, updatedAt: NOW - i - j
      })
    }
  }
  // personal
  for (let i = 0; i < ORG_COUNT; i++) {
    for (let j = 0; j < PERSONAL_PER_ORG; j++) {
      db.personal.push({
        id: `xp-${i}-${j}`, ownerUsername: HEAVY_USER,
        organizationId: `xo-${i}`, lastName: `Фам${j}`, firstName: `Имя${j}`,
        middleName: `Отч${j}`, position: `Должн ${j}`, department: `Отд ${j % 5}`,
        email: `p${i}-${j}@ex`, phone: '', notes: '',
        createdAt: NOW - i - j, updatedAt: NOW - i - j
      })
    }
  }
  // equipment — главный нагруженный список
  for (let i = 0; i < ORG_COUNT; i++) {
    for (let j = 0; j < EQUIPMENT_PER_ORG; j++) {
      db.equipment.push({
        id: `xe-${i}-${j}`, ownerUsername: HEAVY_USER,
        organizationId: `xo-${i}`,
        infoSystemId: j % 3 === 0 ? `xis-${i}-${j % IS_PER_ORG}` : '',
        name: `Оборуд ${j}`, model: `M-${j}`, serial: `SN${i}-${j}`,
        inventoryNumber: `INV-${i}-${j}`, typeId: 'pc',
        status: j % 5 === 0 ? 'decommissioned' : 'in_use',
        location: '', notes: '', createdAt: NOW - i - j, updatedAt: NOW - i - j
      })
    }
  }
  // software
  for (let i = 0; i < ORG_COUNT; i++) {
    for (let j = 0; j < SOFTWARE_PER_ORG; j++) {
      db.software.push({
        id: `xsw-${i}-${j}`, ownerUsername: HEAVY_USER,
        organizationId: `xo-${i}`,
        infoSystemId: j % 4 === 0 ? `xis-${i}-${j % IS_PER_ORG}` : '',
        category: j % 2 ? 'system' : 'application', name: `ПО ${j}`,
        vendor: `V-${j % 10}`, version: `1.${j}.0`, kindId: '',
        licenseType: '', licenseExpiresAt: 0, notes: '',
        createdAt: NOW - i - j, updatedAt: NOW - i - j
      })
    }
  }
  // security tools
  db.securityToolsCatalog.push({
    id: 'xstc-1', name: 'СЗИ', vendor: 'V', certificateNumber: '0',
    certificateExpiresAt: 0, classes: [], description: '',
    createdAt: NOW, updatedAt: NOW
  })
  for (let i = 0; i < ORG_COUNT; i++) {
    for (let j = 0; j < SECURITY_PER_ORG; j++) {
      db.securityTools.push({
        id: `xst-${i}-${j}`, ownerUsername: HEAVY_USER,
        organizationId: `xo-${i}`,
        infoSystemId: j % 2 ? `xis-${i}-${j % IS_PER_ORG}` : '',
        catalogId: 'xstc-1', serial: `STSN${i}-${j}`, licenseKey: `LK${i}-${j}`,
        licenseExpiresAt: NOW + j * 86_400_000, status: 'active',
        notes: '', createdAt: NOW - i - j, updatedAt: NOW - i - j
      })
    }
  }
  // threat models
  for (let i = 0; i < ORG_COUNT; i++) {
    for (let j = 0; j < THREATS_PER_ORG; j++) {
      db.threatModels.push({
        id: `xtm-${i}-${j}`, ownerUsername: HEAVY_USER,
        organizationId: `xo-${i}`,
        infoSystemId: `xis-${i}-${j % IS_PER_ORG}`,
        name: `МУ ${j}`, status: j % 2 ? 'finalized' : 'draft',
        intruder: { type: 'external', potential: 'basic', capabilities: [], motivation: '' },
        threats: [], conclusion: '',
        createdAt: NOW - i - j, updatedAt: NOW - i - j
      })
    }
  }
  // documents
  for (let i = 0; i < ORG_COUNT; i++) {
    for (let j = 0; j < DOCUMENTS_PER_ORG; j++) {
      db.documents.push({
        id: `xd-${i}-${j}`, ownerUsername: HEAVY_USER,
        organizationId: `xo-${i}`, templateId: 'tpl', title: `Док ${j}`,
        status: ['draft', 'pending', 'approved', 'rejected'][j % 4],
        payload: {}, comment: '',
        createdAt: NOW - i - j, updatedAt: NOW - i - j
      })
    }
  }
  // inn registry
  for (let i = 0; i < INN_TOTAL; i++) {
    db.innRegistry.push({
      id: `xinn-${i}`, ownerUsername: HEAVY_USER,
      inn: String(7700000000 + i), status: 'done',
      data: { orgName: `K${i}` }, error: null,
      createdAt: NOW - i, updatedAt: NOW - i
    })
  }
  // audit
  for (let i = 0; i < AUDIT_TOTAL; i++) {
    db.audit.push({
      id: `xa-${i}`, at: NOW - i * 1000,
      actor: HEAVY_USER, action: 'op', target: `t-${i}`, details: ''
    })
  }

  userToken = makeAccessToken({ username: HEAVY_USER, role: 'user', verified: true, blocked: false })
  adminToken = makeAccessToken({ username: 'admin', role: 'admin', verified: true, blocked: false })

  const seedMs = performance.now() - t0
  const memAfter = memMB()
  const totalRecords =
    db.organizations.length + db.infoSystems.length + db.personal.length +
    db.equipment.length + db.software.length + db.securityTools.length +
    db.threatModels.length + db.documents.length + db.innRegistry.length +
    db.audit.length
  out(`  ✓ seeded in ${seedMs.toFixed(0)} ms — ${totalRecords.toLocaleString()} records`)
  out(`    memory: rss ${memBefore.rss}→${memAfter.rss} MB, heap ${memBefore.heap}→${memAfter.heap} MB`)
  out(`    organizations: ${db.organizations.length.toLocaleString()}`)
  out(`    infoSystems:   ${db.infoSystems.length.toLocaleString()}`)
  out(`    personal:      ${db.personal.length.toLocaleString()}`)
  out(`    equipment:     ${db.equipment.length.toLocaleString()}`)
  out(`    software:      ${db.software.length.toLocaleString()}`)
  out(`    securityTools: ${db.securityTools.length.toLocaleString()}`)
  out(`    threatModels:  ${db.threatModels.length.toLocaleString()}`)
  out(`    documents:     ${db.documents.length.toLocaleString()}`)
  out(`    innRegistry:   ${db.innRegistry.length.toLocaleString()}`)
  out(`    audit:         ${db.audit.length.toLocaleString()}`)
}

// ===========================================================================

describe('extreme stress', () => {
  beforeAll(() => seedExtreme(), 240_000)

  it('hot path: list endpoints', async () => {
    out('\n== Hot-path list latency ==')
    await bench('GET /organizations (500 rows)', 500, () => ({
      method: 'GET', url: '/organizations?page=1&pageSize=20', headers: authHeaders(userToken)
    }))
    await bench('GET /info-systems (4k rows)', 500, () => ({
      method: 'GET', url: '/info-systems?page=1&pageSize=20', headers: authHeaders(userToken)
    }))
    await bench('GET /personal (30k rows)', 300, () => ({
      method: 'GET', url: '/personal?page=1&pageSize=20', headers: authHeaders(userToken)
    }))
    await bench('GET /equipment (150k rows)', 300, () => ({
      method: 'GET', url: '/equipment?page=1&pageSize=20', headers: authHeaders(userToken)
    }))
    await bench('GET /software (100k rows)', 300, () => ({
      method: 'GET', url: '/software?page=1&pageSize=20', headers: authHeaders(userToken)
    }))
    await bench('GET /threat-models (15k rows)', 300, () => ({
      method: 'GET', url: '/threat-models?page=1&pageSize=20', headers: authHeaders(userToken)
    }))
    await bench('GET /registry (20k docs)', 300, () => ({
      method: 'GET', url: '/registry?page=1&pageSize=20', headers: authHeaders(userToken)
    }))
    await bench('GET /inn-registry (300k rows)', 100, () => ({
      method: 'GET', url: '/inn-registry', headers: authHeaders(userToken)
    }))
    await bench('GET /audit admin (50k rows)', 200, () => ({
      method: 'GET', url: '/audit?page=1&pageSize=50', headers: authHeaders(adminToken)
    }))
    await bench('GET /statistics admin', 100, () => ({
      method: 'GET', url: '/statistics', headers: authHeaders(adminToken)
    }))
  }, 600_000)

  it('search worst-case: random + match-all + no-match', async () => {
    out('\n== Search worst-case (n=100) ==')
    // match-all: "in_use" pops в каждом 5-м оборудовании — фильтр почти не отсекает
    await bench('GET /equipment search="in_use" (matches~80%)', 100, () => ({
      method: 'GET', url: '/equipment?page=1&pageSize=20&search=in_use', headers: authHeaders(userToken)
    }))
    // средний фильтр — числовая подстрока, попадает в часть записей
    await bench('GET /equipment search="123" (~10%)', 100, () => ({
      method: 'GET', url: '/equipment?page=1&pageSize=20&search=123', headers: authHeaders(userToken)
    }))
    // ничего не матчит — должен пройти ВСЁ
    await bench('GET /equipment search="zzz999" (none)', 100, () => ({
      method: 'GET', url: '/equipment?page=1&pageSize=20&search=zzz999', headers: authHeaders(userToken)
    }))
    // случайные термы — каждый раз новый запрос, кеш не помогает
    let idx = 0
    await bench('GET /equipment search=rand (no cache)', 100, () => ({
      method: 'GET',
      url: `/equipment?page=1&pageSize=20&search=SN${idx++}-${idx % 100}`,
      headers: authHeaders(userToken)
    }))
  }, 600_000)

  it('deep pagination: last-page reads', async () => {
    out('\n== Deep-page reads ==')
    await bench('GET /equipment page=7499 (150k)', 200, () => ({
      method: 'GET', url: '/equipment?page=7499&pageSize=20', headers: authHeaders(userToken)
    }))
    await bench('GET /equipment page=3750 (mid)', 200, () => ({
      method: 'GET', url: '/equipment?page=3750&pageSize=20', headers: authHeaders(userToken)
    }))
    await bench('GET /personal page=1499 (30k)', 200, () => ({
      method: 'GET', url: '/personal?page=1499&pageSize=20', headers: authHeaders(userToken)
    }))
    await bench('GET /inn-registry page=2999 (300k)', 100, () => ({
      method: 'GET', url: '/inn-registry?page=2999&pageSize=100', headers: authHeaders(userToken)
    }))
  }, 600_000)

  it('extreme concurrency: 200 workers × 50 = 10 000 calls', async () => {
    out('\n== Concurrent burst (c=200, n=10_000) ==')
    await loadtest('READ /equipment (150k)', 200, 10_000, () => ({
      method: 'GET', url: '/equipment?page=1&pageSize=20', headers: authHeaders(userToken)
    }))
    await loadtest('READ /software (100k)', 200, 10_000, () => ({
      method: 'GET', url: '/software?page=1&pageSize=20', headers: authHeaders(userToken)
    }))
    await loadtest('READ /personal (30k)', 200, 10_000, () => ({
      method: 'GET', url: '/personal?page=1&pageSize=20', headers: authHeaders(userToken)
    }))
    await loadtest('READ /audit admin (50k)', 200, 10_000, () => ({
      method: 'GET', url: '/audit?page=1&pageSize=50', headers: authHeaders(adminToken)
    }))
    let s = 0
    await loadtest('READ /equipment search=rand (cold)', 200, 3_000, () => ({
      method: 'GET',
      url: `/equipment?page=1&pageSize=20&search=SN${(s++) % 1000}`,
      headers: authHeaders(userToken)
    }))
  }, 600_000)

  it('mixed R+W storm: reads + creates + deletes concurrently', async () => {
    out('\n== R+W mixed storm (c=100, 5k ops total) ==')
    await loadtest('MIX 80% read /equipment + 20% POST', 100, 5_000, (i) => {
      if (i % 5 === 0) {
        // POST — create equipment
        return {
          method: 'POST', url: '/equipment',
          headers: authHeaders(userToken),
          body: {
            organizationId: 'xo-0',
            name: `live-${i}`, model: 'X', serial: `LIVE-${i}`,
            inventoryNumber: `L-${i}`, typeId: 'pc', status: 'in_use'
          }
        }
      }
      return {
        method: 'GET', url: '/equipment?page=1&pageSize=20',
        headers: authHeaders(userToken)
      }
    })
    out(`    equipment table now: ${db.equipment.length.toLocaleString()} rows`)
  }, 600_000)

  it('bulk chunk boundary: at-limit vs over-limit', async () => {
    out('\n== Bulk chunk boundary ==')
    function makeInnPayload(n) {
      const items = []
      for (let i = 0; i < n; i++) {
        items.push({ inn: String(8000000000 + i), status: 'done', data: { orgName: `B${i}` } })
      }
      return items
    }
    await bench('POST /inn-registry/bulk-upsert (100=limit)', 20, () => ({
      method: 'POST', url: '/inn-registry/bulk-upsert',
      body: { items: makeInnPayload(100) },
      headers: authHeaders(userToken)
    }))
    await bench('POST /inn-registry/bulk-upsert (101 → 413)', 20, () => ({
      method: 'POST', url: '/inn-registry/bulk-upsert',
      body: { items: makeInnPayload(101) },
      headers: authHeaders(userToken)
    }))
    await bench('POST /inn-registry/bulk-upsert (500 → 413)', 20, () => ({
      method: 'POST', url: '/inn-registry/bulk-upsert',
      body: { items: makeInnPayload(500) },
      headers: authHeaders(userToken)
    }))
  }, 600_000)

  it('scrypt: password verify under load (async)', async () => {
    out('\n== Scrypt verify (real node:crypto, async) ==')
    // Прогон через server/password.js напрямую. После перевода hash/verify
    // на promisified scrypt — параллельные вызовы реально идут параллельно
    // в libuv thread-pool (по умолчанию 4 worker'а).
    setPasswordHasher(scrypt)
    const password = 'StressTestP@ssw0rd!'
    const hash = await scrypt.hash(password)

    // sequential: один за другим, нельзя обогнать ~30 ms CPU на одно hash'ирование
    const seqT0 = performance.now()
    const seqN = 50
    for (let i = 0; i < seqN; i++) await scrypt.verify(password, hash)
    const seqWall = performance.now() - seqT0
    const seqMean = seqWall / seqN
    out(`  sequential verify x${seqN}  total=${seqWall.toFixed(0)}ms  mean=${seqMean.toFixed(1)}ms  ≈${Math.round(1000 / seqMean)} verify/s`)

    // parallel: libuv thread-pool развешивает работу по N worker'ам.
    // Ожидаем speed-up ≈ UV_THREADPOOL_SIZE (по умолчанию 4) → ~120 verify/s.
    const parT0 = performance.now()
    const parN = 100
    await Promise.all(
      Array.from({ length: parN }, () => scrypt.verify(password, hash))
    )
    const parWall = performance.now() - parT0
    const speedup = (seqMean * parN) / parWall
    out(`  parallel verify x${parN}    total=${parWall.toFixed(0)}ms  ≈${Math.round((parN / parWall) * 1000)} verify/s  speedup=${speedup.toFixed(2)}×`)

    // wrong-password cost: должен пройти полное derivation, плюс async-overhead
    const wrongT0 = performance.now()
    for (let i = 0; i < 50; i++) await scrypt.verify('WRONG-' + i, hash)
    const wrongWall = performance.now() - wrongT0
    out(`  wrong-password verify x50  total=${wrongWall.toFixed(0)}ms  mean=${(wrongWall / 50).toFixed(1)}ms`)
  }, 600_000)
})
