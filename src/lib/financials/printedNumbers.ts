import { normaliseLabel } from './labels'

/**
 * A statement row's figures, read from our own text layer — one value per
 * column, in heading order. Pure.
 *
 *   "Superannuation - 1,137"        two columns: nil, 1,137
 *   "Training 6,700 -"              two columns: 6,700, nil
 *   "Wages - -"                     two columns: nil, nil
 *   "(1,234)", "-1,234", "1,234-"   negative (sign attached to the number)
 *
 * A standalone "-" is a nil column. When a row holds MORE tokens than there
 * are columns, some dash must be a sign instead ("4,682 -" in a one-column
 * statement, "- 139,668 - 116,215" in two): every reading is tried, and the
 * row is accepted only when exactly one set of values fits. Otherwise it is
 * not read (null), and the caller keeps the model's value.
 */

interface NumberToken {
  kind: 'number'
  value: number
  /** Already negative from brackets or an attached minus: a dash cannot sign it again. */
  signed: boolean
}
interface DashToken {
  kind: 'dash'
}
type Token = NumberToken | DashToken

const NUMBER = /^(\()?\$?(-)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(-)?(\))?$/
const DASH = /^[-–—]$/

function tokenise(tail: string[]): Token[] | null {
  const out: Token[] = []
  for (const raw of tail) {
    if (raw === '$') continue
    if (DASH.test(raw)) {
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

/** Every way of reading the dashes: each is a nil column, or the sign of the number beside it. */
function readings(tokens: Token[]): Array<Array<number | null>> {
  const out: Array<Array<number | null>> = []
  const walk = (i: number, acc: Array<number | null>, signedNext: boolean, lastWasUnsignedNumber: boolean) => {
    if (i === tokens.length) {
      if (!signedNext) out.push(acc)
      return
    }
    const t = tokens[i]
    if (t.kind === 'number') {
      if (signedNext) {
        if (t.signed) return
        walk(i + 1, [...acc, -Math.abs(t.value)], false, false)
      } else {
        walk(i + 1, [...acc, t.value], false, !t.signed)
      }
      return
    }
    if (signedNext) return // two dashes in a row cannot both be signs of one number
    // A nil column.
    walk(i + 1, [...acc, null], false, false)
    // The sign of the number before it (trailing minus).
    if (lastWasUnsignedNumber) {
      const prev = acc[acc.length - 1] as number
      walk(i + 1, [...acc.slice(0, -1), -Math.abs(prev)], false, false)
    }
    // The sign of the number after it (leading minus).
    if (tokens[i + 1]?.kind === 'number') walk(i + 1, acc, true, false)
  }
  walk(0, [], false, false)
  return out
}

/**
 * The column values of one printed row, or null when the row cannot be read
 * without guessing.
 */
export function parsePrintedAmounts(tail: string[], columns: number): Array<number | null> | null {
  const tokens = tokenise(tail)
  if (!tokens || tokens.length === 0) return null
  const fits = readings(tokens).filter((r) => r.length === columns)
  const distinct = [...new Map(fits.map((r) => [JSON.stringify(r), r])).values()]
  return distinct.length === 1 ? distinct[0] : null
}

/**
 * Find a label's printed row on the statement pages and read its figures.
 * The row must start with the label; the rest must be figures only. A label
 * printed on more than one row with different figures is not read.
 */
export function printedAmountsFor(
  rawLabel: string,
  pageLines: readonly string[],
  columns: number,
): Array<number | null> | null {
  const label = normaliseLabel(rawLabel)
  if (!label) return null
  let found: Array<number | null> | null = null
  for (const text of pageLines) {
    const words = text.trim().split(/\s+/)
    // The figures are the trailing run of number / dash / "$" words.
    let k = words.length
    while (k > 0 && (NUMBER.test(words[k - 1]) || DASH.test(words[k - 1]) || words[k - 1] === '$')) k--
    if (k === words.length || k === 0) continue
    if (normaliseLabel(words.slice(0, k).join(' ')) !== label) continue
    const values = parsePrintedAmounts(words.slice(k), columns)
    if (!values) return null
    if (found && JSON.stringify(found) !== JSON.stringify(values)) return null
    found = values
  }
  return found
}

/**
 * Every printed row carrying this label, in page order — for labels printed
 * more than once ("Total Income" twice). A row that cannot be read is null.
 */
export function printedRowsFor(
  rawLabel: string,
  pageLines: readonly string[],
  columns: number,
): Array<Array<number | null> | null> {
  const label = normaliseLabel(rawLabel)
  const rows: Array<Array<number | null> | null> = []
  if (!label) return rows
  for (const text of pageLines) {
    const words = text.trim().split(/\s+/)
    let k = words.length
    while (k > 0 && (NUMBER.test(words[k - 1]) || DASH.test(words[k - 1]) || words[k - 1] === '$')) k--
    if (k === words.length || k === 0) continue
    if (normaliseLabel(words.slice(0, k).join(' ')) !== label) continue
    rows.push(parsePrintedAmounts(words.slice(k), columns))
  }
  return rows
}
