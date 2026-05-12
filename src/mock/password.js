// Browser-mock password adapter: plain text compare (no crypto in browser).
// Реальный сервер инжектит scrypt-имплементацию через setPasswordHasher().
//
// Возвращаем Promise — на сервере hasher async (node:crypto scrypt в
// thread-pool). Сигнатуры должны совпадать, чтобы хендлеры могли await'ить
// независимо от реализации.

export async function hash(plain) {
  return String(plain ?? '')
}

export async function verify(plain, stored) {
  return String(plain ?? '') === String(stored ?? '')
}

// Признак, что значение уже захешировано (для ленивой миграции на сервере).
// В мок-режиме всегда false → пересохранения не происходит.
export function isHashed(_stored) {
  return false
}
