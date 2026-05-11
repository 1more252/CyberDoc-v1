// ===========================================================================
// scripts/seed-one-org.mjs
//
// Заполняет ОДНУ организацию полностью через HTTP API — как если бы пользователь
// прошёл все формы фронта от начала до конца.
//
// Что создаётся:
//   1) admin: 6 элементов каталога СЗИ ФСТЭК (по одному на каждую категорию)
//   2) user: организация → ИС (2 шт.) → персонал (5) → ПО (6) → оборудование (5)
//      → экземпляры СЗИ (3) → модель угроз (1, на ИСПДн) → документы (3)
//      → пакет ОРД (1, по шаблону «Минимальный комплект ИСПДн»)
//
// Запуск:
//   npm run server        # в одном окне
//   node scripts/seed-one-org.mjs   # в другом
//
// Идемпотентность: НЕТ. Скрипт каждый раз создаёт новые сущности. Для чистого
// прогона предварительно удалите data/app.db (или остановите сервер и сотрите).
// ===========================================================================

const HOST = process.env.SEED_HOST || 'http://127.0.0.1:3001'

async function api(method, path, { token, body } = {}) {
  const r = await fetch(`${HOST}/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await r.text()
  let json
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text } }
  if (!r.ok) {
    const msg = json?.error || json?.message || r.statusText
    throw new Error(`${method} ${path} → ${r.status} ${msg}`)
  }
  return json
}

async function login(username, password) {
  const { token } = await api('POST', '/auth/login', { body: { username, password } })
  return token
}

function log(stage, ...rest) {
  console.log(`  ${stage.padEnd(28)}`, ...rest)
}

// --- 1. CATALOG SЗИ (admin) -------------------------------------------------

const SZI_CATALOG = [
  { kindId: 'av',             name: 'Kaspersky Endpoint Security для бизнеса',  vendor: 'АО «Лаборатория Касперского»', certNumber: 'ФСТЭК № 3025', certClass: 'СЗИ от НСД 4 кл., НДВ 2', certDate: '2018-03-15', certExpiry: '2027-03-15', description: 'Антивирус + EDR-функции, контроль приложений.' },
  { kindId: 'fw',             name: 'Континент 4',                              vendor: 'АО «Информзащита»',            certNumber: 'ФСТЭК № 3852', certClass: 'МЭ типа А, тип Б — 4 кл.',  certDate: '2020-04-10', certExpiry: '2028-04-10', description: 'Сертифицированный межсетевой экран и СКЗИ.' },
  { kindId: 'ids',            name: 'PT Network Attack Discovery',              vendor: 'АО «Позитив Текнолоджиз»',     certNumber: 'ФСТЭК № 4196', certClass: 'СОВ 4 кл.',                certDate: '2021-11-08', certExpiry: '2029-11-08', description: 'Система обнаружения сетевых атак (NTA/IDS).' },
  { kindId: 'crypto',         name: 'КриптоПро CSP',                            vendor: 'ООО «КРИПТО-ПРО»',             certNumber: 'ФСБ СФ/124-3984', certClass: 'СКЗИ КС1, КС2',         certDate: '2020-06-30', certExpiry: '2026-06-30', description: 'Криптопровайдер для ЭП и шифрования по ГОСТ.' },
  { kindId: 'access_control', name: 'Secret Net Studio',                        vendor: 'АО «Код Безопасности»',        certNumber: 'ФСТЭК № 3675', certClass: 'СЗИ от НСД 4 кл., НДВ 2',  certDate: '2019-08-15', certExpiry: '2027-08-15', description: 'Контроль доступа, мандатная и дискреционная защита.' },
  { kindId: 'siem',           name: 'MaxPatrol SIEM',                           vendor: 'АО «Позитив Текнолоджиз»',     certNumber: 'ФСТЭК № 4347', certClass: 'СЗИ 4 кл.',                certDate: '2022-03-22', certExpiry: '2030-03-22', description: 'Система мониторинга событий ИБ.' }
]

// --- 2. USER PIPELINE -------------------------------------------------------

const ORG = {
  kind: 'ul',
  name: 'ООО «Технологии Будущего»',
  inn: '7707083893',
  ogrn: '1027700132195',
  kpp: '770701001',
  address: 'г. Москва, ул. Тверская, 7, офис 304',
  phone: '+7 495 777-00-01',
  email: 'office@futuretech.example',
  notes: 'Демонстрационная организация — заполнено через seed-one-org.mjs'
}

const PERSONAL = [
  { lastName: 'Иванов',    firstName: 'Иван',    middleName: 'Иванович',    position: 'Системный администратор',       department: 'ИТ-отдел',    phone: '+7 495 777-00-11', email: 'ivanov@futuretech.example',    hasAdminRights: true },
  { lastName: 'Петрова',   firstName: 'Мария',   middleName: 'Сергеевна',   position: 'Главный бухгалтер',             department: 'Бухгалтерия', phone: '+7 495 777-00-12', email: 'petrova@futuretech.example',   hasAdminRights: false },
  { lastName: 'Соколов',   firstName: 'Алексей', middleName: 'Викторович',  position: 'Ответственный за защиту ПДн',   department: 'ИТ-отдел',    phone: '+7 495 777-00-13', email: 'sokolov@futuretech.example',   hasAdminRights: true },
  { lastName: 'Кузнецова', firstName: 'Анна',    middleName: 'Дмитриевна',  position: 'Менеджер по работе с клиентами', department: 'Продажи',     phone: '+7 495 777-00-14', email: 'kuznetsova@futuretech.example', hasAdminRights: false },
  { lastName: 'Орлов',     firstName: 'Дмитрий', middleName: 'Александрович', position: 'Руководитель отдела',          department: 'Руководство', phone: '+7 495 777-00-15', email: 'orlov@futuretech.example',     hasAdminRights: false }
]

const SOFTWARE = (is1, is2) => [
  { organizationId: null, infoSystemId: is1, category: 'system',      kindId: 'os',          name: 'Astra Linux Special Edition',  version: '1.7.5',       vendor: 'РусБИТех-Астра',          licenseType: 'commercial',  licenseInfo: 'Лицензия №AL-2024-0142, 5 узлов', installPath: '/',                  notes: 'Сертификат ФСТЭК на УД4' },
  { organizationId: null, infoSystemId: is1, category: 'system',      kindId: 'dbms',        name: 'PostgreSQL Pro Standard',      version: '15.4',        vendor: 'Postgres Professional',  licenseType: 'commercial',  licenseInfo: 'Подписка до 2027-01-01, 4 ядра',  installPath: '/var/lib/postgres',  notes: '' },
  { organizationId: null, infoSystemId: is1, category: 'application', kindId: 'business',    name: '1С: Бухгалтерия предприятия',  version: '3.0.142.62',  vendor: '1С',                     licenseType: 'commercial',  licenseInfo: 'ПРОФ, 10 мест, ИТС до 2026-12-31', installPath: 'C:\\Program Files\\1cv8', notes: '' },
  { organizationId: null, infoSystemId: is2, category: 'application', kindId: 'office',      name: 'МойОфис Стандартный',          version: '2024.02',     vendor: 'Новые облачные технологии', licenseType: 'subscription', licenseInfo: '50 пользователей, до 2026-09-01', installPath: '',                   notes: '' },
  { organizationId: null, infoSystemId: is2, category: 'system',      kindId: 'os',          name: 'Windows Server 2022',          version: '21H2',        vendor: 'Microsoft',              licenseType: 'oem',         licenseInfo: 'OEM-лицензия, поставка с сервером', installPath: 'C:\\Windows',         notes: '' },
  { organizationId: null, infoSystemId: '',  category: 'system',      kindId: 'system_util', name: 'Acronis Cyber Protect',        version: '15',          vendor: 'Acronis',                licenseType: 'subscription', licenseInfo: 'Backup, 10 узлов, до 2026-04-30', installPath: '',                  notes: 'Резервное копирование' }
]

const EQUIPMENT = (is1, is2) => [
  { name: 'Сервер 1С',                  kind: 'server',  model: 'Dell PowerEdge R740',  manufacturer: 'Dell',     serial: 'DPE-R740-0007', inventoryNumber: 'INV-S-001', yearMade: 2022, location: 'Серверная, стойка А1',   status: 'active', infoSystemId: is1, notes: '2× Xeon, 128 ГБ RAM, RAID-10' },
  { name: 'Коммутатор ядра',            kind: 'network', model: 'Cisco Catalyst 9300',  manufacturer: 'Cisco',    serial: 'CC9300-0049',   inventoryNumber: 'INV-N-002', yearMade: 2021, location: 'Серверная, стойка А1',   status: 'active', infoSystemId: is2, notes: '24×1G + 4×10G uplink' },
  { name: 'АРМ бухгалтера',             kind: 'pc',      model: 'HP ProDesk 400 G7',    manufacturer: 'HP',       serial: 'PD400-9921',    inventoryNumber: 'INV-W-003', yearMade: 2023, location: 'Кабинет 204',            status: 'active', infoSystemId: is1, notes: '' },
  { name: 'МФУ бухгалтерия',            kind: 'printer', model: 'Kyocera M2540dn',      manufacturer: 'Kyocera',  serial: 'KM2540-7711',   inventoryNumber: 'INV-P-004', yearMade: 2020, location: 'Кабинет 204',            status: 'repair', infoSystemId: '',  notes: 'Замятие бумаги' },
  { name: 'Ноутбук руководителя',       kind: 'pc',      model: 'Lenovo ThinkPad T14',  manufacturer: 'Lenovo',   serial: 'LT14-3399',     inventoryNumber: 'INV-W-005', yearMade: 2024, location: 'Кабинет 301',            status: 'active', infoSystemId: '',  notes: 'Только для руководителя' }
]

// --- main -------------------------------------------------------------------

async function main() {
  console.log('▶ seed-one-org → fully populate one organization via API')
  console.log(`  host: ${HOST}\n`)

  // 1) admin: каталог СЗИ
  console.log('[1] admin: каталог СЗИ ФСТЭК')
  const adminToken = await login('admin', 'admin123')
  const catalogIds = []
  for (const item of SZI_CATALOG) {
    const r = await api('POST', '/security-tools-catalog', { token: adminToken, body: item })
    catalogIds.push(r.id)
    log(`+ ${item.kindId}`, r.name)
  }

  // 2) user: организация
  console.log('\n[2] user: организация')
  const userToken = await login('user', 'user123')
  const org = await api('POST', '/organizations', { token: userToken, body: ORG })
  log('+ organization', org.name, `(${org.id})`)

  // 3) ИС: ИСПДн + АС
  console.log('\n[3] user: информационные системы')
  const is1 = await api('POST', '/info-systems', {
    token: userToken,
    body: {
      organizationId: org.id,
      name: 'ИС «Бухгалтерия 1С»',
      typeId: 'isp_dn',
      regimId: 'multi_user_diff_rights',
      strukId: 'lan',
      inetId: 'controlled',
      codId: 'own',
      classification: 'УЗ-3',
      purpose: 'Ведение бухгалтерского и налогового учёта, расчёт зарплаты',
      address: 'г. Москва, ул. Тверская, 7, серверная',
      hasPdn: true,
      pdnSubjectsCount: 180,
      status: 'active'
    }
  })
  log('+ info-system 1', is1.name, `(${is1.id})`)

  const is2 = await api('POST', '/info-systems', {
    token: userToken,
    body: {
      organizationId: org.id,
      name: 'ИС «Корпоративный портал»',
      typeId: 'as',
      regimId: 'multi_user_same_rights',
      strukId: 'lan',
      inetId: 'controlled',
      codId: 'own',
      classification: 'К3',
      purpose: 'Внутренний документооборот, новости, справочники',
      address: 'г. Москва, ул. Тверская, 7, серверная',
      hasPdn: false,
      status: 'active'
    }
  })
  log('+ info-system 2', is2.name, `(${is2.id})`)

  // 4) Персонал
  console.log('\n[4] user: персонал')
  const personIds = []
  for (const p of PERSONAL) {
    const r = await api('POST', '/personal', {
      token: userToken,
      body: { ...p, organizationId: org.id }
    })
    personIds.push(r.id)
    log('+ person', `${p.lastName} ${p.firstName}`, `(${r.id})`)
  }

  // 5) ПО
  console.log('\n[5] user: программное обеспечение')
  for (const s of SOFTWARE(is1.id, is2.id)) {
    const r = await api('POST', '/software', {
      token: userToken,
      body: { ...s, organizationId: org.id }
    })
    log('+ software', `${s.category}/${s.kindId}`, r.name)
  }

  // 6) Оборудование
  console.log('\n[6] user: оборудование')
  for (const e of EQUIPMENT(is1.id, is2.id)) {
    const r = await api('POST', '/equipment', {
      token: userToken,
      body: { ...e, organizationId: org.id }
    })
    log('+ equipment', e.kind, r.name)
  }

  // 7) Экземпляры СЗИ (привязка к каталогу)
  console.log('\n[7] user: экземпляры СЗИ')
  const stInstances = [
    { catalogId: catalogIds[0], infoSystemId: is1.id, responsiblePersonId: personIds[2], serialNumber: 'KES-2025-0001', licenseKey: 'XXXX-YYYY-ZZZZ-AAAA', licenseExpiresAt: '2026-09-01', deployedAt: '2024-09-15', notes: 'Установлен на 25 АРМ + сервер 1С' },
    { catalogId: catalogIds[1], infoSystemId: is1.id, responsiblePersonId: personIds[0], serialNumber: 'KONT-12345',     licenseKey: '',                       licenseExpiresAt: '2028-04-10', deployedAt: '2024-04-20', notes: 'Шлюз периметра + VPN' },
    { catalogId: catalogIds[3], infoSystemId: is2.id, responsiblePersonId: personIds[1], serialNumber: 'CP-EM-9911',     licenseKey: 'CP-2025-LICKEY-1234',    licenseExpiresAt: '2027-01-01', deployedAt: '2025-01-15', notes: 'ЭП для отчётности' }
  ]
  for (const s of stInstances) {
    const r = await api('POST', '/security-tools', {
      token: userToken,
      body: { ...s, organizationId: org.id, status: 'active' }
    })
    log('+ szi instance', r.serialNumber)
  }

  // 8) Модель угроз для ИСПДн
  console.log('\n[8] user: модель угроз')
  const tm = await api('POST', '/threat-models', {
    token: userToken,
    body: {
      infoSystemId: is1.id,
      name: 'Модель угроз ИС «Бухгалтерия 1С»',
      status: 'finalized',
      intruder: {
        type: 'mixed',
        potential: 'basic',
        capabilities: ['network_access', 'user_account'],
        motivation: 'Получение конкурентной информации; финансовые злоупотребления.'
      },
      threats: [
        { catalogId: 'ubi-034', probability: 'high', damage: 'high', isRelevant: true,
          justification: 'Веб-интерфейс публично доступен, история инцидентов в отрасли подтверждает регулярные атаки.',
          mitigation: 'WAF, SAST/DAST в CI, регулярный пен-тест.' },
        { catalogId: 'ubi-111', probability: 'high', damage: 'high', isRelevant: true,
          justification: 'Бухгалтер имеет доступ к полному набору ПДн и финансовых данных.',
          mitigation: 'DLP, мониторинг копирования на USB, ограничение прав по роли.' },
        { catalogId: 'ubi-195', probability: 'high', damage: 'high', isRelevant: true,
          justification: 'Финансовый профиль сотрудников делает их типичной целью фишинга.',
          mitigation: 'Антиспам, регулярные тренинги, MFA.' },
        { catalogId: 'ubi-205', probability: 'high', damage: 'high', isRelevant: true,
          justification: 'Сервер 1С хранит критические для бизнеса данные.',
          mitigation: 'EDR, регулярные резервные копии в изолированное хранилище.' }
      ],
      conclusion: 'Из 25 рассмотренных угроз 4 признаны актуальными. Меры защиты соответствуют требованиям приказа ФСТЭК № 21.'
    }
  })
  log('+ threat-model', tm.name, `(${tm.threats.length} угроз)`)

  // 9) Документы
  console.log('\n[9] user: документы')
  for (const d of [
    { title: 'Акт ввода в эксплуатацию сервера 1С', type: 'act',      number: 'А-001/2026', date: '2026-04-12', content: 'Настоящим актом подтверждается ввод в эксплуатацию сервера Dell PowerEdge R740 (S/N DPE-R740-0007).' },
    { title: 'Заявка на ремонт МФУ',                type: 'order',    number: 'З-014/2026', date: '2026-05-01', content: 'Прошу направить специалиста для устранения замятия бумаги в МФУ Kyocera M2540dn.' },
    { title: 'Протокол инвентаризации',             type: 'protocol', number: 'П-002/2026', date: '2026-05-03', content: 'Проведена инвентаризация технических средств. Расхождений не выявлено.' }
  ]) {
    const r = await api('POST', '/registry', { token: userToken, body: { ...d, organizationId: org.id } })
    log('+ document', `${d.type}/${d.number}`, r.title)
  }

  // 10) Пакет ОРД
  console.log('\n[10] user: пакет ОРД (генерация)')
  const tplList = await api('GET', '/document-set-templates', { token: userToken })
  const tpl = tplList.items.find((t) => t.name.includes('Минимальный комплект ИСПДн')) || tplList.items[0]
  const ds = await api('POST', '/document-sets', {
    token: userToken,
    body: {
      organizationId: org.id,
      infoSystemId: is1.id,
      templateId: tpl.id,
      filename: `ОРД_Бухгалтерия_${new Date().toISOString().slice(0, 10)}.docx`
    }
  })
  log('+ document-set', tpl.name, `(${ds.sectionsCount} разделов)`)

  console.log('\n✓ done')
}

main().catch((e) => {
  console.error('\n✗ FAILED:', e.message)
  process.exit(1)
})
