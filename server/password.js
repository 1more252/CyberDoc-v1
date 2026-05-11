// Серверный адаптер хеширования паролей: scrypt + timing-safe compare.
// Формат stored: "scrypt$N$<saltHex>$<hashHex>", где N — версия параметров.

import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'

// Параметры scrypt v1. RFC 7914 рекомендует cost >= 2^15 для интерактивных
// логинов. На современном железе ~50ms. При необходимости можно ввести v2
// без поломки старых хешей.
const PARAMS = {
  1: { N: 16384, r: 8, p: 1, keyLen: 32, saltLen: 16 }
}
const CURRENT_VERSION = 1

export function hash(plain) {
  const s = String(plain ?? '')
  if (!s) throw new Error('empty_password')
  const { N, r, p, keyLen, saltLen } = PARAMS[CURRENT_VERSION]
  const salt = randomBytes(saltLen)
  const derived = scryptSync(s, salt, keyLen, { N, r, p })
  return `scrypt$${CURRENT_VERSION}$${salt.toString('hex')}$${derived.toString('hex')}`
}

export function verify(plain, stored) {
  if (typeof stored !== 'string') return false
  if (!stored.startsWith('scrypt$')) {
    // Лень-миграция: legacy plain (после первого успешного логина hashAndUpgrade)
    return String(plain ?? '') === stored
  }
  const parts = stored.split('$')
  if (parts.length !== 4) return false
  const version = Number(parts[1])
  const params = PARAMS[version]
  if (!params) return false
  const salt = Buffer.from(parts[2], 'hex')
  const expected = Buffer.from(parts[3], 'hex')
  let derived
  try {
    derived = scryptSync(String(plain ?? ''), salt, params.keyLen, {
      N: params.N, r: params.r, p: params.p
    })
  } catch {
    return false
  }
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}

export function isHashed(stored) {
  return typeof stored === 'string' && stored.startsWith('scrypt$')
}
