import type { PrintedRow, PrintedStatement } from './types'

/**
 * Every printed total checked against the printed lines it totals. Pure;
 * reports, never changes a figure.
 *
 *   subtotal  "Total Current Assets" = the lines and inner totals of its section.
 *   total     "Gross profit", "Net Profit", "Net Assets" = the previous result
 *             line in the same section + everything printed since it. On a profit
 *             and loss a cost or expense section counts against income; on a
 *             balance sheet, liabilities against assets.
 *   balance sheet  total assets = total liabilities + total equity (or the printed
 *             "Total liabilities and equity"); net assets = total equity.
 *
 * "Less: Closing Stock 36,850" printed positive is taken off; "Less Accumulated
 * Depreciation (90,729)" printed negative is added as printed.
 *
 * Exact to the cent; a statement printed in whole dollars to rounding: 50c per
 * figure added (a total of 27 rounded expenses may be $3 out).
 *
 * A total that fails in its own column but matches another column's lines is
 * reported as printed in the wrong column.
 */

export type TotalCheckStatus = 'ok' | 'rounding' | 'mismatch' | 'wrong_column'

export interface TotalCheck {
  statement: number
  /** Index into the statement's rows; null for the balance-sheet equation. */
  row: number | null
  column: number
  kind: 'subtotal' | 'total' | 'balance_sheet'
  label: string
  printed: number
  calculated: number
  status: TotalCheckStatus
  /** What was added, as printed: "Sales 1,001,027", "− Total Cost of Sales 424,710". */
  terms: string[]
  message: string
}

const NEGATIVE_SECTION = /cost|expense|outgoing|deduct|liabilit/i
const LESS = /^less\b/i

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`

interface Term {
  value: number
  text: string
}

function polarity(heading: string): 1 | -1 {
  return NEGATIVE_SECTION.test(heading) ? -1 : 1
}

function lineTerm(row: PrintedRow, column: number): Term {
  const v = typeof row.amounts[column] === 'number' ? (row.amounts[column] as number) : 0
  const value = LESS.test(row.label) && v > 0 ? -v : v
  return { value, text: `${value < 0 && v > 0 ? '− ' : ''}${row.label || '(no label)'} ${money(v)}` }
}

/** The calculated value of every subtotal and total in one column. */
function columnSums(st: PrintedStatement, column: number): Map<number, { calculated: number; terms: Term[] }> {
  const pl = st.kind === 'profit_and_loss'
  const items = new Map<string, Term[]>()
  const lastResult = new Map<string, Term>()
  const out = new Map<number, { calculated: number; terms: Term[] }>()
  const key = (path: string[]) => path.join('\u0000')

  st.rows.forEach((row, i) => {
    if (row.style === 'heading' || row.style === 'ratio') return
    const scope = key(row.path)
    if (row.style === 'line') {
      items.set(scope, [...(items.get(scope) ?? []), lineTerm(row, column)])
      return
    }
    const printed = typeof row.amounts[column] === 'number' ? (row.amounts[column] as number) : 0
    if (row.style === 'subtotal') {
      const terms = items.get(scope) ?? []
      items.delete(scope)
      out.set(i, { calculated: terms.reduce((s, t) => s + t.value, 0), terms })
      const parent = row.path.slice(0, -1)
      const section = row.path[row.path.length - 1] ?? ''
      const sign = pl ? polarity(section) * (parent.length ? polarity(parent[parent.length - 1]) : 1) : parent.length ? 1 : polarity(section)
      const pkey = key(parent)
      items.set(pkey, [...(items.get(pkey) ?? []), { value: sign * printed, text: `${sign < 0 ? '− ' : ''}${row.label || '(no label)'} ${money(printed)}` }])
      return
    }
    const previous = lastResult.get(scope)
    const terms = [...(previous ? [previous] : []), ...(items.get(scope) ?? [])]
    items.delete(scope)
    out.set(i, { calculated: terms.reduce((s, t) => s + t.value, 0), terms })
    lastResult.set(scope, { value: printed, text: `${row.label} ${money(printed)}` })
  })
  return out
}

function tolerance(st: PrintedStatement, terms: number): number {
  return st.wholeDollars ? Math.max(1, 0.5 * terms) : 0.005
}

function statusOf(diff: number, tol: number): TotalCheckStatus {
  if (Math.abs(diff) < 0.005) return 'ok'
  return Math.abs(diff) <= tol ? 'rounding' : 'mismatch'
}

export function verifyStatement(st: PrintedStatement, index: number): TotalCheck[] {
  const checks: TotalCheck[] = []
  const sums = st.columns.map((_, c) => columnSums(st, c))

  st.rows.forEach((row, i) => {
    if (row.style !== 'subtotal' && row.style !== 'total') return
    st.columns.forEach((col, c) => {
      const sum = sums[c].get(i)
      if (!sum || sum.terms.length === 0) return
      const printed = typeof row.amounts[c] === 'number' ? (row.amounts[c] as number) : 0
      const tol = tolerance(st, sum.terms.length)
      let status = statusOf(printed - sum.calculated, tol)
      if (status === 'mismatch' && sums.some((other, k) => k !== c && Math.abs((other.get(i)?.calculated ?? NaN) - printed) <= tol)) {
        status = 'wrong_column'
      }
      checks.push({
        statement: index,
        row: i,
        column: c,
        kind: row.style as 'subtotal' | 'total',
        label: row.label,
        printed,
        calculated: sum.calculated,
        status,
        terms: sum.terms.map((t) => t.text),
        message:
          status === 'wrong_column'
            ? `"${row.label}" ${money(printed)} in ${col.header} is what the lines of another column add to: printed in the wrong column.`
            : `"${row.label}" ${col.header}: printed ${money(printed)}, lines add to ${money(sum.calculated)}.`,
      })
    })
  })

  if (st.kind === 'balance_sheet') checks.push(...balanceSheetEquation(st, index))
  return checks
}

/** The printed total of the section whose heading matches, at depth 1 (or anywhere for equity under a combined heading). */
function sectionTotal(st: PrintedStatement, column: number, test: (heading: string) => boolean, anyDepth = false): number | null {
  const row = st.rows.find((r) => r.style === 'subtotal' && (anyDepth ? r.path.length >= 1 : r.path.length === 1) && test(r.path[r.path.length - 1]))
  return row && typeof row.amounts[column] === 'number' ? (row.amounts[column] as number) : null
}

function balanceSheetEquation(st: PrintedStatement, index: number): TotalCheck[] {
  const out: TotalCheck[] = []
  st.columns.forEach((col, c) => {
    const assets = sectionTotal(st, c, (h) => /assets/i.test(h) && !/liabilit|net/i.test(h))
    const combined = sectionTotal(st, c, (h) => /liabilit/i.test(h) && /equity|funds/i.test(h))
    const liabilities = sectionTotal(st, c, (h) => /liabilit/i.test(h) && !/equity|funds/i.test(h))
    const equity = sectionTotal(st, c, (h) => /equity|trust funds|capital/i.test(h) && !/liabilit/i.test(h), true)
    const netRow = st.rows.find((r) => r.style === 'total' && /^net (assets|liabilities)\b/i.test(r.label))
    const net = netRow && typeof netRow.amounts[c] === 'number' ? (netRow.amounts[c] as number) : null
    const tol = tolerance(st, 3)
    const push = (label: string, printed: number, calculated: number, terms: string[]) => {
      const status = statusOf(printed - calculated, tol)
      out.push({ statement: index, row: null, column: c, kind: 'balance_sheet', label, printed, calculated, status, terms, message: `${col.header}: ${label}: ${money(printed)} against ${money(calculated)}.` })
    }
    if (assets !== null && combined !== null) push('Total assets = total liabilities and equity', assets, combined, [`Total liabilities and equity ${money(combined)}`])
    else if (assets !== null && liabilities !== null && equity !== null) {
      push('Total assets = total liabilities + total equity', assets, liabilities + equity, [`Total liabilities ${money(liabilities)}`, `Total equity ${money(equity)}`])
    }
    if (net !== null && equity !== null) push('Net assets = total equity', net, equity, [`Total equity ${money(equity)}`])
  })
  return out
}

export function verifyStatements(statements: PrintedStatement[]): TotalCheck[] {
  return statements.flatMap((st, i) => verifyStatement(st, i))
}
