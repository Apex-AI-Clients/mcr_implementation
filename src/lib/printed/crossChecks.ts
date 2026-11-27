import type { ComparisonRow, PrintedComparison } from './compare'
import { lineRank } from './dictionary'
import { formatPrinted } from './csv'

/**
 * Checks across statements and periods (Gabby, 25 Nov 2026). Pure, over the built comparison; each
 * only where it applies: a check whose lines are not printed is left out (no badge, not a failure).
 *
 *   pl_agrees_bs     the profit and loss's net profit = the balance sheet's "Current Year Earnings"
 *                    (Xero, MYOB; "Profit for the year" under equity) for the same period. The net
 *                    profit is any line the dictionary reads as net profit ("Net Profit", "Net
 *                    profit after tax", "Profit before tax"); one of them must agree.
 *   carries_forward  "Retained Earnings" = the previous period's "Retained Earnings" + its "Current
 *                    Year Earnings" (Xero rolls the year's earnings into retained earnings on
 *                    1 July); or that plus the previous period's distributions / dividends in
 *                    equity, when the accountant closed those into retained earnings too. The
 *                    previous period is the year before (the current period's is the year it
 *                    follows), when shown.
 *
 * To the cent; statements in whole dollars to $1 (each figure rounded).
 *
 * A failed check names the lines and figures. When the profit and loss and the balance sheet of the
 * period come from different files, the note says so and offers each file that prints both
 * ("Use the same source for both").
 */

export type CrossCheckKind = 'pl_agrees_bs' | 'carries_forward'

export const CROSS_CHECK_BADGE: Record<CrossCheckKind, string> = {
  pl_agrees_bs: 'Profit and loss agrees with balance sheet',
  carries_forward: 'Carries forward from the previous year',
}

export interface CrossCheck {
  check: CrossCheckKind
  status: 'passed' | 'failed'
  badge: string
  /** Failed: what does not agree, in words with the printed figures. */
  note: string | null
  /** For the ⓘ: each figure used, as printed, with its file and page. */
  terms: string[]
  /** pl_agrees_bs: the file each statement's figure comes from. */
  sources?: { profitAndLoss: string | null; balanceSheet: string | null }
  /** Failed with the two statements from different files: the files printing both, to use for both. */
  sameSourceOffer?: { documentId: string; filename: string; label: string }[]
}

const EQUITY = /equity|capital|trust funds|members'? funds|shareholders'? funds|^funds$/i
const CURRENT_YEAR_EARNINGS = /^(current (year|period)'?s? (earnings|profits?( ?\/? ?\(?loss\)?)?|surplus)|(net )?profit (for|of) the (year|period))$/i
const RETAINED = /^retained (earnings|profits?)$/i
/** Equity lines that take a year's profit out: distributions to beneficiaries, dividends. */
const APPROPRIATION = /\b(distributions?|dividends?)\b/i

const valueAt = (r: ComparisonRow, i: number): number | null => {
  const c = r.cells[i]
  return c?.printed && typeof c.value === 'number' ? c.value : null
}
const inEquity = (r: ComparisonRow) => r.path.some((p) => EQUITY.test(p.trim()))
const tolerance = (...values: number[]) => (values.every((v) => Number.isInteger(v)) ? 1 : 0.005)
const money = (v: number) => formatPrinted(Math.round(v * 100) / 100)
const term = (r: ComparisonRow, i: number) => {
  const s = r.cells[i].source
  return `"${r.label.trim()}" ${money(valueAt(r, i)!)}${s ? ` — ${s.filename}, page ${s.page}` : ''}`
}

/** The equity line of that kind printed in column i (one only: two such lines is not a layout this check knows). */
function equityLine(bs: ComparisonRow[], i: number, label: RegExp): ComparisonRow | null {
  const found = bs.filter((r) => r.style !== 'heading' && r.style !== 'ratio' && inEquity(r) && label.test(r.label.trim()) && valueAt(r, i) !== null)
  return found.length === 1 ? found[0] : null
}

function previousColumn(comparison: PrintedComparison, i: number): number {
  const col = comparison.columns[i]
  return comparison.columns.findIndex((c) => c.kind === 'annual' && c.financialYear === col.financialYear - 1)
}

const columnName = (comparison: PrintedComparison, i: number) => {
  const c = comparison.columns[i]
  return c.kind === 'annual' ? c.key : 'the current period'
}

export function crossChecks(comparison: PrintedComparison): CrossCheck[][] {
  const pl = comparison.tables.find((t) => t.kind === 'profit_and_loss')?.rows ?? []
  const bs = comparison.tables.find((t) => t.kind === 'balance_sheet')?.rows ?? []
  return comparison.columns.map((_, i) => {
    const out: CrossCheck[] = []

    // ── Profit and loss agrees with balance sheet ──
    const earnings = equityLine(bs, i, CURRENT_YEAR_EARNINGS)
    const profits = pl
      .map((r, order) => ({ r, order, rank: lineRank('net_profit', r.label) }))
      .filter(({ r, rank }) => rank < 50 && r.style !== 'heading' && r.style !== 'ratio' && valueAt(r, i) !== null)
      .sort((a, b) => a.rank - b.rank || b.order - a.order)
      .map(({ r }) => r)
    if (earnings && profits.length) {
      const cye = valueAt(earnings, i)!
      const agreeing = profits.find((r) => Math.abs(valueAt(r, i)! - cye) <= tolerance(valueAt(r, i)!, cye))
      const profit = agreeing ?? profits[0]
      const plDoc = profit.cells[i].source?.documentId ?? null
      const bsDoc = earnings.cells[i].source?.documentId ?? null
      const check: CrossCheck = {
        check: 'pl_agrees_bs',
        status: agreeing ? 'passed' : 'failed',
        badge: CROSS_CHECK_BADGE.pl_agrees_bs,
        note: null,
        terms: [`Profit and loss: ${term(profit, i)}`, `Balance sheet: ${term(earnings, i)}`],
        sources: { profitAndLoss: plDoc, balanceSheet: bsDoc },
      }
      if (!agreeing) {
        const p = valueAt(profit, i)!
        let note = `Profit and loss does not agree with balance sheet (${columnName(comparison, i)}): "${profit.label.trim()}" ${money(p)} on the profit and loss, "${earnings.label.trim()}" ${money(cye)} on the balance sheet (difference ${money(p - cye)}).`
        if (plDoc && bsDoc && plDoc !== bsDoc) {
          const files = comparison.periodSources[i]?.statements ?? []
          const printing = (kind: 'profit_and_loss' | 'balance_sheet') => {
            const s = files.find((x) => x.statement === kind)
            return [...(s?.source ? [s.source] : []), ...(s?.alsoIn ?? [])]
          }
          const bsIds = new Set(printing('balance_sheet').map((x) => x.documentId))
          const both = printing('profit_and_loss').filter((x) => bsIds.has(x.documentId))
          note += ` They come from different files: the profit and loss from "${profit.cells[i].source!.filename}", the balance sheet from "${earnings.cells[i].source!.filename}".`
          check.sameSourceOffer = both.map((x) => ({ documentId: x.documentId, filename: x.filename, label: x.label }))
        }
        check.note = note
      }
      out.push(check)
    }

    // ── Carries forward from the previous year ──
    const prev = previousColumn(comparison, i)
    const retained = equityLine(bs, i, RETAINED)
    const retainedBefore = prev >= 0 ? equityLine(bs, prev, RETAINED) : null
    const earningsBefore = prev >= 0 ? equityLine(bs, prev, CURRENT_YEAR_EARNINGS) : null
    if (retained && retainedBefore && earningsBefore) {
      const now = valueAt(retained, i)!
      const expected = valueAt(retainedBefore, prev)! + valueAt(earningsBefore, prev)!
      const tol = tolerance(now, valueAt(retainedBefore, prev)!, valueAt(earningsBefore, prev)!)
      // The year's distributions or dividends, when the accountant closed them into retained
      // earnings too (Fortitude FY2022 → FY2023): tried as a second reading, exact like the first.
      const appropriations = bs.filter((r) => r.style === 'line' && inEquity(r) && APPROPRIATION.test(r.label) && valueAt(r, prev) !== null && valueAt(r, prev) !== 0)
      const closed = expected + appropriations.reduce((s, r) => s + valueAt(r, prev)!, 0)
      const plain = Math.abs(now - expected) <= tol
      const withAppropriations = !plain && appropriations.length > 0 && Math.abs(now - closed) <= tol
      const before = columnName(comparison, prev)
      out.push({
        check: 'carries_forward',
        status: plain || withAppropriations ? 'passed' : 'failed',
        badge: CROSS_CHECK_BADGE.carries_forward,
        note:
          plain || withAppropriations
            ? null
            : `Does not carry forward from ${before} (${columnName(comparison, i)}): "${retained.label.trim()}" ${money(now)}, but ${before}'s "${retainedBefore.label.trim()}" ${money(valueAt(retainedBefore, prev)!)} + "${earningsBefore.label.trim()}" ${money(valueAt(earningsBefore, prev)!)} = ${money(expected)} (difference ${money(now - expected)})${appropriations.length ? `; with ${before}'s ${appropriations.map((r) => `"${r.label.trim()}" ${money(valueAt(r, prev)!)}`).join(', ')} closed into it, ${money(closed)}` : ''}.`,
        terms: [
          `${before}: ${term(retainedBefore, prev)}`,
          `${before}: ${term(earningsBefore, prev)}`,
          ...(withAppropriations ? appropriations.map((r) => `${before}, closed into retained earnings: ${term(r, prev)}`) : []),
          `Now: ${term(retained, i)}`,
        ],
      })
    }
    return out
  })
}
