import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx'

self.onmessage = async (event) => {
  const { type, payload, requestId } = event.data
  try {
    if (type === 'inn-registry') {
      const blob = await buildInnRegistryDocx(payload, (done, total) => {
        self.postMessage({ type: 'progress', requestId, done, total })
      })
      self.postMessage({ type: 'done', requestId, blob }, [await blob.arrayBuffer()])
      return
    }
    if (type === 'equipment-card') {
      const blob = await buildEquipmentCardDocx(payload)
      self.postMessage({ type: 'done', requestId, blob }, [await blob.arrayBuffer()])
      return
    }
    if (type === 'equipment-bulk') {
      const blob = await buildEquipmentBulkDocx(payload, (done, total) => {
        self.postMessage({ type: 'progress', requestId, done, total })
      })
      self.postMessage({ type: 'done', requestId, blob }, [await blob.arrayBuffer()])
      return
    }
    if (type === 'document') {
      const blob = await buildDocumentDocx(payload)
      self.postMessage({ type: 'done', requestId, blob }, [await blob.arrayBuffer()])
      return
    }
    if (type === 'document-bulk') {
      const blob = await buildDocumentBulkDocx(payload, (done, total) => {
        self.postMessage({ type: 'progress', requestId, done, total })
      })
      self.postMessage({ type: 'done', requestId, blob }, [await blob.arrayBuffer()])
      return
    }
    if (type === 'simple-doc') {
      const blob = await buildSimpleDoc(payload)
      self.postMessage({ type: 'done', requestId, blob }, [await blob.arrayBuffer()])
      return
    }
    if (type === 'document-set') {
      const blob = await buildDocumentSetDocx(payload, (done, total) => {
        self.postMessage({ type: 'progress', requestId, done, total })
      })
      self.postMessage({ type: 'done', requestId, blob }, [await blob.arrayBuffer()])
      return
    }
    if (type === 'threat-model') {
      const blob = await buildThreatModelDocx(payload, (done, total) => {
        self.postMessage({ type: 'progress', requestId, done, total })
      })
      self.postMessage({ type: 'done', requestId, blob }, [await blob.arrayBuffer()])
      return
    }
    throw new Error(`Unknown task type: ${type}`)
  } catch (e) {
    self.postMessage({ type: 'error', requestId, message: e?.message ?? 'docx_failed' })
  }
}

// ---------- builders ----------

function headerCell(text, widthPct) {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text, bold: true })]
      })
    ]
  })
}

function dataCell(text, widthPct) {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ children: [new TextRun(String(text ?? ''))] })]
  })
}

function extractFio(raw) {
  if (!raw) return ''
  const m = /([А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+)/.exec(raw)
  return m?.[1] ?? raw
}

async function buildInnRegistryDocx({ entries, title = 'Реестр организаций' }, onProgress) {
  const completed = entries.filter((e) => e.status === 'done' && e.data)
  const total = completed.length

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell('№', 5),
      headerCell('ИНН', 18),
      headerCell('Полное наименование', 27),
      headerCell('Краткое наименование', 18),
      headerCell('Директор', 17),
      headerCell('ОГРН', 15)
    ]
  })

  const dataRows = []
  const CHUNK = 50
  for (let i = 0; i < completed.length; i += CHUNK) {
    const slice = completed.slice(i, i + CHUNK)
    slice.forEach((e, j) => {
      const idx = i + j
      dataRows.push(
        new TableRow({
          children: [
            dataCell(idx + 1, 5),
            dataCell(e.inn, 18),
            dataCell(e.data?.orgName ?? '—', 27),
            dataCell(e.data?.shortName ?? '—', 18),
            dataCell(extractFio(e.data?.director) || '—', 17),
            dataCell(e.data?.ogrn ?? '—', 15)
          ]
        })
      )
    })
    onProgress?.(Math.min(i + CHUNK, total), total)
    await tick()
  }

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows]
  })

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: title, bold: true })]
          }),
          new Paragraph({
            children: [new TextRun({ text: `Всего записей: ${total}`, italics: true })]
          }),
          new Paragraph({ text: '' }),
          table
        ]
      }
    ]
  })

  return Packer.toBlob(doc)
}

// ---------- equipment ----------

const KIND_LABELS = {
  server: 'Сервер',
  network: 'Сетевое оборудование',
  pc: 'ПК / Рабочая станция',
  printer: 'Принтер / МФУ',
  pos: 'Кассовое оборудование',
  ups: 'ИБП',
  other: 'Прочее'
}
const STATUS_LABELS = {
  active: 'В эксплуатации',
  repair: 'В ремонте',
  decommissioned: 'Списано'
}

function paramRow(label, value) {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 35, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })]
      }),
      new TableCell({
        width: { size: 65, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun(String(value ?? '—'))] })]
      })
    ]
  })
}

function buildCardChildren(equipment, organization) {
  const eq = equipment ?? {}
  const org = organization ?? null
  const children = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Карточка оборудования', bold: true })]
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: eq.name || '—', bold: true })]
    }),
    new Paragraph({ text: '' })
  ]

  const rows = [
    paramRow('Инвентарный номер', eq.inventoryNumber || '—'),
    paramRow('Тип', KIND_LABELS[eq.kind] ?? eq.kind ?? '—'),
    paramRow('Производитель', eq.manufacturer || '—'),
    paramRow('Модель', eq.model || '—'),
    paramRow('Серийный номер', eq.serial || '—'),
    paramRow('Год выпуска', eq.yearMade || '—'),
    paramRow('Местонахождение', eq.location || '—'),
    paramRow('Статус', STATUS_LABELS[eq.status] ?? eq.status ?? '—')
  ]
  if (org) {
    rows.push(paramRow('Организация', org.name || '—'))
    rows.push(paramRow('ИНН организации', org.inn || '—'))
  }

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows
    })
  )

  if (eq.notes) {
    children.push(new Paragraph({ text: '' }))
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun({ text: 'Примечания', bold: true })]
      })
    )
    children.push(new Paragraph({ children: [new TextRun(String(eq.notes))] }))
  }

  return children
}

async function buildEquipmentCardDocx({ equipment, organization }) {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: buildCardChildren(equipment, organization)
      }
    ]
  })
  return Packer.toBlob(doc)
}

async function buildEquipmentBulkDocx({ items = [], organization, title }, onProgress) {
  const total = items.length
  const sections = []

  if (title) {
    sections.push({
      properties: {},
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: title, bold: true })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: `Всего единиц: ${total}`, italics: true })]
        })
      ]
    })
  }

  const CHUNK = 25
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK)
    for (const eq of slice) {
      sections.push({
        properties: {},
        children: buildCardChildren(eq, organization)
      })
    }
    onProgress?.(Math.min(i + CHUNK, total), total)
    await tick()
  }

  const doc = new Document({ sections })
  return Packer.toBlob(doc)
}

// ---------- documents (registry) ----------

const DOC_TYPE_LABEL = {
  act: 'Акт',
  contract: 'Договор',
  protocol: 'Протокол',
  order: 'Приказ',
  report: 'Отчёт'
}

function buildDocumentChildren(doc, organization) {
  const d = doc ?? {}
  const org = organization ?? null
  const title = d.title || (DOC_TYPE_LABEL[d.type] ?? 'Документ')
  const children = []

  if (org) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: org.name || '—' })]
      })
    )
    children.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: `ИНН ${org.inn || '—'}`, italics: true })]
      })
    )
    children.push(new Paragraph({ text: '' }))
  }

  const numAndDate = []
  if (d.number) numAndDate.push(`№ ${d.number}`)
  if (d.date) numAndDate.push(`от ${d.date}`)
  if (numAndDate.length) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: numAndDate.join(' '), italics: true })]
      })
    )
  }

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: title, bold: true })]
    })
  )
  children.push(new Paragraph({ text: '' }))

  const lines = String(d.content ?? '').split(/\r?\n/)
  for (const line of lines) {
    children.push(new Paragraph({ children: [new TextRun(line)] }))
  }

  if (d.status === 'approved' && d.reviewedBy) {
    children.push(new Paragraph({ text: '' }))
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `Согласовано: ${d.reviewedBy}`, italics: true })]
      })
    )
  }

  return children
}

async function buildDocumentDocx({ document: doc, organization }) {
  const out = new Document({
    sections: [{ properties: {}, children: buildDocumentChildren(doc, organization) }]
  })
  return Packer.toBlob(out)
}

async function buildDocumentBulkDocx(
  { items = [], organization, title },
  onProgress
) {
  const total = items.length
  const sections = []

  if (title) {
    sections.push({
      properties: {},
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: title, bold: true })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: `Всего документов: ${total}`, italics: true })]
        })
      ]
    })
  }

  const CHUNK = 25
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK)
    for (const doc of slice) {
      sections.push({
        properties: {},
        children: buildDocumentChildren(doc, organization)
      })
    }
    onProgress?.(Math.min(i + CHUNK, total), total)
    await tick()
  }

  const out = new Document({ sections })
  return Packer.toBlob(out)
}

async function buildSimpleDoc({ title, paragraphs = [] }) {
  const children = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: title ?? 'Документ', bold: true })]
    })
  ]
  for (const p of paragraphs) {
    children.push(new Paragraph({ children: [new TextRun(String(p ?? ''))] }))
  }
  const doc = new Document({ sections: [{ properties: {}, children }] })
  return Packer.toBlob(doc)
}

// ---------- document-set (ОРД пакет) ----------
const SECTION_BUILDERS = {
  cover: buildSectionCover,
  order_pdn_responsible: buildSectionOrderPdnResponsible,
  order_personnel_admittance: buildSectionOrderPersonnelAdmittance,
  order_security_responsible: buildSectionOrderSecurityResponsible,
  pdn_policy: buildSectionPdnPolicy,
  security_policy: buildSectionSecurityPolicy,
  is_class_act: buildSectionIsClassAct,
  tech_means_list: buildSectionTechMeansList,
  software_list: buildSectionSoftwareList,
  szi_list: buildSectionSziList,
  szi_log: buildSectionSziLog,
  commissioning_act: buildSectionCommissioningAct,
  info_systems_inventory: buildSectionInfoSystemsInventory
}

async function buildDocumentSetDocx(
  {
    template,
    organization,
    infoSystem,
    infoSystems = [],
    personal = [],
    equipment = [],
    software = [],
    securityTools = []
  },
  onProgress
) {
  const tpl = template ?? { name: 'ОРД', sections: [] }
  const ctx = {
    organization,
    infoSystem,
    infoSystems,
    personal,
    equipment,
    software,
    securityTools
  }
  const sections = []
  const total = tpl.sections.length

  for (let i = 0; i < tpl.sections.length; i++) {
    const key = tpl.sections[i]
    const builder = SECTION_BUILDERS[key]
    if (builder) {
      const children = builder(ctx, tpl)
      sections.push({ properties: {}, children })
    }
    onProgress?.(i + 1, total)
    await tick()
  }

  if (!sections.length) {
    sections.push({
      properties: {},
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: tpl.name || 'ОРД', bold: true })]
        }),
        new Paragraph({ children: [new TextRun('Шаблон не содержит секций.')] })
      ]
    })
  }

  const doc = new Document({ sections })
  return Packer.toBlob(doc)
}

// ---------- section builders ----------

function fio(p) {
  if (!p) return ''
  const parts = [p.lastName, p.firstName, p.middleName].filter(Boolean)
  return parts.join(' ').trim()
}

function fioShort(p) {
  if (!p) return ''
  const last = p.lastName || ''
  const fInit = p.firstName ? `${p.firstName.charAt(0)}.` : ''
  const mInit = p.middleName ? `${p.middleName.charAt(0)}.` : ''
  return `${last} ${fInit}${mInit}`.trim()
}

function orgHeader(org) {
  if (!org) return []
  const lines = [org.name || '—']
  if (org.inn) lines.push(`ИНН ${org.inn}${org.kpp ? ` / КПП ${org.kpp}` : ''}`)
  if (org.address) lines.push(org.address)
  return lines.map(
    (line) =>
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: line, italics: true })]
      })
  )
}

function dateLine(label = 'Дата') {
  const today = new Date().toISOString().slice(0, 10)
  return new Paragraph({
    alignment: AlignmentType.RIGHT,
    children: [new TextRun({ text: `${label}: ${today}`, italics: true })]
  })
}

function blankLine() {
  return new Paragraph({ text: '' })
}

function heading(text, level = HeadingLevel.HEADING_1, align = AlignmentType.CENTER) {
  return new Paragraph({
    heading: level,
    alignment: align,
    children: [new TextRun({ text, bold: true })]
  })
}

function buildSectionCover({ organization, infoSystem }, tpl) {
  const children = [
    blankLine(),
    blankLine(),
    blankLine(),
    heading(tpl.name || 'Комплект организационно-распорядительной документации'),
    blankLine()
  ]
  if (organization) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: organization.name || '—', bold: true })]
      })
    )
    if (organization.inn) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: `ИНН ${organization.inn}` })]
        })
      )
    }
  }
  if (infoSystem) {
    children.push(blankLine())
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: `Информационная система: ${infoSystem.name || '—'}` })]
      })
    )
    if (infoSystem.classification) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: `Класс / уровень защищённости: ${infoSystem.classification}` })
          ]
        })
      )
    }
  }
  children.push(blankLine())
  children.push(blankLine())
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `${new Date().getFullYear()} год`,
          italics: true
        })
      ]
    })
  )
  return children
}

function buildSectionOrderPdnResponsible({ organization, personal, infoSystem }) {
  const responsible = personal.find((p) => p.hasAdminRights) || personal[0]
  const children = [...orgHeader(organization)]
  children.push(blankLine())
  children.push(heading('ПРИКАЗ', HeadingLevel.HEADING_1))
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'о назначении ответственного за организацию обработки персональных данных',
          italics: true
        })
      ]
    })
  )
  children.push(blankLine())
  children.push(dateLine())
  children.push(blankLine())
  children.push(
    new Paragraph({
      children: [
        new TextRun(
          'Во исполнение требований Федерального закона от 27.07.2006 № 152-ФЗ ' +
            '«О персональных данных» и в целях обеспечения защиты персональных данных, ' +
            `обрабатываемых в ${infoSystem?.name ? `ИС «${infoSystem.name}»` : 'информационных системах'} организации,`
        )
      ]
    })
  )
  children.push(blankLine())
  children.push(heading('ПРИКАЗЫВАЮ:', HeadingLevel.HEADING_2, AlignmentType.LEFT))
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `1. Назначить ответственным за организацию обработки персональных данных ${
            responsible
              ? `${fio(responsible)}${responsible.position ? ` (${responsible.position})` : ''}`
              : '_______________________________'
          }.`
        })
      ]
    })
  )
  children.push(
    new Paragraph({
      children: [
        new TextRun(
          '2. Ответственному в срок до 30 календарных дней с момента издания настоящего приказа ' +
            'обеспечить разработку и согласование внутренних документов по обработке и защите персональных данных.'
        )
      ]
    })
  )
  children.push(
    new Paragraph({
      children: [new TextRun('3. Контроль за исполнением настоящего приказа оставляю за собой.')]
    })
  )
  children.push(blankLine())
  children.push(blankLine())
  children.push(
    new Paragraph({
      children: [new TextRun('Руководитель организации ____________________ / _________________ /')]
    })
  )
  return children
}

function buildSectionOrderPersonnelAdmittance({ organization, personal }) {
  const admitted = personal.slice(0, 30)
  const children = [...orgHeader(organization)]
  children.push(blankLine())
  children.push(heading('ПРИКАЗ', HeadingLevel.HEADING_1))
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'о допуске работников к обработке персональных данных',
          italics: true
        })
      ]
    })
  )
  children.push(blankLine())
  children.push(dateLine())
  children.push(blankLine())
  children.push(heading('ПРИКАЗЫВАЮ:', HeadingLevel.HEADING_2, AlignmentType.LEFT))
  children.push(
    new Paragraph({
      children: [
        new TextRun(
          '1. Допустить к обработке персональных данных в информационных системах организации следующих работников:'
        )
      ]
    })
  )

  if (admitted.length) {
    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        headerCell('№', 6),
        headerCell('Ф. И. О.', 38),
        headerCell('Должность', 36),
        headerCell('Подразделение', 20)
      ]
    })
    const rows = admitted.map(
      (p, i) =>
        new TableRow({
          children: [
            dataCell(i + 1, 6),
            dataCell(fio(p), 38),
            dataCell(p.position || '—', 36),
            dataCell(p.department || '—', 20)
          ]
        })
    )
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [headerRow, ...rows]
      })
    )
  } else {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: '(сотрудники не указаны)', italics: true })]
      })
    )
  }
  children.push(blankLine())
  children.push(
    new Paragraph({
      children: [
        new TextRun(
          '2. Допущенным работникам подписать обязательство о неразглашении информации, ' +
            'содержащей персональные данные.'
        )
      ]
    })
  )
  children.push(blankLine())
  children.push(
    new Paragraph({
      children: [new TextRun('Руководитель организации ____________________ / _________________ /')]
    })
  )
  return children
}

function buildSectionOrderSecurityResponsible({ organization, personal }) {
  const responsible = personal.find((p) => p.hasAdminRights) || personal[0]
  const children = [...orgHeader(organization)]
  children.push(blankLine())
  children.push(heading('ПРИКАЗ', HeadingLevel.HEADING_1))
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'о назначении ответственного за обеспечение информационной безопасности',
          italics: true
        })
      ]
    })
  )
  children.push(blankLine())
  children.push(dateLine())
  children.push(blankLine())
  children.push(heading('ПРИКАЗЫВАЮ:', HeadingLevel.HEADING_2, AlignmentType.LEFT))
  children.push(
    new Paragraph({
      children: [
        new TextRun(
          `1. Назначить ответственным за обеспечение информационной безопасности ${
            responsible
              ? `${fio(responsible)}${responsible.position ? ` (${responsible.position})` : ''}`
              : '_______________________________'
          }.`
        )
      ]
    })
  )
  children.push(
    new Paragraph({
      children: [
        new TextRun(
          '2. Ответственному обеспечить контроль соблюдения требований по защите информации, ' +
            'учёт средств защиты и ведение журналов событий безопасности.'
        )
      ]
    })
  )
  children.push(blankLine())
  children.push(
    new Paragraph({
      children: [new TextRun('Руководитель организации ____________________ / _________________ /')]
    })
  )
  return children
}

function buildSectionPdnPolicy({ organization, infoSystem }) {
  const children = [...orgHeader(organization)]
  children.push(blankLine())
  children.push(heading('ПОЛОЖЕНИЕ'))
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'об обработке и защите персональных данных',
          italics: true
        })
      ]
    })
  )
  children.push(blankLine())
  children.push(heading('1. Общие положения', HeadingLevel.HEADING_2, AlignmentType.LEFT))
  children.push(
    new Paragraph({
      children: [
        new TextRun(
          'Настоящее Положение определяет порядок обработки и защиты персональных данных в ' +
            `${organization?.name ? `«${organization.name}»` : 'организации'}, а также права и обязанности работников при работе с ними.`
        )
      ]
    })
  )
  children.push(heading('2. Цели обработки', HeadingLevel.HEADING_2, AlignmentType.LEFT))
  children.push(
    new Paragraph({
      children: [
        new TextRun(
          'Обработка персональных данных осуществляется в целях исполнения трудовых, ' +
            'гражданско-правовых и налоговых обязательств, а также в целях, предусмотренных ' +
            'учредительными документами организации.'
        )
      ]
    })
  )
  if (infoSystem?.pdnCategories?.length) {
    children.push(heading('3. Категории субъектов и данных', HeadingLevel.HEADING_2, AlignmentType.LEFT))
    children.push(
      new Paragraph({
        children: [
          new TextRun(
            `В ИС «${infoSystem.name}» обрабатываются персональные данные следующих категорий субъектов: ` +
              `${infoSystem.pdnCategories.join(', ')}. Количество субъектов: ${infoSystem.pdnSubjectsCount ?? '—'}.`
          )
        ]
      })
    )
  }
  children.push(heading('4. Меры защиты', HeadingLevel.HEADING_2, AlignmentType.LEFT))
  children.push(
    new Paragraph({
      children: [
        new TextRun(
          'Защита персональных данных обеспечивается организационно-техническими мерами, ' +
            'включая разграничение доступа, антивирусную защиту, межсетевое экранирование, ' +
            'регистрацию и учёт событий безопасности.'
        )
      ]
    })
  )
  return children
}

function buildSectionSecurityPolicy({ organization }) {
  const children = [...orgHeader(organization)]
  children.push(blankLine())
  children.push(heading('ПОЛИТИКА ИНФОРМАЦИОННОЙ БЕЗОПАСНОСТИ'))
  children.push(blankLine())
  children.push(heading('1. Цели и принципы', HeadingLevel.HEADING_2, AlignmentType.LEFT))
  children.push(
    new Paragraph({
      children: [
        new TextRun(
          'Политика информационной безопасности устанавливает основные цели, принципы и ' +
            'мероприятия по обеспечению защиты информации в организации.'
        )
      ]
    })
  )
  children.push(heading('2. Область применения', HeadingLevel.HEADING_2, AlignmentType.LEFT))
  children.push(
    new Paragraph({
      children: [
        new TextRun(
          'Настоящая Политика распространяется на всех работников организации и подрядчиков, ' +
            'имеющих доступ к информационным ресурсам.'
        )
      ]
    })
  )
  children.push(heading('3. Ответственность', HeadingLevel.HEADING_2, AlignmentType.LEFT))
  children.push(
    new Paragraph({
      children: [
        new TextRun(
          'Контроль соблюдения настоящей Политики возложен на ответственного за информационную ' +
            'безопасность, назначенного приказом по организации.'
        )
      ]
    })
  )
  return children
}

function buildSectionIsClassAct({ organization, infoSystem }) {
  const children = [...orgHeader(organization)]
  children.push(blankLine())
  children.push(heading('АКТ'))
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'классификации информационной системы',
          italics: true
        })
      ]
    })
  )
  children.push(blankLine())
  children.push(dateLine())
  children.push(blankLine())

  const rows = [
    paramRow('Наименование ИС', infoSystem?.name || '—'),
    paramRow('Назначение', infoSystem?.purpose || '—'),
    paramRow('Тип ИС', infoSystem?.typeId || '—'),
    paramRow('Режим обработки', infoSystem?.regimId || '—'),
    paramRow('Структура', infoSystem?.strukId || '—'),
    paramRow('Подключение к интернету', infoSystem?.inetId || '—'),
    paramRow('Класс / уровень защищённости', infoSystem?.classification || '—'),
    paramRow('Оператор', infoSystem?.operatorName || '—'),
    paramRow('ИНН оператора', infoSystem?.operatorInn || '—'),
    paramRow(
      'Обработка ПДн',
      infoSystem?.hasPdn
        ? `Да (категории: ${(infoSystem.pdnCategories ?? []).join(', ') || '—'}; субъектов: ${infoSystem.pdnSubjectsCount ?? '—'})`
        : 'Нет'
    )
  ]
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows
    })
  )
  children.push(blankLine())
  children.push(
    new Paragraph({
      children: [
        new TextRun(
          'На основании анализа представленных характеристик информационной системы ' +
            'установлен приведённый выше класс защищённости. Меры защиты применяются ' +
            'в соответствии с требованиями ФСТЭК России.'
        )
      ]
    })
  )
  return children
}

function buildSectionTechMeansList({ organization, infoSystem, equipment }) {
  const children = [...orgHeader(organization)]
  children.push(blankLine())
  children.push(heading('ПЕРЕЧЕНЬ'))
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: infoSystem
            ? `технических средств информационной системы «${infoSystem.name}»`
            : 'технических средств организации',
          italics: true
        })
      ]
    })
  )
  children.push(blankLine())

  if (!equipment.length) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: '(оборудование не зарегистрировано)', italics: true })]
      })
    )
    return children
  }
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell('№', 5),
      headerCell('Инв. №', 12),
      headerCell('Наименование', 28),
      headerCell('Производитель / модель', 25),
      headerCell('Серийный номер', 15),
      headerCell('Местонахождение', 15)
    ]
  })
  const rows = equipment.map(
    (e, i) =>
      new TableRow({
        children: [
          dataCell(i + 1, 5),
          dataCell(e.inventoryNumber || '—', 12),
          dataCell(e.name || '—', 28),
          dataCell(`${e.manufacturer || ''} ${e.model || ''}`.trim() || '—', 25),
          dataCell(e.serial || '—', 15),
          dataCell(e.location || '—', 15)
        ]
      })
  )
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...rows]
    })
  )
  children.push(blankLine())
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: `Всего единиц: ${equipment.length}.`, italics: true })
      ]
    })
  )
  return children
}

function buildSectionSoftwareList({ organization, infoSystem, software }) {
  const children = [...orgHeader(organization)]
  children.push(blankLine())
  children.push(heading('ПЕРЕЧЕНЬ'))
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: infoSystem
            ? `программного обеспечения информационной системы «${infoSystem.name}»`
            : 'программного обеспечения',
          italics: true
        })
      ]
    })
  )
  children.push(blankLine())

  if (!software.length) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: '(ПО не зарегистрировано)', italics: true })]
      })
    )
    return children
  }
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell('№', 5),
      headerCell('Категория', 14),
      headerCell('Наименование', 32),
      headerCell('Версия', 12),
      headerCell('Вендор', 22),
      headerCell('Лицензия', 15)
    ]
  })
  const CATEGORY_LABEL = { system: 'Системное', application: 'Прикладное' }
  const rows = software.map(
    (s, i) =>
      new TableRow({
        children: [
          dataCell(i + 1, 5),
          dataCell(CATEGORY_LABEL[s.category] || s.category || '—', 14),
          dataCell(s.name || '—', 32),
          dataCell(s.version || '—', 12),
          dataCell(s.vendor || '—', 22),
          dataCell(s.licenseType || '—', 15)
        ]
      })
  )
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...rows]
    })
  )
  children.push(blankLine())
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Всего позиций: ${software.length}.`, italics: true })]
    })
  )
  return children
}

function buildSectionSziList({ organization, infoSystem, securityTools }) {
  const children = [...orgHeader(organization)]
  children.push(blankLine())
  children.push(heading('ПЕРЕЧЕНЬ'))
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: infoSystem
            ? `средств защиты информации, применяемых в ИС «${infoSystem.name}»`
            : 'применяемых средств защиты информации',
          italics: true
        })
      ]
    })
  )
  children.push(blankLine())

  if (!securityTools.length) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: '(СЗИ не зарегистрированы)', italics: true })]
      })
    )
    return children
  }
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell('№', 5),
      headerCell('Наименование', 30),
      headerCell('Вендор', 20),
      headerCell('Сертификат', 18),
      headerCell('Серийный №', 15),
      headerCell('Срок лицензии', 12)
    ]
  })
  const rows = securityTools.map(
    (s, i) =>
      new TableRow({
        children: [
          dataCell(i + 1, 5),
          dataCell(s.catalogName || s.catalog?.name || '—', 30),
          dataCell(s.catalogVendor || s.catalog?.vendor || '—', 20),
          dataCell(s.catalog?.certNumber || '—', 18),
          dataCell(s.serialNumber || '—', 15),
          dataCell(s.licenseExpiresAt || '—', 12)
        ]
      })
  )
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...rows]
    })
  )
  children.push(blankLine())
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Всего СЗИ: ${securityTools.length}.`, italics: true })]
    })
  )
  return children
}

function buildSectionSziLog({ organization, securityTools }) {
  const children = [...orgHeader(organization)]
  children.push(blankLine())
  children.push(heading('ЖУРНАЛ'))
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'учёта средств криптографической защиты и СЗИ',
          italics: true
        })
      ]
    })
  )
  children.push(blankLine())

  if (!securityTools.length) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: '(записи отсутствуют)', italics: true })]
      })
    )
    return children
  }
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell('№', 5),
      headerCell('Наименование СЗИ', 28),
      headerCell('Серийный №', 15),
      headerCell('Лицензионный ключ', 22),
      headerCell('Дата ввода', 15),
      headerCell('Срок действия', 15)
    ]
  })
  const rows = securityTools.map(
    (s, i) =>
      new TableRow({
        children: [
          dataCell(i + 1, 5),
          dataCell(s.catalogName || s.catalog?.name || '—', 28),
          dataCell(s.serialNumber || '—', 15),
          dataCell(s.licenseKey || '—', 22),
          dataCell(s.deployedAt || '—', 15),
          dataCell(s.licenseExpiresAt || '—', 15)
        ]
      })
  )
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...rows]
    })
  )
  return children
}

function buildSectionCommissioningAct({ organization, infoSystem, equipment, software, securityTools, personal }) {
  const responsible = personal.find((p) => p.hasAdminRights) || personal[0]
  const children = [...orgHeader(organization)]
  children.push(blankLine())
  children.push(heading('АКТ'))
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'ввода информационной системы в эксплуатацию',
          italics: true
        })
      ]
    })
  )
  children.push(blankLine())
  children.push(dateLine())
  children.push(blankLine())
  children.push(
    new Paragraph({
      children: [
        new TextRun(
          `Комиссия в составе ответственного за ИБ ${responsible ? fioShort(responsible) : '________'} ` +
            `подтверждает ввод в эксплуатацию информационной системы «${infoSystem?.name || '—'}».`
        )
      ]
    })
  )
  children.push(blankLine())
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'Состав инфраструктуры на момент ввода:', bold: true })
      ]
    })
  )
  children.push(
    new Paragraph({
      children: [new TextRun(`— технических средств: ${equipment.length};`)]
    })
  )
  children.push(
    new Paragraph({
      children: [new TextRun(`— единиц программного обеспечения: ${software.length};`)]
    })
  )
  children.push(
    new Paragraph({
      children: [new TextRun(`— средств защиты информации: ${securityTools.length}.`)]
    })
  )
  children.push(blankLine())
  children.push(
    new Paragraph({
      children: [
        new TextRun(
          'Информационная система отвечает заявленному классу/уровню защищённости и допущена к ' +
            'промышленной эксплуатации.'
        )
      ]
    })
  )
  return children
}

function buildSectionInfoSystemsInventory({ organization, infoSystems }) {
  const list = Array.isArray(infoSystems) ? infoSystems : []
  const children = [...orgHeader(organization)]
  children.push(blankLine())
  children.push(heading('ПЕРЕЧЕНЬ'))
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'информационных систем организации', italics: true })
      ]
    })
  )
  children.push(blankLine())

  if (!list.length) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: '(данные об ИС в пакете отсутствуют)', italics: true })]
      })
    )
    return children
  }
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell('№', 5),
      headerCell('Наименование ИС', 35),
      headerCell('Тип', 15),
      headerCell('Класс', 15),
      headerCell('ПДн', 10),
      headerCell('Назначение', 20)
    ]
  })
  const rows = list.map(
    (is, i) =>
      new TableRow({
        children: [
          dataCell(i + 1, 5),
          dataCell(is.name || '—', 35),
          dataCell(is.typeId || '—', 15),
          dataCell(is.classification || '—', 15),
          dataCell(is.hasPdn ? 'Да' : 'Нет', 10),
          dataCell(is.purpose || '—', 20)
        ]
      })
  )
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...rows]
    })
  )
  return children
}

// ---------- threat model (модель угроз ФСТЭК) ----------

const INTRUDER_TYPE_LABEL = {
  external: 'Внешний',
  internal: 'Внутренний',
  mixed: 'Смешанный (внешний и внутренний)'
}
const INTRUDER_POTENTIAL_LABEL = {
  low: 'Низкий',
  basic: 'Базовый',
  enhanced: 'Повышенный',
  high: 'Высокий'
}
const INTRUDER_CAPABILITY_LABEL = {
  network_access: 'Сетевой доступ к ИС',
  physical_access: 'Физический доступ к компонентам ИС',
  user_account: 'Учётная запись пользователя',
  privileged_account: 'Привилегированный доступ',
  social_engineering: 'Возможности социальной инженерии',
  supply_chain: 'Доступ к цепочке поставок'
}
const LEVEL_LABEL = { low: 'Низкая', medium: 'Средняя', high: 'Высокая' }
const THREAT_CATEGORY_LABEL = {
  access: 'Несанкционированный доступ',
  malware: 'Вредоносное ПО',
  physical: 'Физические угрозы',
  channel: 'Сетевые / канальные угрозы',
  insider: 'Внутренний нарушитель',
  environment: 'Среда / климатические факторы'
}

async function buildThreatModelDocx({ model, organization, infoSystem }, onProgress) {
  const m = model ?? {}
  const org = organization ?? null
  const is = infoSystem ?? null
  const threats = Array.isArray(m.threats) ? m.threats : []
  const relevant = threats.filter((t) => t.isRelevant)
  const total = 4 + threats.length
  let done = 0
  const bump = () => {
    done++
    onProgress?.(done, total)
  }

  const sections = []

  // --- Титул ---
  sections.push({
    properties: {},
    children: [
      blankPara(),
      blankPara(),
      heading2('МОДЕЛЬ УГРОЗ БЕЗОПАСНОСТИ ИНФОРМАЦИИ', HeadingLevel.HEADING_1),
      blankPara(),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: m.name || '—', bold: true })]
      }),
      blankPara(),
      ...(org
        ? [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: org.name || '—' })]
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: `ИНН ${org.inn || '—'}`, italics: true })]
            })
          ]
        : []),
      blankPara(),
      ...(is
        ? [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: `Информационная система: ${is.name || '—'}` })
              ]
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: `Класс / уровень защищённости: ${is.classification || '—'}`,
                  italics: true
                })
              ]
            })
          ]
        : []),
      blankPara(),
      blankPara(),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: `${new Date().getFullYear()} год`,
            italics: true
          })
        ]
      })
    ]
  })
  bump()

  // --- Объект защиты ---
  const objectChildren = []
  if (org) objectChildren.push(...orgHeader(org))
  objectChildren.push(blankPara())
  objectChildren.push(heading2('1. Объект защиты', HeadingLevel.HEADING_1, AlignmentType.LEFT))
  if (is) {
    const rows = [
      paramRow('Наименование ИС', is.name || '—'),
      paramRow('Назначение', is.purpose || '—'),
      paramRow('Тип ИС', is.typeId || '—'),
      paramRow('Режим обработки', is.regimId || '—'),
      paramRow('Структура', is.strukId || '—'),
      paramRow('Подключение к Интернету', is.inetId || '—'),
      paramRow('Класс / уровень защищённости', is.classification || '—'),
      paramRow('Оператор', is.operatorName || '—'),
      paramRow('ИНН оператора', is.operatorInn || '—'),
      paramRow(
        'Обработка ПДн',
        is.hasPdn
          ? `Да (категории: ${(is.pdnCategories ?? []).join(', ') || '—'}; субъектов: ${is.pdnSubjectsCount ?? '—'})`
          : 'Нет'
      )
    ]
    objectChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows
      })
    )
  } else {
    objectChildren.push(
      new Paragraph({
        children: [new TextRun({ text: '(данные об ИС не предоставлены)', italics: true })]
      })
    )
  }
  sections.push({ properties: {}, children: objectChildren })
  bump()

  // --- Модель нарушителя ---
  const intruderChildren = []
  if (org) intruderChildren.push(...orgHeader(org))
  intruderChildren.push(blankPara())
  intruderChildren.push(
    heading2('2. Модель нарушителя', HeadingLevel.HEADING_1, AlignmentType.LEFT)
  )
  const intruder = m.intruder ?? {}
  intruderChildren.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        paramRow('Тип нарушителя', INTRUDER_TYPE_LABEL[intruder.type] ?? intruder.type ?? '—'),
        paramRow(
          'Потенциал',
          INTRUDER_POTENTIAL_LABEL[intruder.potential] ?? intruder.potential ?? '—'
        ),
        paramRow(
          'Возможности',
          (intruder.capabilities ?? [])
            .map((c) => INTRUDER_CAPABILITY_LABEL[c] ?? c)
            .join('; ') || '—'
        ),
        paramRow('Мотивация', intruder.motivation || '—')
      ]
    })
  )
  sections.push({ properties: {}, children: intruderChildren })
  bump()

  // --- Перечень рассмотренных угроз ---
  const threatsHeader = []
  if (org) threatsHeader.push(...orgHeader(org))
  threatsHeader.push(blankPara())
  threatsHeader.push(
    heading2('3. Перечень рассмотренных угроз', HeadingLevel.HEADING_1, AlignmentType.LEFT)
  )

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell('№', 4),
      headerCell('Код', 9),
      headerCell('Угроза', 35),
      headerCell('Категория', 14),
      headerCell('Вер.', 10),
      headerCell('Опас.', 10),
      headerCell('Актуальна', 18)
    ]
  })

  const dataRows = []
  const CHUNK = 25
  for (let i = 0; i < threats.length; i += CHUNK) {
    const slice = threats.slice(i, i + CHUNK)
    slice.forEach((t, j) => {
      const idx = i + j
      const cat = t.catalog ?? {}
      dataRows.push(
        new TableRow({
          children: [
            dataCell(idx + 1, 4),
            dataCell(cat.code || '—', 9),
            dataCell(cat.name || t.catalogId, 35),
            dataCell(THREAT_CATEGORY_LABEL[cat.category] ?? cat.category ?? '—', 14),
            dataCell(LEVEL_LABEL[t.probability] ?? t.probability ?? '—', 10),
            dataCell(LEVEL_LABEL[t.damage] ?? t.damage ?? '—', 10),
            dataCell(t.isRelevant ? 'Да' : 'Нет', 18)
          ]
        })
      )
      bump()
    })
    await tick()
  }
  threatsHeader.push(
    threats.length
      ? new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [headerRow, ...dataRows]
        })
      : new Paragraph({
          children: [new TextRun({ text: '(угрозы не рассмотрены)', italics: true })]
        })
  )
  threatsHeader.push(blankPara())
  threatsHeader.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Всего рассмотрено угроз: ${threats.length}. Актуальных: ${relevant.length}.`,
          italics: true
        })
      ]
    })
  )
  sections.push({ properties: {}, children: threatsHeader })

  // --- Актуальные угрозы (карточки с обоснованием и мерами) ---
  if (relevant.length) {
    const relevantChildren = []
    if (org) relevantChildren.push(...orgHeader(org))
    relevantChildren.push(blankPara())
    relevantChildren.push(
      heading2('4. Актуальные угрозы', HeadingLevel.HEADING_1, AlignmentType.LEFT)
    )
    relevant.forEach((t, idx) => {
      const cat = t.catalog ?? {}
      relevantChildren.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [
            new TextRun({
              text: `4.${idx + 1}. ${cat.code ? `${cat.code}. ` : ''}${cat.name || t.catalogId}`,
              bold: true
            })
          ]
        })
      )
      if (cat.description) {
        relevantChildren.push(new Paragraph({ children: [new TextRun(cat.description)] }))
      }
      relevantChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Вероятность: ${LEVEL_LABEL[t.probability] ?? '—'}, опасность: ${LEVEL_LABEL[t.damage] ?? '—'}.`,
              italics: true
            })
          ]
        })
      )
      if (t.justification) {
        relevantChildren.push(
          new Paragraph({
            children: [new TextRun({ text: 'Обоснование: ', bold: true }), new TextRun(t.justification)]
          })
        )
      }
      if (t.mitigation) {
        relevantChildren.push(
          new Paragraph({
            children: [new TextRun({ text: 'Меры защиты: ', bold: true }), new TextRun(t.mitigation)]
          })
        )
      }
      relevantChildren.push(blankPara())
    })
    sections.push({ properties: {}, children: relevantChildren })
  }

  // --- Заключение ---
  const conclusionChildren = []
  if (org) conclusionChildren.push(...orgHeader(org))
  conclusionChildren.push(blankPara())
  conclusionChildren.push(
    heading2(
      relevant.length ? '5. Заключение' : '4. Заключение',
      HeadingLevel.HEADING_1,
      AlignmentType.LEFT
    )
  )
  conclusionChildren.push(
    new Paragraph({
      children: [
        new TextRun(
          m.conclusion ||
            'Меры защиты применяются в соответствии с требованиями приказов ФСТЭК России № 17 / № 21 ' +
              'и компенсируют выявленные актуальные угрозы.'
        )
      ]
    })
  )
  conclusionChildren.push(blankPara())
  conclusionChildren.push(
    new Paragraph({
      children: [
        new TextRun(
          'Ответственный за обеспечение информационной безопасности ____________________ / _________________ /'
        )
      ]
    })
  )
  sections.push({ properties: {}, children: conclusionChildren })

  const doc = new Document({ sections })
  return Packer.toBlob(doc)
}

function blankPara() {
  return new Paragraph({ text: '' })
}

function heading2(text, level = HeadingLevel.HEADING_1, align = AlignmentType.CENTER) {
  return new Paragraph({
    heading: level,
    alignment: align,
    children: [new TextRun({ text, bold: true })]
  })
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
