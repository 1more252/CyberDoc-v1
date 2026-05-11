
const REGIONS = [
  'г. Москва', 'г. Санкт-Петербург', 'Московская обл.', 'Свердловская обл.',
  'Республика Татарстан', 'Нижегородская обл.', 'Краснодарский край',
  'Ростовская обл.', 'Новосибирская обл.', 'Челябинская обл.'
]
const KINDS = ['ООО', 'АО', 'ПАО']
const NAMES = [
  'Ромашка', 'Альфа', 'Бета', 'Гранит', 'Северянка', 'Прометей', 'Сириус',
  'Восход', 'Орбита', 'Магистраль', 'Меркурий', 'Сатурн', 'Юпитер', 'Авангард', 'Триумф'
]
const FIRST = ['Иван', 'Алексей', 'Сергей', 'Дмитрий', 'Андрей', 'Михаил', 'Олег', 'Никита']
const MIDDLE = ['Иванович', 'Петрович', 'Сергеевич', 'Алексеевич', 'Дмитриевич', 'Михайлович']
const LAST = ['Иванов', 'Петров', 'Сидоров', 'Кузнецов', 'Смирнов', 'Соколов', 'Михайлов', 'Лебедев']

function hashCode(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

function pick(arr, h, salt) {
  return arr[(h + salt) % arr.length]
}

function looksLikeInn(value) {
  return /^\d{10}$/.test(value) || /^\d{12}$/.test(value)
}

export function fnsLookup(inn) {
  const trimmed = String(inn ?? '').trim()
  if (!looksLikeInn(trimmed)) return { ok: false, error: 'invalid_inn' }
  if (trimmed.endsWith('7')) return { ok: false, error: 'fns_temporary_unavailable' }

  const h = hashCode(trimmed)
  const isIp = trimmed.length === 12
  const kind = isIp ? 'ИП' : pick(KINDS, h, 1)
  const baseName = pick(NAMES, h, 2)
  const region = pick(REGIONS, h, 3)
  const fio = `${pick(LAST, h, 4)} ${pick(FIRST, h, 5)} ${pick(MIDDLE, h, 6)}`
  const ogrn = isIp
    ? String(1_000_000_000_000_000 + (h % 999_999_999_999_999))
    : String(1_000_000_000_000 + (h % 999_999_999_999))
  const year = 2000 + (h % 25)
  const month = String((h % 12) + 1).padStart(2, '0')
  const day = String((h % 27) + 1).padStart(2, '0')

  const orgName = isIp
    ? `Индивидуальный предприниматель ${fio}`
    : `${kind} «${baseName}»`
  const shortName = isIp ? `ИП ${fio}` : `${kind} "${baseName}"`

  return {
    ok: true,
    data: {
      inn: trimmed,
      orgName,
      shortName,
      region,
      director: isIp ? '' : `Директор ${fio}`,
      registrationDate: `${year}-${month}-${day}`,
      ogrn,
      okved: `${(h % 90) + 1}.${(h % 99) + 1}`,
      address: `${region}, ул. ${baseName}, д. ${(h % 200) + 1}`
    }
  }
}
