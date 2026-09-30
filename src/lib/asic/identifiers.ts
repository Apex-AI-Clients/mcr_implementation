/**
 * ACN and ABN check digits.
 *
 * Both numbers carry their own checksum, so a digit misread off a PDF — or a
 * document that only looks like an extract — can be caught before it fills a
 * form. Pure; used by the extract parser and safe to use in the browser.
 */

export const ACN_DIGITS = 9
export const ABN_DIGITS = 11

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * ASIC's ACN check: weights 8..1 on the first eight digits; the ninth is the
 * complement of the weighted sum mod 10 (with 10 meaning 0).
 */
export function isValidAcn(value: string): boolean {
  const acn = digitsOnly(value)
  if (acn.length !== ACN_DIGITS) return false
  let sum = 0
  for (let i = 0; i < 8; i++) sum += Number(acn[i]) * (8 - i)
  const check = (10 - (sum % 10)) % 10
  return check === Number(acn[8])
}

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]

/**
 * The ATO's ABN check: subtract 1 from the first digit, weight, and the sum
 * must divide by 89.
 */
export function isValidAbn(value: string): boolean {
  const abn = digitsOnly(value)
  if (abn.length !== ABN_DIGITS) return false
  let sum = 0
  for (let i = 0; i < ABN_DIGITS; i++) {
    const digit = Number(abn[i]) - (i === 0 ? 1 : 0)
    sum += digit * ABN_WEIGHTS[i]
  }
  return sum % 89 === 0
}

/** A company's ABN is its ACN with two check digits in front. */
export function abnMatchesAcn(abn: string, acn: string): boolean {
  return digitsOnly(abn).slice(2) === digitsOnly(acn)
}
