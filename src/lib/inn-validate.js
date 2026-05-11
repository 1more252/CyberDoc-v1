
const W10 = [2, 4, 10, 3, 5, 9, 4, 6, 8, 0]
const W11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8, 0]
const W12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8, 0]

function digits(s) {
  return /^\d+$/.test(s)
}

export function isInnValid(inn) {
  if (typeof inn !== 'string' || !digits(inn)) return false
  if (inn.length === 10) {
    const sum = inn
      .split('')
      .slice(0, 10)
      .reduce((acc, ch, i) => acc + Number(ch) * W10[i], 0)
    return (sum % 11) % 10 === Number(inn[9])
  }
  if (inn.length === 12) {
    const sum1 = inn
      .split('')
      .slice(0, 11)
      .reduce((acc, ch, i) => acc + Number(ch) * W11[i], 0)
    const sum2 = inn
      .split('')
      .slice(0, 12)
      .reduce((acc, ch, i) => acc + Number(ch) * W12[i], 0)
    return (sum1 % 11) % 10 === Number(inn[10]) && (sum2 % 11) % 10 === Number(inn[11])
  }
  return false
}
