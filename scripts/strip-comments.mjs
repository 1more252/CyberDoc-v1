/**
 * Жёсткая чистка комментариев в src/.
 *
 * Оставляем ТОЛЬКО разделители секций — `// === ... ===`, `// ---- ... ----`,
 * `// ###### ... ######` и подобное. Всё остальное — JSDoc, per-function
 * описания, inline-комментарии — режем.
 *
 * Учитывает строки/шаблонные литералы/regex (упрощённо: regex детектится
 * по предыдущему non-space символу — если оператор/начало строки → regex).
 */
import { readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../src', import.meta.url))
const SECTION_RE = /^\s*\/\/\s*(={2,}|-{3,}|#{2,})/
const REGEX_CTX = /[=([{,;:?!&|^~<>+\-*/%]$|\b(return|typeof|delete|void|new|throw|in|of|instanceof|await|yield|case|do)$/

function isSection(line) { return SECTION_RE.test(line) }

function strip(code) {
  let out = ''
  let i = 0
  const n = code.length
  let inStr = null
  let inTpl = false
  let inBlock = false
  let inRegex = false
  let lastSig = ''
  let changed = false

  const flushLine = (commentEnd) => {
    const lineStart = out.lastIndexOf('\n') + 1
    const prefix = out.slice(lineStart)
    if (prefix.trim().length === 0) {
      out = out.slice(0, lineStart)
      i = commentEnd + (code[commentEnd] === '\n' ? 1 : 0)
    } else {
      out = out.replace(/[ \t]+$/, '')
      i = commentEnd
    }
    changed = true
  }

  while (i < n) {
    const ch = code[i]
    const nx = code[i + 1]

    if (inBlock) {
      if (ch === '*' && nx === '/') { inBlock = false; i += 2; continue }
      i++
      continue
    }
    if (inRegex) {
      out += ch
      if (ch === '\\' && i + 1 < n) { out += code[i + 1]; i += 2; continue }
      if (ch === '/') {
        inRegex = false
        let j = i + 1
        while (j < n && /[gimsuy]/.test(code[j])) { out += code[j]; j++ }
        i = j
        lastSig = '/'
        continue
      }
      i++
      continue
    }
    if (inStr) {
      out += ch
      if (ch === '\\' && i + 1 < n) { out += code[i + 1]; i += 2; continue }
      if (ch === inStr) { inStr = null; lastSig = ch }
      i++
      continue
    }
    if (inTpl) {
      out += ch
      if (ch === '\\' && i + 1 < n) { out += code[i + 1]; i += 2; continue }
      if (ch === '`') { inTpl = false; lastSig = '`' }
      i++
      continue
    }

    if (ch === '"' || ch === "'") { inStr = ch; out += ch; i++; continue }
    if (ch === '`') { inTpl = true; out += ch; i++; continue }

    if (ch === '/' && nx === '/') {
      const lineStart = out.lastIndexOf('\n') + 1
      const prefix = out.slice(lineStart)
      const nl = code.indexOf('\n', i)
      const end = nl < 0 ? n : nl
      const full = prefix + code.slice(i, end)
      if (isSection(full)) {
        out += code.slice(i, end)
        i = end
        continue
      }
      flushLine(end)
      continue
    }
    if (ch === '/' && nx === '*') {
      inBlock = true
      i += 2
      changed = true
      // also remove leading whitespace on this line if the block stood alone
      continue
    }
    if (ch === '/') {
      // regex literal?
      const prefixTrim = lastSig
      if (!prefixTrim || REGEX_CTX.test(out.replace(/\s+$/, ''))) {
        inRegex = true
        out += ch
        i++
        continue
      }
    }

    out += ch
    if (!/\s/.test(ch)) lastSig = ch
    i++
  }

  return { code: out.replace(/\n{3,}/g, '\n\n'), changed }
}

function processVue(code) {
  let any = false
  const out = code.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/g, (m, o, b, c) => {
    const { code: nb, changed } = strip(b)
    if (changed) any = true
    return o + nb + c
  })
  return { code: out, changed: any }
}

async function walk(dir, out = []) {
  for (const name of await readdir(dir)) {
    const full = join(dir, name)
    const s = await stat(full)
    if (s.isDirectory()) await walk(full, out)
    else out.push(full)
  }
  return out
}

const files = await walk(ROOT)
let touched = 0
for (const f of files) {
  const ext = extname(f)
  if (ext !== '.js' && ext !== '.vue') continue
  const src = await readFile(f, 'utf8')
  const { code, changed } = ext === '.vue' ? processVue(src) : strip(src)
  if (changed && code !== src) {
    await writeFile(f, code)
    touched++
  }
}
console.log(`stripped ${touched} files`)
