// Browser-mock password adapter: plain text compare (no crypto in browser).
// Real server инжектит scrypt-имплементацию через setPasswordHasher().

export function hash(plain) {
  return String(plain ?? '')
}

export function verify(plain, stored) {
  return String(plain ?? '') === String(stored ?? '')
}

// Признак, что значение уже захешировано (для ленивой миграции на сервере).
// В мок-режиме всегда false → пересохранения не происходит.
export function isHashed(_stored) {
  return false
}
