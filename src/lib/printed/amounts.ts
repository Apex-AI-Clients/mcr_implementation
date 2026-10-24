/**
 * One printed amount cell -> its value, exactly as printed. Pure.
 *
 *   "1,234"  "1,234.56"  "$1,234"  "A$1,234"  "AUD 1,234"   1234 / 1234.56
 *   "-1,234"  "(1,234)"  "1,234 -"  "1,234-"  "1,234 CR"    -1234
 *   "1,234 DR"                                              1234
 *   "-"  "–"  "—"  "nil"  ""                                null (nil)
 *   "88%"                                                   a ratio, kept as text
 *
 * Anything else is not an amount (undefined): a label, a note reference
 * column is told apart by position, not here.
 */

export type ParsedAmount = { kind: 'amount'; value: number | null; cents: boolean } | { kind: 'ratio'; text: string }

const NIL = /^(-|–|—|nil)$/i
const RATIO = /^-?\(?\d{1,3}(\.\d+)?\)?\s?%$/
const BODY = /^(\d{1,3}(,\d{3})*|\d+)(\.\d{1,2})?$/

export function parseAmount(raw: string): ParsedAmount | undefined {
  let t = raw.trim()
  if (t === '' || NIL.test(t)) return { kind: 'amount', value: null, cents: false }
  if (RATIO.test(t)) return { kind: 'ratio', text: t }

  let negative = false
  const crdr = /\s?(CR|DR|Cr|Dr)$/.exec(t)
  if (crdr) {
    negative = crdr[1].toUpperCase() === 'CR'
    t = t.slice(0, crdr.index).trim()
  }
  if (t.startsWith('(') && t.endsWith(')')) {
    negative = true
    t = t.slice(1, -1).trim()
  }
  if (t.startsWith('-') || t.startsWith('−')) {
    negative = true
    t = t.slice(1).trim()
  } else if (/\s?-$/.test(t)) {
    negative = true
    t = t.replace(/\s?-$/, '').trim()
  }
  t = t.replace(/^(A\$|AU\$|AUD\s?|\$)\s?/i, '')
  // A currency sign printed inside the brackets or after the minus: "($1,234)", "-$1,234".
  if (t.startsWith('(') && t.endsWith(')')) {
    negative = true
    t = t.slice(1, -1).trim()
  }
  if (!BODY.test(t)) return undefined
  const value = Number(t.replace(/,/g, ''))
  if (!Number.isFinite(value)) return undefined
  return { kind: 'amount', value: negative && value !== 0 ? -value : value, cents: t.includes('.') }
}

/** A lone minus printed left of its figure, in the same column ("- 116,215"). */
export function isLoneMinus(raw: string): boolean {
  return /^(-|–|−)$/.test(raw.trim())
}
