
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
  // Параллельный массив для персистентности: {id, token, username, createdAt,
  // lastUsed, userAgent}. Map выше остаётся для O(1) lookup; этот массив
  // даёт SQLite-сохранение и список сессий юзера. Источник истины — массив:
  // при загрузке с диска Map восстанавливается из него.
  refreshTokenMeta: [],
  // Replay-detection: использованные refresh-токены, чтобы поймать повторное
  // предъявление украденного. Массив `[{token, username, usedAt}]` для SQLite;
  // Map (см. handlers.js usedRefreshTokens) восстанавливается из него на load.
  // Без персистентности — после рестарта вся история стирается, replay-window
  // обнуляется → атакующий мог бы дождаться рестарта чтобы token прошёл как
  // «новый» 401, без revoke-all-sessions.
  replayHistoryMeta: [],
  // Lockout-структуры (handlers.js loginFailures, loginFailuresByIp). Массивы
  // `[{username|ip, count, firstFailAt, lockedUntil}]`. Без них лockout
  // обнуляется при каждом restart'е — снижает эффективность брутфорс-защиты.
  loginFailureMeta: [],
  loginFailureByIpMeta: [],
  organizations: [],
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
  personal: [],

  // ---- КиберДок: информационные системы ----
  infoSystems: [],

  // ---- КиберДок: ПО (системное + прикладное) ----
  software: [],

  // ---- КиберДок: каталог СЗИ (ФСТЭК) ----
  securityToolsCatalog: [],

  // ---- КиберДок: экземпляры СЗИ у организации ----
  securityTools: [],

  equipment: [],
  documents: [],
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
  threatModels: [],

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
  documentSets: [],

  audit: []
})

let nextId = 100
export function nextDbId() {
  return ++nextId
}
