// Sanity-check: каждая операция в docs/openapi.yaml должна иметь соответствие
// в server/index.js (по строковому совпадению пути). Не строгий unit-тест:
// если в коде используется RegExp-роут вроде app.all(/^\/api/), spec-роут
// внутри /api/* всё равно проходит через handleMockRequest и здесь не
// проверяется (см. openapi.yaml — описаны только server-level эндпоинты).
//
// Используется вручную: `node scripts/check-openapi-coverage.mjs`.

import { readFileSync } from 'node:fs'

const spec = readFileSync(new URL('../docs/openapi.yaml', import.meta.url), 'utf8')
const code = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')

const after = spec.slice(spec.indexOf('paths:'))
const lines = after.split(/\r?\n/)
const ops = []
let curPath = null
for (const l of lines) {
  const p = l.match(/^ {2}(\/[^:]+):\s*$/)
  if (p) { curPath = p[1].trim(); continue }
  const m = l.match(/^ {4}(get|head|post|put|patch|delete):\s*$/)
  if (m && curPath) ops.push({ method: m[1].toUpperCase(), path: curPath })
}

let unmatched = 0
for (const { method, path } of ops) {
  const ml = method.toLowerCase()
  // Простое строковое совпадение: app.<method>('<path>'
  const pat = `app.${ml}('${path}'`
  const altQ = `app.${ml}("${path}"`
  const found = code.includes(pat) || code.includes(altQ)
  console.log(found ? 'OK ' : '?? ', method, path)
  if (!found) unmatched++
}
console.log(`---\n${ops.length} operations checked, ${unmatched} unmatched`)
process.exit(unmatched ? 1 : 0)
