/**
 * ACN and ABN check digits.
 *
 * Both numbers carry one, and checking it here is free, whereas sending a typo
 * to the provider is at best a wasted lookup. The free check only runs once an
 * ACN passes this, and a purchase is refused outright if it does not.
 *
 * Browser-safe: pure functions.
 */

const ACN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 1]
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]

/** Whatever spacing somebody typed or pasted -> bare digits. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * ASIC's ACN rule: weight the first eight digits 8..1, and the ninth is the
 * complement of the sum mod 10.
 */
export function isValidAcn(value: string): boolean {
  const acn = digitsOnly(value)
  if (acn.length !== 9) return false
  const sum = ACN_WEIGHTS.reduce((total, weight, i) => total + weight * Number(acn[i]), 0)
  return (10 - (sum % 10)) % 10 === Number(acn[8])
}

/**
 * The ATO's ABN rule: subtract 1 from the first digit, weight, and the total
 * must divide by 89.
 */
export function isValidAbn(value: string): boolean {
  const abn = digitsOnly(value)
  if (abn.length !== 11) return false
  const sum = ABN_WEIGHTS.reduce((total, weight, i) => {
    const digit = Number(abn[i]) - (i === 0 ? 1 : 0)
    return total + weight * digit
  }, 0)
  return sum % 89 === 0
}

/** "000000019" -> "000 000 019", the way ASIC prints it. */
export function formatAcn(value: string): string {
  const acn = digitsOnly(value)
  return acn.length === 9 ? `${acn.slice(0, 3)} ${acn.slice(3, 6)} ${acn.slice(6)}` : value
}
