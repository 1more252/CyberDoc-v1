import { describe, it, beforeAll } from 'vitest'
import { db } from '../src/mock/db.js'
import { handleMockRequest, setMockDelayMs } from '../src/mock/handlers.js'
import { makeAccessToken } from '../src/mock/jwt-sign.js'

/**
 * Stress-харнесс для мок-эндпоинтов.
 *
 * Что меряем — латентность серверных операций под нагрузкой при больших объёмах
 * данных. Это эмулирует ситуацию «крупный клиент + наплыв пользователей»:
 * один Vue-стор → много параллельных пагинированных запросов.
 *
 * Что НЕ меряем — render-время и сеть. Render — это main thread в браузере,
 * упирается в виртуальный скролл (его нет, но списки пагинированы). Сеть —
 * это реальный бэк, замена мока 1-в-1.
 */

const NOW = Date.now()
const ORG_COUNT = 200
const PERSONAL_PER_ORG = 50      // 10k personal
const EQUIPMENT_PER_ORG = 250    // 50k equipment
const SOFTWARE_PER_ORG = 250     // 50k software
const SECURITY_PER_ORG = 50      // 10k security-tools
const INN_REGISTRY_TOTAL = 100_000
const DOCUMENTS_PER_ORG = 100    // 20k documents
const IS_PER_ORG = 5             // 1k info-systems
const THREATS_PER_ORG = 25       // 5k threat-models
const AUDIT_TOTAL = 10_000

const HEAVY_USER = 'user'
let userToken
let adminToken

function authHeaders(token) {
  return { authorization: `Bearer ${token}` }
}

function seedHugeDb() {
  console.log('  → seeding huge dataset…')
  const t0 = performance.now()

  setMockDelayMs(0)

  for (let i = 0; i < ORG_COUNT; i++) {
    db.organizations.push({
      id: `bench-org-${i}`,
      ownerUsername: HEAVY_USER,
      kind: i % 2 ? 'ip' : 'ul',
      name: `Тестовая организация №${i}`,
      inn: String(7700000000 + i).padStart(10, '0'),
      ogrn: String(1027700000000 + i),
      kpp: '770701001',
      address: `г. Москва, ул. Бенчмарка, ${i}`,
      phone: `+7 495 000-${String(i).padStart(4, '0')}`,
      email: `bench${i}@example`,
      notes: '',
      createdAt: NOW - i * 1000,
      updatedAt: NOW - i * 1000
    })
  }

  for (let i = 0; i < ORG_COUNT; i++) {
    for (let j = 0; j < IS_PER_ORG; j++) {
      db.infoSystems.push({
        id: `bench-is-${i}-${j}`,
        ownerUsername: HEAVY_USER,
        organizationId: `bench-org-${i}`,
        name: `ИС №${j} орг ${i}`,
        typeId: 'gis',
        regimId: '',
        strukId: '',
        inetId: '',
        codId: '',
        classification: 'К3',
        purpose: '',
        address: '',
        operatorName: '',
        operatorInn: '',
        operatorOgrn: '',
        hasPdn: false,
        pdnSubjectsCount: 0,
        kiiCategory: '',
        gisLevel: '',
        notes: '',
        status: 'active',
        createdAt: NOW - i * 1000 - j,
        updatedAt: NOW - i * 1000 - j
      })
    }
  }

  for (let i = 0; i < ORG_COUNT; i++) {
    for (let j = 0; j < PERSONAL_PER_ORG; j++) {
      db.personal.push({
        id: `bench-pers-${i}-${j}`,
        ownerUsername: HEAVY_USER,
        organizationId: `bench-org-${i}`,
        lastName: `Иванов${j}`,
        firstName: `Иван${j}`,
        middleName: `Иванович${j}`,
        position: `Должность ${j}`,
        department: `Отдел ${j % 5}`,
        email: `bench-${i}-${j}@example`,
        phone: '',
        notes: '',
        createdAt: NOW - i * 1000 - j,
        updatedAt: NOW - i * 1000 - j
      })
    }
  }

  for (let i = 0; i < ORG_COUNT; i++) {
    for (let j = 0; j < EQUIPMENT_PER_ORG; j++) {
      db.equipment.push({
        id: `bench-eq-${i}-${j}`,
        ownerUsername: HEAVY_USER,
        organizationId: `bench-org-${i}`,
        infoSystemId: j % 3 === 0 ? `bench-is-${i}-${j % IS_PER_ORG}` : '',
        name: `Оборудование ${j}`,
        model: `Model-${j}`,
        serial: `SN${i}-${j}`,
        inventoryNumber: `INV-${i}-${j}`,
        typeId: 'pc',
        status: j % 5 === 0 ? 'decommissioned' : 'in_use',
        location: '',
        notes: '',
        createdAt: NOW - i * 100 - j,
        updatedAt: NOW - i * 100 - j
      })
    }
  }

  for (let i = 0; i < ORG_COUNT; i++) {
    for (let j = 0; j < SOFTWARE_PER_ORG; j++) {
      db.software.push({
        id: `bench-sw-${i}-${j}`,
        ownerUsername: HEAVY_USER,
        organizationId: `bench-org-${i}`,
        infoSystemId: j % 4 === 0 ? `bench-is-${i}-${j % IS_PER_ORG}` : '',
        category: j % 2 ? 'system' : 'application',
        name: `Софт ${j}`,
        vendor: `Vendor-${j % 10}`,
        version: `1.${j}.0`,
        kindId: '',
        licenseType: '',
        licenseExpiresAt: 0,
        notes: '',
        createdAt: NOW - i * 100 - j,
        updatedAt: NOW - i * 100 - j
      })
    }
  }

  for (let i = 0; i < ORG_COUNT; i++) {
    for (let j = 0; j < SECURITY_PER_ORG; j++) {
      db.securityTools.push({
        id: `bench-st-${i}-${j}`,
        ownerUsername: HEAVY_USER,
        organizationId: `bench-org-${i}`,
        infoSystemId: j % 2 === 0 ? `bench-is-${i}-${j % IS_PER_ORG}` : '',
        catalogId: `bench-stcat-1`,
        serial: `STSN${i}-${j}`,
        licenseKey: `LK${i}-${j}`,
        licenseExpiresAt: NOW + j * 86_400_000,
        status: 'active',
        notes: '',
        createdAt: NOW - i * 100 - j,
        updatedAt: NOW - i * 100 - j
      })
    }
  }

  db.securityToolsCatalog.push({
    id: 'bench-stcat-1',
    name: 'Тестовое СЗИ',
    vendor: 'Vendor',
    certificateNumber: '0000',
    certificateExpiresAt: 0,
    classes: [],
    description: '',
    createdAt: NOW,
    updatedAt: NOW
  })

  for (let i = 0; i < INN_REGISTRY_TOTAL; i++) {
    db.innRegistry.push({
      id: `bench-inn-${i}`,
      ownerUsername: HEAVY_USER,
      inn: String(7700000000 + i),
      status: 'done',
      data: { orgName: `Контрагент ${i}` },
      error: null,
      createdAt: NOW - i,
      updatedAt: NOW - i
    })
  }

  for (let i = 0; i < ORG_COUNT; i++) {
    for (let j = 0; j < DOCUMENTS_PER_ORG; j++) {
      db.documents.push({
        id: `bench-doc-${i}-${j}`,
        ownerUsername: HEAVY_USER,
        organizationId: `bench-org-${i}`,
        templateId: 'tpl-pdn-policy',
        title: `Документ ${j}`,
        status: ['draft', 'pending', 'approved', 'rejected'][j % 4],
        payload: { lorem: 'ipsum'.repeat(20) },
        comment: '',
        createdAt: NOW - i * 100 - j,
        updatedAt: NOW - i * 100 - j
      })
    }
  }

  for (let i = 0; i < ORG_COUNT; i++) {
    for (let j = 0; j < THREATS_PER_ORG; j++) {
      db.threatModels.push({
        id: `bench-tm-${i}-${j}`,
        ownerUsername: HEAVY_USER,
        organizationId: `bench-org-${i}`,
        infoSystemId: `bench-is-${i}-${j % IS_PER_ORG}`,
        name: `Модель угроз ${j}`,
        status: j % 2 ? 'finalized' : 'draft',
        intruder: { type: 'external', potential: 'basic', capabilities: [], motivation: '' },
        threats: [],
        conclusion: '',
        createdAt: NOW - i * 100 - j,
        updatedAt: NOW - i * 100 - j
      })
    }
  }

  for (let i = 0; i < AUDIT_TOTAL; i++) {
    db.audit.push({
      id: `bench-audit-${i}`,
      at: NOW - i * 1000,
      actor: HEAVY_USER,
      action: 'op',
      target: `t-${i}`,
      details: ''
    })
  }

  userToken = makeAccessToken({ username: HEAVY_USER, role: 'user', verified: true, blocked: false })
  adminToken = makeAccessToken({ username: 'admin', role: 'admin', verified: true, blocked: false })

  const t1 = performance.now()
  console.log(`  ✓ seeded in ${Math.round(t1 - t0)} ms`)
  console.log(`    organizations: ${db.organizations.length}`)
  console.log(`    infoSystems:   ${db.infoSystems.length}`)
  console.log(`    personal:      ${db.personal.length}`)
  console.log(`    equipment:     ${db.equipment.length}`)
  console.log(`    software:      ${db.software.length}`)
  console.log(`    securityTools: ${db.securityTools.length}`)
  console.log(`    threatModels:  ${db.threatModels.length}`)
  console.log(`    innRegistry:   ${db.innRegistry.length}`)
  console.log(`    documents:     ${db.documents.length}`)
  console.log(`    audit:         ${db.audit.length}`)
}

function pct(arr, p) {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

async function bench(label, iterations, build) {
  const samples = []
  for (let i = 0; i < iterations; i++) {
    const req = build(i)
    const t0 = performance.now()
    await handleMockRequest(req)
    samples.push(performance.now() - t0)
  }
  const mean = samples.reduce((s, x) => s + x, 0) / samples.length
  const p50 = pct(samples, 50)
  const p95 = pct(samples, 95)
  const p99 = pct(samples, 99)
  const max = Math.max(...samples)
  const total = samples.reduce((s, x) => s + x, 0)
  const rps = Math.round(1000 / mean)
  console.log(
    `  ${label.padEnd(46)}` +
      `n=${String(iterations).padStart(4)}  ` +
      `mean=${mean.toFixed(2).padStart(7)}ms  ` +
      `p50=${p50.toFixed(2).padStart(7)}ms  ` +
      `p95=${p95.toFixed(2).padStart(7)}ms  ` +
      `p99=${p99.toFixed(2).padStart(7)}ms  ` +
      `max=${max.toFixed(2).padStart(7)}ms  ` +
      `total=${total.toFixed(0).padStart(6)}ms  ` +
      `≈${rps} req/s`
  )
  return { label, iterations, mean, p50, p95, p99, max, total }
}

async function concurrentBench(label, concurrency, perWorker, build) {
  const t0 = performance.now()
  const workers = []
  for (let w = 0; w < concurrency; w++) {
    workers.push(
      (async () => {
        for (let i = 0; i < perWorker; i++) {
          await handleMockRequest(build(w, i))
        }
      })()
    )
  }
  await Promise.all(workers)
  const t1 = performance.now()
  const total = t1 - t0
  const ops = concurrency * perWorker
  console.log(
    `  ${label.padEnd(46)}` +
      `workers=${String(concurrency).padStart(3)} ` +
      `each=${String(perWorker).padStart(3)}  ` +
      `total=${total.toFixed(0).padStart(6)}ms  ` +
      `≈${Math.round((ops / total) * 1000)} req/s`
  )
}

describe('stress: mock backend', () => {
  beforeAll(() => {
    seedHugeDb()
  })

  it('list endpoints — large datasets, sequential', async () => {
    console.log('\n== Sequential list bench ==')
    await bench('GET /organizations (200 rows)', 200, () => ({
      method: 'GET',
      url: '/organizations?page=1&pageSize=20',
      headers: authHeaders(userToken)
    }))
    await bench('GET /info-systems (1k rows)', 200, () => ({
      method: 'GET',
      url: '/info-systems?page=1&pageSize=20',
      headers: authHeaders(userToken)
    }))
    await bench('GET /personal (10k rows)', 200, () => ({
      method: 'GET',
      url: '/personal?page=1&pageSize=20',
      headers: authHeaders(userToken)
    }))
    await bench('GET /equipment (50k rows)', 200, () => ({
      method: 'GET',
      url: '/equipment?page=1&pageSize=20',
      headers: authHeaders(userToken)
    }))
    await bench('GET /equipment + search (50k)', 200, () => ({
      method: 'GET',
      url: '/equipment?page=1&pageSize=20&search=10',
      headers: authHeaders(userToken)
    }))
    await bench('GET /equipment last page (50k)', 200, () => ({
      method: 'GET',
      url: '/equipment?page=2500&pageSize=20',
      headers: authHeaders(userToken)
    }))
    await bench('GET /software (50k rows)', 200, () => ({
      method: 'GET',
      url: '/software?page=1&pageSize=20',
      headers: authHeaders(userToken)
    }))
    await bench('GET /security-tools (10k rows)', 200, () => ({
      method: 'GET',
      url: '/security-tools?page=1&pageSize=20',
      headers: authHeaders(userToken)
    }))
    await bench('GET /threat-models (5k rows)', 200, () => ({
      method: 'GET',
      url: '/threat-models?page=1&pageSize=20',
      headers: authHeaders(userToken)
    }))
    await bench('GET /inn-registry (100k rows)', 100, () => ({
      method: 'GET',
      url: '/inn-registry',
      headers: authHeaders(userToken)
    }))
    await bench('GET /registry (20k docs)', 200, () => ({
      method: 'GET',
      url: '/registry?page=1&pageSize=20',
      headers: authHeaders(userToken)
    }))
    await bench('GET /audit admin (10k rows)', 100, () => ({
      method: 'GET',
      url: '/audit?page=1&pageSize=50',
      headers: authHeaders(adminToken)
    }))
    await bench('GET /statistics admin', 50, () => ({
      method: 'GET',
      url: '/statistics',
      headers: authHeaders(adminToken)
    }))
  }, 120_000)

  it('detail endpoints — by-id lookup at scale', async () => {
    console.log('\n== Sequential get-by-id bench ==')
    await bench('GET /organizations/:id (200)', 500, (i) => ({
      method: 'GET',
      url: `/organizations/bench-org-${i % ORG_COUNT}`,
      headers: authHeaders(userToken)
    }))
    await bench('GET /equipment/:id (50k)', 500, (i) => ({
      method: 'GET',
      url: `/equipment/bench-eq-${i % ORG_COUNT}-${i % EQUIPMENT_PER_ORG}`,
      headers: authHeaders(userToken)
    }))
    await bench('GET /personal/:id (10k)', 500, (i) => ({
      method: 'GET',
      url: `/personal/bench-pers-${i % ORG_COUNT}-${i % PERSONAL_PER_ORG}`,
      headers: authHeaders(userToken)
    }))
    await bench('GET /software/:id (50k)', 500, (i) => ({
      method: 'GET',
      url: `/software/bench-sw-${i % ORG_COUNT}-${i % SOFTWARE_PER_ORG}`,
      headers: authHeaders(userToken)
    }))
    await bench('GET /threat-models/:id (5k)', 500, (i) => ({
      method: 'GET',
      url: `/threat-models/bench-tm-${i % ORG_COUNT}-${i % THREATS_PER_ORG}`,
      headers: authHeaders(userToken)
    }))
  }, 120_000)

  it('concurrent: 50 workers x 20 requests = 1000 calls', async () => {
    console.log('\n== Concurrent (mixed read) ==')
    await concurrentBench('GET /equipment (50k)', 50, 20, () => ({
      method: 'GET',
      url: '/equipment?page=1&pageSize=20',
      headers: authHeaders(userToken)
    }))
    await concurrentBench('GET /software (50k)', 50, 20, () => ({
      method: 'GET',
      url: '/software?page=1&pageSize=20',
      headers: authHeaders(userToken)
    }))
    await concurrentBench('GET /personal (10k)', 50, 20, () => ({
      method: 'GET',
      url: '/personal?page=1&pageSize=20',
      headers: authHeaders(userToken)
    }))
    await concurrentBench('GET /threat-models (5k)', 50, 20, () => ({
      method: 'GET',
      url: '/threat-models?page=1&pageSize=20',
      headers: authHeaders(userToken)
    }))
    await concurrentBench('GET /audit (10k)', 50, 20, () => ({
      method: 'GET',
      url: '/audit?page=1&pageSize=50',
      headers: authHeaders(adminToken)
    }))
  }, 180_000)
})
