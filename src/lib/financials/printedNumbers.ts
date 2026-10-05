import { normaliseLabel } from './labels'

/**
 * The numbers printed on a statement line, read from our own text layer, with
 * signs as the PDF shows them. Pure.
 *
 * Some accountants print a negative with a minus AFTER the number ("4,682 -")
 * or a spaced minus before it ("- 139,668"), as well as in brackets. A model
 * reading the page can drop such a sign; this reads it back.
 *
 *   "(1,234)"   -1234        "-1,234"  -1234       "1,234-"  -1234
 *   "1,234 -"   -1234 only when the line holds one number per column, so the
 *               dash cannot be a nil column instead
 *   "- 1,234"   -1234, same condition
 *   "-" alone   nil
 *   a dash between two numbers is a trailing sign or a leading one: a dash at
 *   either end of the line shows which convention the line uses; with no
 *   such dash (or both), the line is not read (null)
 */

interface NumberToken {
  kind: 'number'
  value: number
  signed: boolean
}
interface DashToken {
  kind: 'dash'
}
type Token = NumberToken | DashToken

const NUMBER = /^(\()?\$?(-)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(-)?(\))?$/

function tokenise(tail: string[]): Token[] | null {
  const out: Token[] = []
  for (const raw of tail) {
    if (raw === '$') continue
    if (/^[-–—]$/.test(raw)) {
      out.push({ kind: 'dash' })
      continue
    }
    const m = NUMBER.exec(raw)
    if (!m) return null
    const magnitude = parseFloat(`${m[3].replace(/,/g, '')}${m[4] ?? ''}`)
    const negative = Boolean((m[1] && m[6]) || m[2] || m[5])
    out.push({ kind: 'number', value: negative ? -magnitude : magnitude, signed: negative })
  }
  return out
}

/**
 * The column values of one printed line's figures, or null when the line
 * cannot be read without guessing.
 */
export function parsePrintedAmounts(tail: string[], columns: number): Array<number | null> | null {
  const tokens = tokenise(tail)
  if (!tokens || tokens.length === 0) return null
  const numbers = tokens.filter((t): t is NumberToken => t.kind === 'number').length
  const values: Array<number | null> = []

  // A dash at either end can only be a sign, and tells us this line's
  // convention — which then settles a dash between two numbers.
  const leadsWithSign = tokens[0]?.kind === 'dash' && tokens[1]?.kind === 'number'
  const endsWithSign = tokens.at(-1)?.kind === 'dash' && tokens.at(-2)?.kind === 'number'
  const convention = leadsWithSign && !endsWithSign ? 'leading' : endsWithSign && !leadsWithSign ? 'trailing' : null

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.kind === 'number') {
      values.push(t.value)
      continue
    }
    const prev = tokens[i - 1]
    const next = tokens[i + 1]
    const prevNumber = prev?.kind === 'number' ? prev : null
    const nextNumber = next?.kind === 'number' ? next : null
    if (!prevNumber && !nextNumber) {
      values.push(null) // a nil column
    } else if (numbers !== columns) {
      // Fewer numbers than columns: the dash may be a nil column. Do not guess.
      return null
    } else if (prevNumber && nextNumber) {
      // Trailing on one, or leading on the other: the line's convention decides.
      if (convention === 'trailing' && !prevNumber.signed) {
        values[values.length - 1] = -Math.abs(prevNumber.value)
        prevNumber.signed = true
      } else if (convention === 'leading' && !nextNumber.signed) {
        nextNumber.value = -Math.abs(nextNumber.value)
        nextNumber.signed = true
      } else {
        return null
      }
    } else if (prevNumber && !prevNumber.signed) {
      values[values.length - 1] = -Math.abs(prevNumber.value)
      prevNumber.signed = true
    } else if (nextNumber && !nextNumber.signed) {
      nextNumber.value = -Math.abs(nextNumber.value)
      nextNumber.signed = true
    }
  }
  return values.length === columns ? values : null
}

/**
 * Find a label's printed line on the statement pages and read its figures.
 * The line must start with the label; the rest must be figures only.
 */
export function printedAmountsFor(
  rawLabel: string,
  pageLines: readonly string[],
  columns: number,
): Array<number | null> | null {
  const label = normaliseLabel(rawLabel)
  if (!label) return null
  for (const text of pageLines) {
    const words = text.trim().split(/\s+/)
    // The figures are the trailing run of number / dash / "$" words.
    let k = words.length
    while (k > 0 && (NUMBER.test(words[k - 1]) || /^[-–—$]$/.test(words[k - 1]))) k--
    if (k === words.length || k === 0) continue
    if (normaliseLabel(words.slice(0, k).join(' ')) !== label) continue
    return parsePrintedAmounts(words.slice(k), columns)
  }
  return null
}
