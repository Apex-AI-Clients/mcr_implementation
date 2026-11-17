import { effectOf, type IcaRow } from './types'
import { isInterest, isInterestSummary, isPaymentTotal, isRefund, isSubLine } from './wording'

/**
 * The repeating structures of an ATO account export, and the ways each can be
 * read. The first reading is the rule's; the others are tried only where the
 * ATO's running balance does not match the first (reconcile.ts). Whichever
 * reading is used, every row is counted at most once and no structure is
 * counted twice.
 *
 *   statement + sub-lines   "Original Activity Statement…" with "- GST",
 *                           "- PAYG Withholding" below it (same processed
 *                           date; a sub-line's effective date can differ): the
 *                           statement row's amount when it has one, otherwise
 *                           the sum of its sub-lines (Yan-Trow, 16 Nov 2026:
 *                           the amounts are only on the sub-lines). Never both.
 *   payment + allocations   "Payment received" with a balance, and rows with
 *                           no balance below it (same dates) showing how it
 *                           was allocated: the payment once.
 *   refund + details        "Refund"/"EFT refund…" with a balance and its
 *                           breakdown rows: the refund once.
 *   interest summary        "General interest charge" with a balance over the
 *   + detail rows           interest rows it sums ("Amended general interest
 *                           charge calculated from…", remissions): one of
 *                           them, never both.
 *
 * Every other row is read as printed.
 */

export type GroupKind = 'single' | 'statement' | 'payment' | 'refund' | 'interest'

export type ReadingName = 'as_printed' | 'statement_row' | 'sub_lines' | 'total' | 'breakdown' | 'both'

export interface Reading {
  name: ReadingName
  /** The row ids this reading counts. */
  counted: number[]
}

export interface Group {
  id: number
  kind: GroupKind
  /** The statement row, or the row with the balance (the total). */
  head: number
  /** The sub-lines or breakdown rows. */
  parts: number[]
  /** readings[0] is the rule's reading. */
  readings: Reading[]
}

export const READING_WORDS: Record<ReadingName, string> = {
  as_printed: 'as printed',
  statement_row: "the statement row's amount (its sub-lines split it)",
  sub_lines: 'the sum of its sub-lines (the statement row has no amount)',
  total: 'the total row once (the rows under it break it down)',
  breakdown: 'the rows under it (the total row sums them)',
  both: 'every row (the rows under the total are separate amounts)',
}

const sameDates = (a: IcaRow, b: IcaRow) => a.rawProcessed === b.rawProcessed && a.rawEffective === b.rawEffective
/** Sub-lines share the statement's processed date; their effective date can differ (a fuel tax credit line is dated the day it was processed). */
const sameProcessed = (a: IcaRow, b: IcaRow) => a.rawProcessed === b.rawProcessed

const sumEffect = (rows: IcaRow[]) => rows.reduce((s, r) => s + effectOf(r), 0)

export function buildGroups(rows: IcaRow[]): Group[] {
  const groupOf = new Map<number, number>()
  const groups: Group[] = []
  const add = (g: Omit<Group, 'id'>) => {
    const id = groups.length
    groups.push({ ...g, id })
    for (const r of [g.head, ...g.parts]) groupOf.set(r, id)
  }

  // 1. Statements and their sub-lines: the sub-lines directly below a row (same dates), or failing that directly above it.
  for (let i = 0; i < rows.length; i++) {
    const head = rows[i]
    if (isSubLine(head.description) || groupOf.has(i)) continue
    const below: number[] = []
    for (let j = i + 1; j < rows.length && isSubLine(rows[j].description) && sameProcessed(rows[j], head); j++) below.push(j)
    let parts = below
    if (parts.length === 0) {
      const above: number[] = []
      for (let j = i - 1; j >= 0 && isSubLine(rows[j].description) && sameProcessed(rows[j], head) && !groupOf.has(j); j--) above.unshift(j)
      // Only when those sub-lines have no statement row of their own above them.
      const before = above.length ? above[0] - 1 : -1
      const ownedAbove = before >= 0 && !isSubLine(rows[before].description) && sameProcessed(rows[before], rows[above[0]])
      if (!ownedAbove) parts = above
    }
    if (parts.length === 0) continue
    const statementRow: Reading = { name: 'statement_row', counted: [i] }
    const subLines: Reading = { name: 'sub_lines', counted: parts }
    add({ kind: 'statement', head: i, parts, readings: effectOf(head) !== 0 ? [statementRow, subLines] : [subLines, statementRow] })
  }

  // 2. Totals with the rows that break them down (no balance, same dates, same kind), below or else above.
  const kindOf = (r: IcaRow): GroupKind | null =>
    isPaymentTotal(r.description) ? 'payment' : isRefund(r.description) ? 'refund' : isInterest(r.description) ? 'interest' : null
  for (let i = 0; i < rows.length; i++) {
    const head = rows[i]
    if (groupOf.has(i) || head.balance === null) continue
    const kind = kindOf(head)
    if (!kind) continue
    const runFrom = (step: 1 | -1) => {
      const run: number[] = []
      for (let j = i + step; j >= 0 && j < rows.length; j += step) {
        const r = rows[j]
        if (groupOf.has(j) || r.balance !== null || !sameDates(r, head) || kindOf(r) !== kind) break
        run.push(j)
      }
      return step === 1 ? run : run.reverse()
    }
    let parts = runFrom(1)
    if (parts.length === 0) parts = runFrom(-1)
    if (parts.length === 0) continue
    const sumsToTotal = sumEffect(parts.map((p) => rows[p])) === effectOf(head)
    const total: Reading = { name: 'total', counted: [i] }
    const breakdown: Reading = { name: 'breakdown', counted: parts }
    const both: Reading = { name: 'both', counted: [i, ...parts] }
    let readings: Reading[]
    if (!sumsToTotal) readings = [both, total, breakdown]
    // Interest: the rows under a summary are counted (they show what was charged and what was remitted).
    else if (kind === 'interest' && isInterestSummary(head.description)) readings = [breakdown, total, both]
    else readings = [total, breakdown, both]
    add({ kind, head: i, parts, readings })
  }

  // 3. Every other row, as printed.
  for (let i = 0; i < rows.length; i++) {
    if (!groupOf.has(i)) add({ kind: 'single', head: i, parts: [], readings: [{ name: 'as_printed', counted: [i] }] })
  }
  return groups.sort((a, b) => a.head - b.head).map((g, id) => ({ ...g, id }))
}
