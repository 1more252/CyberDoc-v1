
export function isOgrnValid(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return false
  if (value.length === 13) {
    const n = BigInt(value.slice(0, 12))
    return Number(n % 11n) % 10 === Number(value[12])
  }
  if (value.length === 15) {
    const n = BigInt(value.slice(0, 14))
    return Number(n % 13n) % 10 === Number(value[14])
  }
  return false
}
