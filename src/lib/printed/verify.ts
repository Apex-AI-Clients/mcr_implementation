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
/** Closing stock is taken off cost of sales whether or not the label says "Less" (old reader lineCorrections sectionSum). */
const CLOSING_STOCK = /^(less:?\s*)?closing (stock|inventory)( on hand)?\b|^stock on hand at (the )?end/i
/** A line printed positive that its total subtracts. */
export const SUBTRACTED = (label: string) => LESS.test(label) || CLOSING_STOCK.test(label)

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`

interface Term {
  /** Counted with its section's sign: a cost against income, a liability against assets. */
  value: number
  /** As printed. */
  raw: number
  text: string
}

function polarity(heading: string): 1 | -1 {
  return NEGATIVE_SECTION.test(heading) ? -1 : 1
}

function lineTerm(row: PrintedRow, column: number): Term {
  const v = typeof row.amounts[column] === 'number' ? (row.amounts[column] as number) : 0
  const value = SUBTRACTED(row.label) && v > 0 ? -v : v
  return { value, raw: v, text: `${value < 0 && v > 0 ? '− ' : ''}${row.label || '(no label)'} ${money(v)}` }
}

interface ColumnSum {
  calculated: number
  terms: Term[]
  /** Every reading tried (for "printed in the wrong column"). */
  candidates: number[]
  matched: boolean
}

const sum = (terms: Term[], key: 'value' | 'raw') => terms.reduce((s, t) => s + t[key], 0)

/**
 * A printed total is the sum of the entries just above it in its section,
 * back to some point: every line since the section opened ("Total Current
 * Assets"), the previous result and what follows it ("Net Profit" after
 * "Gross Profit"), or just the last few lines (an unlabelled line under two
 * brought-forward balances). The longest run that adds up is taken, and the
 * total replaces it, so the next total builds on it. Signed by section, or as
 * printed; a cost section's total may be printed as a negative.
 */
function matchSuffix(
  entries: Term[],
  printed: number,
  tol: (n: number) => number,
  negativeSection: boolean,
): { hit: { start: number; calculated: number } | null; candidates: number[] } {
  const candidates: number[] = []
  let hit: { start: number; calculated: number } | null = null
  for (let start = 0; start < entries.length; start++) {
    const run = entries.slice(start)
    const readings = [sum(run, 'value'), sum(run, 'raw'), ...(negativeSection ? [-sum(run, 'value'), -sum(run, 'raw')] : [])]
    candidates.push(...readings)
    const found = readings.find((r) => Math.abs(r - printed) <= tol(run.length))
    if (found !== undefined && !hit) hit = { start, calculated: found }
  }
  return { hit, candidates }
}

/** The calculated value of every subtotal and total in one column. */
function columnSums(st: PrintedStatement, column: number, tol: (n: number) => number): Map<number, ColumnSum> {
  const pl = st.kind === 'profit_and_loss'
  const scopes = new Map<string, Term[]>()
  const out = new Map<number, ColumnSum>()
  const key = (path: string[]) => path.join('\u0000')
  const entries = (k: string) => scopes.get(k) ?? []

  st.rows.forEach((row, i) => {
    if (row.style === 'heading' || row.style === 'ratio') return
    const scope = key(row.path)
    if (row.style === 'line') {
      scopes.set(scope, [...entries(scope), lineTerm(row, column)])
      return
    }
    const printed = typeof row.amounts[column] === 'number' ? (row.amounts[column] as number) : 0
    const own = entries(scope)
    const section = row.path[row.path.length - 1] ?? ''
    const negative = row.style === 'subtotal' && polarity(section) < 0
    const { hit, candidates } = matchSuffix(own, printed, tol, negative)
    const start = hit?.start ?? 0
    out.set(i, { calculated: hit?.calculated ?? sum(own, 'value'), terms: own.slice(start), candidates, matched: hit !== null })
    const label = `${row.label || '(no label)'} ${money(printed)}`
    if (row.style === 'subtotal') {
      // The section closes: its total goes to the section above, signed.
      scopes.delete(scope)
      const parent = row.path.slice(0, -1)
      const sign = pl ? polarity(section) * (parent.length ? polarity(parent[parent.length - 1]) : 1) : parent.length ? 1 : polarity(section)
      const value = sign < 0 ? (printed > 0 ? -printed : printed) : printed
      const pkey = key(parent)
      scopes.set(pkey, [...entries(pkey), { value, raw: printed, text: `${value < 0 && printed > 0 ? '− ' : ''}${label}` }])
      return
    }
    // A result: it stands for what it totals.
    const value = !pl && /liabilit/i.test(row.label) && !/equity|net/i.test(row.label) ? -Math.abs(printed) : printed
    scopes.set(scope, [...own.slice(0, start), { value, raw: printed, text: label }])
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
  const tol = (n: number) => tolerance(st, n)
  const sums = st.columns.map((_, c) => columnSums(st, c, tol))

  st.rows.forEach((row, i) => {
    if (row.style !== 'subtotal' && row.style !== 'total') return
    st.columns.forEach((col, c) => {
      const sum = sums[c].get(i)
      if (!sum || sum.terms.length === 0) return
      const printed = typeof row.amounts[c] === 'number' ? (row.amounts[c] as number) : 0
      let status: TotalCheckStatus = sum.matched ? statusOf(printed - sum.calculated, tol(sum.terms.length)) : 'mismatch'
      if (status === 'mismatch' && sums.some((other, k) => k !== c && (other.get(i)?.candidates ?? []).some((x) => Math.abs(x - printed) <= tol(1)))) {
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

/** The printed total whose own label matches ("Total Assets", "TOTAL EQUITY"), as printed. */
function labelled(st: PrintedStatement, column: number, label: RegExp): number | null {
  const row = st.rows.find((r) => (r.style === 'subtotal' || r.style === 'total') && label.test(r.label.replace(/\s+/g, ' ').trim()))
  return row && typeof row.amounts[column] === 'number' ? (row.amounts[column] as number) : null
}

function balanceSheetEquation(st: PrintedStatement, index: number): TotalCheck[] {
  const out: TotalCheck[] = []
  st.columns.forEach((col, c) => {
    const assets = labelled(st, c, /^total assets$/i)
    const combined = labelled(st, c, /^total liabilities (and|&) (shareholders'?s?'? )?(equity|funds)$/i)
    const liabilities = labelled(st, c, /^total liabilities$/i)
    const equity = labelled(st, c, /^total (shareholders'?s?'? |members'? )?(equity|funds)$|^total trust funds$/i)
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
