

const HEADERS = {
  lastname: 'lastName',
  фамилия: 'lastName',
  firstname: 'firstName',
  имя: 'firstName',
  middlename: 'middleName',
  отчество: 'middleName',
  position: 'position',
  должность: 'position',
  department: 'department',
  подразделение: 'department',
  отдел: 'department',
  phone: 'phone',
  телефон: 'phone',
  email: 'email',
  'e-mail': 'email',
  почта: 'email',
  hasadminrights: 'hasAdminRights',
  админ: 'hasAdminRights',
  'админ.права': 'hasAdminRights',
  notes: 'notes',
  примечания: 'notes',
  комментарий: 'notes'
}

function parseCsvLine(line, sep) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === sep) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((x) => x.trim())
}

function detectSeparator(headerLine) {
  const counts = {
    ',': (headerLine.match(/,/g) || []).length,
    ';': (headerLine.match(/;/g) || []).length,
    '\t': (headerLine.match(/\t/g) || []).length
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return best[1] > 0 ? best[0] : ','
}

function normalizeHeader(h) {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, '')
}

function parseBoolean(v) {
  if (typeof v === 'boolean') return v
  const s = String(v ?? '').trim().toLowerCase()
  return ['1', 'true', 'yes', 'да', 'y', 'истина', '+'].includes(s)
}

function parseFile(text, onProgress) {
  const cleaned = text.replace(/^\ufeff/, '')
  const lines = cleaned.split(/\r?\n/).filter((l) => l.length > 0)
  if (!lines.length) return { items: [], errors: [{ row: 0, error: 'empty_file' }] }

  const sep = detectSeparator(lines[0])
  const headerCells = parseCsvLine(lines[0], sep).map(normalizeHeader)
  const colMap = headerCells.map((h) => HEADERS[h] ?? null)

  const requiredOk = colMap.includes('lastName') && colMap.includes('firstName')
  if (!requiredOk) {
    return {
      items: [],
      errors: [
        {
          row: 1,
          error: 'missing_required_columns',
          detail: 'Нужны колонки «Фамилия» и «Имя» (можно lastName/firstName).'
        }
      ]
    }
  }

  const items = []
  const errors = []
  const total = lines.length - 1
  const progressEvery = 200

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i], sep)
    const row = {}
    for (let c = 0; c < colMap.length; c++) {
      const key = colMap[c]
      if (!key) continue
      row[key] = cells[c] ?? ''
    }
    if (row.hasAdminRights !== undefined) row.hasAdminRights = parseBoolean(row.hasAdminRights)
    if (!row.lastName?.trim() || !row.firstName?.trim()) {
      errors.push({ row: i + 1, error: 'name_required' })
      continue
    }
    items.push(row)

    if (i % progressEvery === 0) onProgress(i, total)
  }
  onProgress(total, total)

  return { items, errors }
}

self.onmessage = (event) => {
  const { type, requestId, payload } = event.data || {}
  try {
    if (type === 'parse') {
      const { items, errors } = parseFile(payload?.text ?? '', (done, total) => {
        self.postMessage({ type: 'progress', requestId, done, total })
      })
      self.postMessage({ type: 'done', requestId, items, errors })
      return
    }
    self.postMessage({ type: 'error', requestId, error: 'unknown_task' })
  } catch (err) {
    self.postMessage({ type: 'error', requestId, error: err?.message || String(err) })
  }
}
