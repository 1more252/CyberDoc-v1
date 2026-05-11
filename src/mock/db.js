
export const db = ({
  users: [
    { id: 1, username: 'admin', email: 'admin@example.com', password: 'admin123', role: 'admin', verified: true, blocked: false, createdAt: Date.now() - 86400000 * 60 },
    { id: 2, username: 'expert', email: 'expert@example.com', password: 'expert123', role: 'expert', verified: true, blocked: false, createdAt: Date.now() - 86400000 * 45 },
    { id: 3, username: 'user', email: 'user@example.com', password: 'user123', role: 'user', verified: true, blocked: false, createdAt: Date.now() - 86400000 * 30 },
    { id: 4, username: 'pending_user', email: 'pending@example.com', password: 'pending123', role: 'user', verified: false, blocked: false, createdAt: Date.now() - 86400000 * 2 },
    { id: 5, username: 'blocked_user', email: 'blocked@example.com', password: 'blocked123', role: 'user', verified: true, blocked: true, createdAt: Date.now() - 86400000 * 10 },
    { id: 6, username: 'expert2', email: 'expert2@example.com', password: 'expert2123', role: 'expert', verified: true, blocked: false, createdAt: Date.now() - 86400000 * 7 }
  ],
  refreshTokens: new Map(),
  organizations: [
    {
      id: 'org-seed-1',
      ownerUsername: 'user',
      kind: 'ul',
      name: 'ООО «Ромашка»',
      inn: '7707083893',
      ogrn: '1027700132195',
      kpp: '770701001',
      address: 'г. Москва, ул. Тверская, 1',
      phone: '+7 495 000-00-01',
      email: 'info@romashka.example',
      notes: '',
      createdAt: Date.now() - 86400000 * 7,
      updatedAt: Date.now() - 86400000 * 7
    },
    {
      id: 'org-seed-2',
      ownerUsername: 'user',
      kind: 'ip',
      name: 'ИП Иванов И. И.',
      inn: '500100732259',
      ogrn: '304500116000157',
      kpp: '',
      address: 'Московская обл., г. Подольск, ул. Ленина, 5',
      phone: '+7 495 000-00-02',
      email: '',
      notes: '',
      createdAt: Date.now() - 86400000 * 3,
      updatedAt: Date.now() - 86400000 * 3
    }
  ],
  innRegistry: [],

  // ---- КиберДок: справочники ----
  dictionaries: {
    infoSysType: [
      { id: 'isp_dn', name: 'ИСПДн (информационная система персональных данных)' },
      { id: 'gis', name: 'ГИС (государственная информационная система)' },
      { id: 'kii', name: 'Объект КИИ' },
      { id: 'as', name: 'АС (автоматизированная система)' },
      { id: 'cod', name: 'ЦОД (центр обработки данных)' }
    ],
    answers: [
      { id: 'yes', name: 'Да' },
      { id: 'no', name: 'Нет' },
      { id: 'unknown', name: 'Нет данных' }
    ],
    inet_answers: [
      { id: 'no_inet', name: 'Нет подключения' },
      { id: 'controlled', name: 'Контролируемое подключение через средства защиты' },
      { id: 'direct', name: 'Прямое подключение' }
    ],
    cod_answers: [
      { id: 'own', name: 'Собственный ЦОД' },
      { id: 'rented', name: 'Арендованный ЦОД' },
      { id: 'hybrid', name: 'Гибрид (свой + арендованный)' },
      { id: 'none', name: 'Не используется' }
    ],
    regimIS: [
      { id: 'single_user', name: 'Однопользовательский' },
      { id: 'multi_user_same_rights', name: 'Многопользовательский с равными правами' },
      { id: 'multi_user_diff_rights', name: 'Многопользовательский с разграничением прав' }
    ],
    strukIS: [
      { id: 'standalone', name: 'Автономная (изолированная)' },
      { id: 'lan', name: 'Локальная сеть' },
      { id: 'distributed', name: 'Распределённая (несколько площадок)' }
    ],
    typeArm: [
      { id: 'pc', name: 'ПК / рабочая станция' },
      { id: 'laptop', name: 'Ноутбук' },
      { id: 'thin_client', name: 'Тонкий клиент' },
      { id: 'mobile', name: 'Мобильное устройство' }
    ],
    vidArm: [
      { id: 'stationary', name: 'Стационарное' },
      { id: 'mobile', name: 'Мобильное' }
    ],
    netType: [
      { id: 'lan', name: 'ЛВС' },
      { id: 'wan', name: 'ГВС / WAN' },
      { id: 'vpn', name: 'VPN' },
      { id: 'wifi', name: 'Wi-Fi' }
    ],
    typeSzi: [
      { id: 'av', name: 'Антивирусные средства' },
      { id: 'fw', name: 'Межсетевые экраны' },
      { id: 'ids', name: 'Системы обнаружения вторжений' },
      { id: 'crypto', name: 'Криптографические средства' },
      { id: 'access_control', name: 'Средства контроля доступа' },
      { id: 'siem', name: 'SIEM / журналирование' }
    ],
    typeArch: [
      { id: 'client_server', name: 'Клиент-сервер' },
      { id: 'three_tier', name: 'Трёхзвенная' },
      { id: 'monolith', name: 'Монолитная' },
      { id: 'microservice', name: 'Микросервисная' }
    ],
    typeApp: [
      { id: 'os', name: 'Операционная система' },
      { id: 'office', name: 'Офисное ПО' },
      { id: 'dbms', name: 'СУБД' },
      { id: 'business', name: 'Прикладное (учётное/бизнес)' },
      { id: 'system_util', name: 'Системное / утилиты' }
    ],
    typeKomis: [
      { id: 'internal', name: 'Внутренняя' },
      { id: 'external', name: 'Внешняя' },
      { id: 'mixed', name: 'Смешанная' }
    ]
  },

  // ---- КиберДок: персонал ----
  personal: [
    {
      id: 'pers-seed-1',
      ownerUsername: 'user',
      organizationId: 'org-seed-1',
      lastName: 'Иванов',
      firstName: 'Иван',
      middleName: 'Иванович',
      position: 'Системный администратор',
      department: 'ИТ-отдел',
      phone: '+7 495 000-00-11',
      email: 'ivanov@romashka.example',
      hasAdminRights: true,
      notes: '',
      createdAt: Date.now() - 86400000 * 5,
      updatedAt: Date.now() - 86400000 * 5
    },
    {
      id: 'pers-seed-2',
      ownerUsername: 'user',
      organizationId: 'org-seed-1',
      lastName: 'Петрова',
      firstName: 'Мария',
      middleName: 'Сергеевна',
      position: 'Главный бухгалтер',
      department: 'Бухгалтерия',
      phone: '+7 495 000-00-12',
      email: 'petrova@romashka.example',
      hasAdminRights: false,
      notes: '',
      createdAt: Date.now() - 86400000 * 5,
      updatedAt: Date.now() - 86400000 * 5
    },
    {
      id: 'pers-seed-3',
      ownerUsername: 'user',
      organizationId: 'org-seed-2',
      lastName: 'Иванов',
      firstName: 'Иван',
      middleName: 'Иванович',
      position: 'Индивидуальный предприниматель',
      department: '',
      phone: '+7 495 000-00-02',
      email: '',
      hasAdminRights: true,
      notes: '',
      createdAt: Date.now() - 86400000 * 3,
      updatedAt: Date.now() - 86400000 * 3
    }
  ],

  // ---- КиберДок: информационные системы ----
  infoSystems: [
    {
      id: 'is-seed-1',
      ownerUsername: 'user',
      organizationId: 'org-seed-1',
      name: 'ИС "Бухгалтерия 1С"',
      typeId: 'isp_dn',
      regimId: 'multi_user_diff_rights',
      strukId: 'lan',
      inetId: 'controlled',
      codId: 'own',
      classification: 'УЗ-3',
      purpose: 'Ведение бухгалтерского и налогового учёта',
      address: 'г. Москва, ул. Тверская, 1, серверная',
      operatorName: 'ООО «Ромашка»',
      operatorInn: '7707083893',
      operatorOgrn: '1027700132195',
      hasPdn: true,
      pdnCategories: ['employees', 'counterparties'],
      pdnSubjectsCount: 250,
      kiiCategory: '',
      gisLevel: '',
      notes: '',
      status: 'active',
      createdAt: Date.now() - 86400000 * 6,
      updatedAt: Date.now() - 86400000 * 2
    },
    {
      id: 'is-seed-2',
      ownerUsername: 'user',
      organizationId: 'org-seed-1',
      name: 'ИС "Корпоративный портал"',
      typeId: 'as',
      regimId: 'multi_user_same_rights',
      strukId: 'lan',
      inetId: 'controlled',
      codId: 'own',
      classification: 'К3',
      purpose: 'Внутренний документооборот, новости, справочники',
      address: 'г. Москва, ул. Тверская, 1, серверная',
      operatorName: 'ООО «Ромашка»',
      operatorInn: '7707083893',
      operatorOgrn: '1027700132195',
      hasPdn: false,
      pdnCategories: [],
      pdnSubjectsCount: 0,
      kiiCategory: '',
      gisLevel: '',
      notes: '',
      status: 'active',
      createdAt: Date.now() - 86400000 * 4,
      updatedAt: Date.now() - 86400000 * 4
    }
  ],

  // ---- КиберДок: ПО (системное + прикладное) ----
  software: [
    {
      id: 'sw-seed-1',
      ownerUsername: 'user',
      organizationId: 'org-seed-1',
      infoSystemId: 'is-seed-1',
      category: 'system',
      kindId: 'os',
      name: 'Astra Linux Special Edition 1.7',
      version: '1.7.5',
      vendor: 'РусБИТех-Астра',
      licenseType: 'commercial',
      licenseInfo: 'Лицензия №AL-2024-0142, бессрочная, 5 узлов',
      installPath: '/',
      notes: 'Сертификат ФСТЭК на УД4',
      createdAt: Date.now() - 86400000 * 6,
      updatedAt: Date.now() - 86400000 * 6
    },
    {
      id: 'sw-seed-2',
      ownerUsername: 'user',
      organizationId: 'org-seed-1',
      infoSystemId: 'is-seed-1',
      category: 'system',
      kindId: 'dbms',
      name: 'PostgreSQL Pro Standard',
      version: '15.4',
      vendor: 'Postgres Professional',
      licenseType: 'commercial',
      licenseInfo: 'Подписка до 2027-01-01, 4 ядра',
      installPath: '/var/lib/postgres',
      notes: '',
      createdAt: Date.now() - 86400000 * 6,
      updatedAt: Date.now() - 86400000 * 6
    },
    {
      id: 'sw-seed-3',
      ownerUsername: 'user',
      organizationId: 'org-seed-1',
      infoSystemId: 'is-seed-1',
      category: 'application',
      kindId: 'business',
      name: '1С: Бухгалтерия предприятия',
      version: '3.0.142.62',
      vendor: '1С',
      licenseType: 'commercial',
      licenseInfo: 'ПРОФ, 10 рабочих мест, ИТС до 2026-12-31',
      installPath: 'C:\\Program Files\\1cv8',
      notes: '',
      createdAt: Date.now() - 86400000 * 5,
      updatedAt: Date.now() - 86400000 * 5
    },
    {
      id: 'sw-seed-4',
      ownerUsername: 'user',
      organizationId: 'org-seed-1',
      infoSystemId: 'is-seed-2',
      category: 'application',
      kindId: 'office',
      name: 'МойОфис Стандартный',
      version: '2024.02',
      vendor: 'Новые облачные технологии',
      licenseType: 'commercial',
      licenseInfo: '50 пользователей, до 2026-09-01',
      installPath: '',
      notes: '',
      createdAt: Date.now() - 86400000 * 4,
      updatedAt: Date.now() - 86400000 * 4
    },
    {
      id: 'sw-seed-5',
      ownerUsername: 'user',
      organizationId: 'org-seed-2',
      infoSystemId: '',
      category: 'system',
      kindId: 'os',
      name: 'Эвотор OS',
      version: '5.2',
      vendor: 'Эвотор',
      licenseType: 'oem',
      licenseInfo: 'Поставляется с устройством',
      installPath: '',
      notes: '',
      createdAt: Date.now() - 86400000 * 2,
      updatedAt: Date.now() - 86400000 * 2
    }
  ],

  // ---- КиберДок: каталог СЗИ (ФСТЭК) ----
  securityToolsCatalog: [
    {
      id: 'stc-seed-1',
      kindId: 'av',
      name: 'Kaspersky Endpoint Security для Windows',
      vendor: 'АО «Лаборатория Касперского»',
      certNumber: 'ФСТЭК № 3025',
      certClass: 'СЗИ от НСД 4 кл., НДВ 2',
      certDate: '2018-03-15',
      certExpiry: '2027-03-15',
      description: 'Антивирус + EDR-функции, СЗИ от НСД, контроль приложений.',
      createdAt: Date.now() - 86400000 * 30,
      updatedAt: Date.now() - 86400000 * 30
    },
    {
      id: 'stc-seed-2',
      kindId: 'av',
      name: 'Dr.Web Enterprise Security Suite',
      vendor: 'ООО «Доктор Веб»',
      certNumber: 'ФСТЭК № 3509',
      certClass: 'СЗИ от НСД 4 кл.',
      certDate: '2019-06-01',
      certExpiry: '2027-06-01',
      description: 'Корпоративный антивирус с центральной консолью.',
      createdAt: Date.now() - 86400000 * 30,
      updatedAt: Date.now() - 86400000 * 30
    },
    {
      id: 'stc-seed-3',
      kindId: 'fw',
      name: 'Континент 4',
      vendor: 'АО «Информзащита»',
      certNumber: 'ФСТЭК № 3852',
      certClass: 'МЭ типа А, тип Б — 4 кл.',
      certDate: '2020-04-10',
      certExpiry: '2028-04-10',
      description: 'Сертифицированный межсетевой экран и СКЗИ.',
      createdAt: Date.now() - 86400000 * 30,
      updatedAt: Date.now() - 86400000 * 30
    },
    {
      id: 'stc-seed-4',
      kindId: 'fw',
      name: 'UserGate UTM',
      vendor: 'ООО «Юзергейт»',
      certNumber: 'ФСТЭК № 3905',
      certClass: 'МЭ типа А — 4 кл., СОВ 4 кл.',
      certDate: '2020-09-22',
      certExpiry: '2028-09-22',
      description: 'NGFW, IDS/IPS, контентная фильтрация.',
      createdAt: Date.now() - 86400000 * 30,
      updatedAt: Date.now() - 86400000 * 30
    },
    {
      id: 'stc-seed-5',
      kindId: 'ids',
      name: 'PT Network Attack Discovery',
      vendor: 'АО «Позитив Текнолоджиз»',
      certNumber: 'ФСТЭК № 4196',
      certClass: 'СОВ 4 кл.',
      certDate: '2021-11-08',
      certExpiry: '2029-11-08',
      description: 'Система обнаружения сетевых атак (NTA/IDS).',
      createdAt: Date.now() - 86400000 * 30,
      updatedAt: Date.now() - 86400000 * 30
    },
    {
      id: 'stc-seed-6',
      kindId: 'ids',
      name: 'Kaspersky Anti Targeted Attack',
      vendor: 'АО «Лаборатория Касперского»',
      certNumber: 'ФСТЭК № 4019',
      certClass: 'СОВ 4 кл.',
      certDate: '2021-05-19',
      certExpiry: '2029-05-19',
      description: 'Платформа защиты от целевых атак (APT).',
      createdAt: Date.now() - 86400000 * 30,
      updatedAt: Date.now() - 86400000 * 30
    },
    {
      id: 'stc-seed-7',
      kindId: 'crypto',
      name: 'КриптоПро CSP',
      vendor: 'ООО «КРИПТО-ПРО»',
      certNumber: 'ФСБ СФ/124-3984',
      certClass: 'СКЗИ КС1, КС2',
      certDate: '2020-06-30',
      certExpiry: '2026-06-30',
      description: 'Криптопровайдер для электронной подписи и шифрования.',
      createdAt: Date.now() - 86400000 * 30,
      updatedAt: Date.now() - 86400000 * 30
    },
    {
      id: 'stc-seed-8',
      kindId: 'crypto',
      name: 'ViPNet CSP',
      vendor: 'АО «ИнфоТеКС»',
      certNumber: 'ФСБ СФ/124-3866',
      certClass: 'СКЗИ КС1, КС2',
      certDate: '2019-12-02',
      certExpiry: '2026-12-02',
      description: 'Криптопровайдер ViPNet для ЭЦП по ГОСТ.',
      createdAt: Date.now() - 86400000 * 30,
      updatedAt: Date.now() - 86400000 * 30
    },
    {
      id: 'stc-seed-9',
      kindId: 'access_control',
      name: 'Secret Net Studio',
      vendor: 'АО «Код Безопасности»',
      certNumber: 'ФСТЭК № 3675',
      certClass: 'СЗИ от НСД 4 кл., НДВ 2',
      certDate: '2019-08-15',
      certExpiry: '2027-08-15',
      description: 'Контроль доступа, мандатная и дискреционная защита, замкнутая программная среда.',
      createdAt: Date.now() - 86400000 * 30,
      updatedAt: Date.now() - 86400000 * 30
    },
    {
      id: 'stc-seed-10',
      kindId: 'access_control',
      name: 'Dallas Lock 8.0-K',
      vendor: 'ООО «Конфидент»',
      certNumber: 'ФСТЭК № 2737',
      certClass: 'СЗИ от НСД 5 кл., НДВ 4',
      certDate: '2017-10-10',
      certExpiry: '2026-10-10',
      description: 'СЗИ от НСД для ИСПДн 1–4 уровня защищённости.',
      createdAt: Date.now() - 86400000 * 30,
      updatedAt: Date.now() - 86400000 * 30
    },
    {
      id: 'stc-seed-11',
      kindId: 'siem',
      name: 'MaxPatrol SIEM',
      vendor: 'АО «Позитив Текнолоджиз»',
      certNumber: 'ФСТЭК № 4347',
      certClass: 'СЗИ 4 кл.',
      certDate: '2022-03-22',
      certExpiry: '2030-03-22',
      description: 'Система мониторинга событий ИБ.',
      createdAt: Date.now() - 86400000 * 30,
      updatedAt: Date.now() - 86400000 * 30
    },
    {
      id: 'stc-seed-12',
      kindId: 'siem',
      name: 'KOMRAD Enterprise SIEM',
      vendor: 'АО «НПО «Эшелон»',
      certNumber: 'ФСТЭК № 4029',
      certClass: 'СЗИ 4 кл.',
      certDate: '2021-07-14',
      certExpiry: '2029-07-14',
      description: 'SIEM с интеграцией российских СЗИ.',
      createdAt: Date.now() - 86400000 * 30,
      updatedAt: Date.now() - 86400000 * 30
    }
  ],

  // ---- КиберДок: экземпляры СЗИ у организации ----
  securityTools: [
    {
      id: 'st-seed-1',
      ownerUsername: 'user',
      organizationId: 'org-seed-1',
      infoSystemId: 'is-seed-1',
      catalogId: 'stc-seed-1',
      serialNumber: 'KES-RU-2024-0001',
      licenseKey: 'XXXX-YYYY-ZZZZ-AAAA',
      licenseExpiresAt: '2026-09-01',
      deployedAt: '2024-09-15',
      status: 'active',
      responsiblePersonId: 'pers-seed-1',
      notes: 'Установлен на 25 АРМ + сервер 1С',
      createdAt: Date.now() - 86400000 * 5,
      updatedAt: Date.now() - 86400000 * 5
    },
    {
      id: 'st-seed-2',
      ownerUsername: 'user',
      organizationId: 'org-seed-1',
      infoSystemId: 'is-seed-1',
      catalogId: 'stc-seed-3',
      serialNumber: 'KONT-12345',
      licenseKey: '',
      licenseExpiresAt: '2028-04-10',
      deployedAt: '2024-04-20',
      status: 'active',
      responsiblePersonId: 'pers-seed-1',
      notes: 'Шлюз периметра + VPN',
      createdAt: Date.now() - 86400000 * 5,
      updatedAt: Date.now() - 86400000 * 5
    },
    {
      id: 'st-seed-3',
      ownerUsername: 'user',
      organizationId: 'org-seed-1',
      infoSystemId: 'is-seed-2',
      catalogId: 'stc-seed-7',
      serialNumber: 'CP-EM-9911',
      licenseKey: 'CP-2025-LICKEY-1234',
      licenseExpiresAt: '2027-01-01',
      deployedAt: '2025-01-15',
      status: 'active',
      responsiblePersonId: 'pers-seed-2',
      notes: 'ЭЦП для отчётности',
      createdAt: Date.now() - 86400000 * 4,
      updatedAt: Date.now() - 86400000 * 4
    }
  ],

  equipment: [
    {
      id: 'eq-seed-1',
      ownerUsername: 'user',
      organizationId: 'org-seed-1',
      infoSystemId: 'is-seed-1',
      name: 'Сервер хранения',
      kind: 'server',
      model: 'Dell PowerEdge R740',
      manufacturer: 'Dell',
      serial: 'DPE-R740-0001',
      inventoryNumber: 'INV-001',
      yearMade: 2022,
      location: 'Серверная, стойка А1',
      status: 'active',
      notes: '',
      createdAt: Date.now() - 86400000 * 5,
      updatedAt: Date.now() - 86400000 * 5
    },
    {
      id: 'eq-seed-2',
      ownerUsername: 'user',
      organizationId: 'org-seed-1',
      infoSystemId: 'is-seed-2',
      name: 'Коммутатор ядра',
      kind: 'network',
      model: 'Cisco Catalyst 9300',
      manufacturer: 'Cisco',
      serial: 'CC9300-0042',
      inventoryNumber: 'INV-002',
      yearMade: 2021,
      location: 'Серверная, стойка А1',
      status: 'active',
      notes: '24 порта 1G, 4× 10G uplink',
      createdAt: Date.now() - 86400000 * 5,
      updatedAt: Date.now() - 86400000 * 5
    },
    {
      id: 'eq-seed-3',
      ownerUsername: 'user',
      organizationId: 'org-seed-1',
      infoSystemId: '',
      name: 'МФУ бухгалтерия',
      kind: 'printer',
      model: 'Kyocera M2540dn',
      manufacturer: 'Kyocera',
      serial: 'KM2540-7711',
      inventoryNumber: 'INV-003',
      yearMade: 2020,
      location: 'Кабинет 204',
      status: 'repair',
      notes: 'Замятие бумаги',
      createdAt: Date.now() - 86400000 * 4,
      updatedAt: Date.now() - 86400000
    },
    {
      id: 'eq-seed-4',
      ownerUsername: 'user',
      organizationId: 'org-seed-2',
      infoSystemId: '',
      name: 'Кассовый терминал',
      kind: 'pos',
      model: 'Эвотор 7.2',
      manufacturer: 'Эвотор',
      serial: 'EV72-1183',
      inventoryNumber: 'IP-001',
      yearMade: 2023,
      location: 'Торговый зал',
      status: 'active',
      notes: '',
      createdAt: Date.now() - 86400000 * 2,
      updatedAt: Date.now() - 86400000 * 2
    }
  ],
  documents: [
    {
      id: 'doc-seed-1',
      ownerUsername: 'user',
      organizationId: 'org-seed-1',
      equipmentId: 'eq-seed-1',
      title: 'Акт ввода в эксплуатацию сервера хранения',
      type: 'act',
      number: 'А-001/2026',
      date: '2026-04-12',
      content:
        'Настоящим актом подтверждается ввод в эксплуатацию сервера Dell PowerEdge R740 (S/N DPE-R740-0001).\nОборудование размещено в серверной, стойка А1.',
      status: 'approved',
      reviewedBy: 'expert',
      reviewedAt: Date.now() - 86400000 * 2,
      reviewComment: '',
      createdAt: Date.now() - 86400000 * 4,
      updatedAt: Date.now() - 86400000 * 2
    },
    {
      id: 'doc-seed-2',
      ownerUsername: 'user',
      organizationId: 'org-seed-1',
      equipmentId: 'eq-seed-3',
      title: 'Заявка на ремонт МФУ',
      type: 'order',
      number: 'З-014/2026',
      date: '2026-05-01',
      content:
        'Прошу направить специалиста для устранения замятия бумаги в МФУ Kyocera M2540dn (инв. INV-003), кабинет 204.',
      status: 'pending',
      reviewedBy: '',
      reviewedAt: null,
      reviewComment: '',
      createdAt: Date.now() - 86400000 * 1,
      updatedAt: Date.now() - 86400000 * 1
    },
    {
      id: 'doc-seed-3',
      ownerUsername: 'user',
      organizationId: 'org-seed-2',
      equipmentId: '',
      title: 'Протокол инвентаризации',
      type: 'protocol',
      number: 'П-002/2026',
      date: '2026-05-03',
      content: 'Проведена инвентаризация торгового оборудования. Расхождений не выявлено.',
      status: 'draft',
      reviewedBy: '',
      reviewedAt: null,
      reviewComment: '',
      createdAt: Date.now() - 3600000 * 5,
      updatedAt: Date.now() - 3600000 * 5
    }
  ],
  // ---- КиберДок: каталог угроз (имитация БДУ ФСТЭК) ----
  threatsCatalog: [
    { id: 'ubi-010', code: 'УБИ.010', category: 'access', name: 'Угроза доступа к защищаемым файлам с использованием обходного пути',
      description: 'Несанкционированный доступ к файлам в обход штатных механизмов ОС.',
      defaultProbability: 'medium', defaultDamage: 'high' },
    { id: 'ubi-022', code: 'УБИ.022', category: 'malware', name: 'Угроза избыточного выделения оперативной памяти вредоносной программой',
      description: 'Исчерпание ресурсов узла из-за неконтролируемого расхода RAM ВПО.',
      defaultProbability: 'low', defaultDamage: 'medium' },
    { id: 'ubi-034', code: 'УБИ.034', category: 'access', name: 'Угроза использования слабостей кодирования входных данных',
      description: 'Эксплуатация уязвимостей валидации (SQL-инъекции, XSS, command injection).',
      defaultProbability: 'high', defaultDamage: 'high' },
    { id: 'ubi-044', code: 'УБИ.044', category: 'access', name: 'Угроза нарушения изоляции пользовательских данных внутри ВМ',
      description: 'Утечка данных между гостями виртуальной инфраструктуры.',
      defaultProbability: 'low', defaultDamage: 'high' },
    { id: 'ubi-062', code: 'УБИ.062', category: 'insider', name: 'Угроза несанкционированного изменения параметров настройки СЗИ',
      description: 'Привилегированный пользователь меняет настройки СЗИ без согласования.',
      defaultProbability: 'medium', defaultDamage: 'high' },
    { id: 'ubi-067', code: 'УБИ.067', category: 'insider', name: 'Угроза несанкционированного использования системных и сетевых утилит',
      description: 'Использование штатных утилит ОС для атаки (LOLBAS).',
      defaultProbability: 'medium', defaultDamage: 'medium' },
    { id: 'ubi-071', code: 'УБИ.071', category: 'access', name: 'Угроза несанкционированного восстановления удалённой информации',
      description: 'Чтение остатков информации с носителей после удаления.',
      defaultProbability: 'low', defaultDamage: 'medium' },
    { id: 'ubi-084', code: 'УБИ.084', category: 'channel', name: 'Угроза подмены доверенных пользователей',
      description: 'MITM, перехват сессий, подмена сертификатов.',
      defaultProbability: 'medium', defaultDamage: 'high' },
    { id: 'ubi-088', code: 'УБИ.088', category: 'physical', name: 'Угроза подмены резервной копии программного обеспечения BIOS',
      description: 'Внедрение модифицированного образа BIOS/UEFI.',
      defaultProbability: 'low', defaultDamage: 'high' },
    { id: 'ubi-111', code: 'УБИ.111', category: 'insider', name: 'Угроза несанкционированного копирования защищаемой информации',
      description: 'Сотрудник копирует данные на сменные носители или в облако.',
      defaultProbability: 'high', defaultDamage: 'high' },
    { id: 'ubi-124', code: 'УБИ.124', category: 'channel', name: 'Угроза подмены контента веб-ресурса',
      description: 'Дефейс или фишинг через подмену страниц.',
      defaultProbability: 'low', defaultDamage: 'medium' },
    { id: 'ubi-140', code: 'УБИ.140', category: 'channel', name: 'Угроза приведения системы в состояние «отказ в обслуживании»',
      description: 'DDoS-атака с целью прекращения функционирования.',
      defaultProbability: 'medium', defaultDamage: 'medium' },
    { id: 'ubi-152', code: 'УБИ.152', category: 'access', name: 'Угроза удалённого изменения конфигурации технических средств',
      description: 'Несанкционированное удалённое управление оборудованием.',
      defaultProbability: 'medium', defaultDamage: 'high' },
    { id: 'ubi-155', code: 'УБИ.155', category: 'channel', name: 'Угроза утраты вычислительных ресурсов',
      description: 'Использование инфраструктуры для майнинга, ботнета и пр.',
      defaultProbability: 'medium', defaultDamage: 'medium' },
    { id: 'ubi-165', code: 'УБИ.165', category: 'access', name: 'Угроза эксплуатации цифровой подписи',
      description: 'Использование скомпрометированной ЭП от имени пользователя.',
      defaultProbability: 'low', defaultDamage: 'high' },
    { id: 'ubi-167', code: 'УБИ.167', category: 'channel', name: 'Угроза заражения DNS-кеша',
      description: 'DNS poisoning, перенаправление трафика на подменный сервер.',
      defaultProbability: 'low', defaultDamage: 'high' },
    { id: 'ubi-176', code: 'УБИ.176', category: 'environment', name: 'Угроза нарушения технологического процесса',
      description: 'Сбой в работе ИС, влияющий на бизнес-процесс.',
      defaultProbability: 'medium', defaultDamage: 'high' },
    { id: 'ubi-187', code: 'УБИ.187', category: 'physical', name: 'Угроза несанкционированного копирования с физическим доступом',
      description: 'Несанкционированный доступ к носителю информации.',
      defaultProbability: 'medium', defaultDamage: 'high' },
    { id: 'ubi-195', code: 'УБИ.195', category: 'insider', name: 'Угроза социальной инженерии (фишинг)',
      description: 'Получение учётных данных или доступа методами социальной инженерии.',
      defaultProbability: 'high', defaultDamage: 'high' },
    { id: 'ubi-202', code: 'УБИ.202', category: 'malware', name: 'Угроза несанкционированной установки вредоносного ПО',
      description: 'Заражение узла через вложение, скачивание, эксплойт.',
      defaultProbability: 'high', defaultDamage: 'high' },
    { id: 'ubi-205', code: 'УБИ.205', category: 'malware', name: 'Угроза заражения системы шифровальщиком',
      description: 'Ransomware шифрует данные с требованием выкупа.',
      defaultProbability: 'high', defaultDamage: 'high' },
    { id: 'ubi-211', code: 'УБИ.211', category: 'channel', name: 'Угроза перехвата трафика в канале связи',
      description: 'Прослушивание незащищённого канала, кража учётных данных.',
      defaultProbability: 'medium', defaultDamage: 'high' },
    { id: 'ubi-218', code: 'УБИ.218', category: 'environment', name: 'Угроза нарушения функционирования из-за климатических факторов',
      description: 'Перегрев, влажность, отказ кондиционирования в серверной.',
      defaultProbability: 'low', defaultDamage: 'medium' },
    { id: 'ubi-220', code: 'УБИ.220', category: 'environment', name: 'Угроза нарушения работоспособности при отключении электропитания',
      description: 'Отключение электроэнергии без работающих ИБП.',
      defaultProbability: 'medium', defaultDamage: 'medium' },
    { id: 'ubi-225', code: 'УБИ.225', category: 'physical', name: 'Угроза утраты носителей информации',
      description: 'Кража, утеря, повреждение носителей с защищаемой информацией.',
      defaultProbability: 'medium', defaultDamage: 'high' }
  ],

  // ---- КиберДок: модели угроз (per ИС) ----
  threatModels: [
    {
      id: 'tm-seed-1',
      ownerUsername: 'user',
      organizationId: 'org-seed-1',
      infoSystemId: 'is-seed-1',
      name: 'Модель угроз ИС «Бухгалтерия 1С»',
      status: 'finalized',
      intruder: {
        type: 'mixed',
        potential: 'basic',
        capabilities: ['network_access', 'user_account'],
        motivation:
          'Получение конкурентной информации; несанкционированное использование данных для финансовых злоупотреблений.'
      },
      threats: [
        { catalogId: 'ubi-034', probability: 'high', damage: 'high', isRelevant: true,
          justification: 'Веб-интерфейс публично доступен, история инцидентов в отрасли подтверждает регулярные атаки на формы входа.',
          mitigation: 'WAF, SAST/DAST в CI, регулярный пен-тест.' },
        { catalogId: 'ubi-111', probability: 'high', damage: 'high', isRelevant: true,
          justification: 'Бухгалтер имеет доступ к полному набору ПДн и финансовых данных.',
          mitigation: 'DLP, мониторинг копирования на USB, ограничение прав по роли.' },
        { catalogId: 'ubi-195', probability: 'high', damage: 'high', isRelevant: true,
          justification: 'Финансовый профиль сотрудников делает их типичной целью фишинга.',
          mitigation: 'Антиспам, тренинги, MFA.' },
        { catalogId: 'ubi-205', probability: 'high', damage: 'high', isRelevant: true,
          justification: 'Сервер 1С хранит критические для бизнеса данные.',
          mitigation: 'EDR, регулярные резервные копии в изолированное хранилище.' }
      ],
      conclusion:
        'Из 25 рассмотренных угроз 4 признаны актуальными. Меры защиты направлены на компенсацию выявленных угроз в соответствии с требованиями приказа ФСТЭК России № 21.',
      createdAt: Date.now() - 86400000 * 14,
      updatedAt: Date.now() - 86400000 * 7
    }
  ],

  // ---- КиберДок: пакеты ОРД (шаблоны) ----
  documentSetTemplates: [
    {
      id: 'dst-seed-1',
      name: 'Минимальный комплект ИСПДн',
      description:
        'Базовый набор ОРД для информационной системы персональных данных: приказ о назначении ответственного, политика обработки ПДн, акт классификации, перечни ТС/ПО/СЗИ.',
      audience: 'Для ИСПДн (УЗ-3, УЗ-4)',
      requiresIs: true,
      sections: [
        'cover',
        'order_pdn_responsible',
        'pdn_policy',
        'is_class_act',
        'tech_means_list',
        'software_list',
        'szi_list'
      ],
      createdAt: Date.now() - 86400000 * 60,
      updatedAt: Date.now() - 86400000 * 60
    },
    {
      id: 'dst-seed-2',
      name: 'Полный комплект ГИС',
      description:
        'Расширенный набор ОРД для государственной информационной системы: добавляет приказ о допуске сотрудников, журнал учёта СКЗИ, акт ввода в эксплуатацию.',
      audience: 'Для ГИС (К1–К3)',
      requiresIs: true,
      sections: [
        'cover',
        'order_pdn_responsible',
        'order_personnel_admittance',
        'pdn_policy',
        'is_class_act',
        'tech_means_list',
        'software_list',
        'szi_list',
        'szi_log',
        'commissioning_act'
      ],
      createdAt: Date.now() - 86400000 * 60,
      updatedAt: Date.now() - 86400000 * 60
    },
    {
      id: 'dst-seed-3',
      name: 'Базовый ОРД организации',
      description:
        'Документы уровня организации (без привязки к конкретной ИС): приказ о назначении ответственного за ИБ, политика ИБ, перечень ИС.',
      audience: 'Для юр. лица / ИП в целом',
      requiresIs: false,
      sections: [
        'cover',
        'order_security_responsible',
        'security_policy',
        'info_systems_inventory'
      ],
      createdAt: Date.now() - 86400000 * 60,
      updatedAt: Date.now() - 86400000 * 60
    }
  ],

  // ---- КиберДок: история сгенерированных пакетов ----
  documentSets: [
    {
      id: 'ds-seed-1',
      ownerUsername: 'user',
      organizationId: 'org-seed-1',
      infoSystemId: 'is-seed-1',
      templateId: 'dst-seed-1',
      filename: 'ОРД_Бухгалтерия_2026-04-25.docx',
      sectionsCount: 7,
      generatedAt: Date.now() - 86400000 * 12
    }
  ],

  audit: [
    {
      id: 'audit-seed-1',
      actor: 'admin',
      action: 'user.verify',
      target: 'user',
      details: 'Подтверждение email',
      at: Date.now() - 86400000 * 30
    },
    {
      id: 'audit-seed-2',
      actor: 'admin',
      action: 'user.role',
      target: 'expert',
      details: 'Назначена роль expert',
      at: Date.now() - 86400000 * 45
    },
    {
      id: 'audit-seed-3',
      actor: 'admin',
      action: 'user.block',
      target: 'blocked_user',
      details: 'Блокировка по запросу',
      at: Date.now() - 86400000 * 8
    }
  ]
})

let nextId = 100
export function nextDbId() {
  return ++nextId
}
