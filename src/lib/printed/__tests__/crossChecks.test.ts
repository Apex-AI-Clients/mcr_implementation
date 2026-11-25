import { describe, it, expect } from 'vitest'
import { buildPrintedComparison, type ComparisonDocument } from '../compare'
import { comparisonProof, STATEMENTS_BADGE } from '../proof'
import { CROSS_CHECK_BADGE } from '../crossChecks'
import { failedCrossChecks } from '../crossCheckAlerts'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '../types'

/**
 * "Profit and loss agrees with balance sheet" and "Carries forward from the previous year"
 * (Gabby, 25 Nov 2026). Synthetic statements, laid out as Xero prints them; the real Fortitude
 * files are in `npm run printed:check`.
 */

const annual = (fy: number): PrintedColumn => ({ header: String(fy), periodStart: `${fy - 1}-07-01`, periodEnd: `${fy}-06-30`, kind: 'annual', financialYear: fy })
const asAt = (c: PrintedColumn): PrintedColumn => ({ ...c, periodStart: null, header: `30 JUNE ${c.financialYear}` })
const r = (path: string[], label: string, style: PrintedRow['style'], amounts: (number | null)[]): PrintedRow => ({ page: 1, path, label, style, amounts, text: label })

function pl(columns: PrintedColumn[], profit: number[]): PrintedStatement {
  return {
    kind: 'profit_and_loss',
    title: 'Profit and Loss',
    pages: [1],
    columns,
    rows: [r(['Trading Income'], 'Sales', 'line', profit), r(['Trading Income'], 'Total Trading Income', 'subtotal', profit), r([], 'Net Profit', 'total', profit)],
    wholeDollars: false,
  }
}

/** Equity only: Retained Earnings + Current Year Earnings (+ Distribution) = Total Equity. */
function bs(columns: PrintedColumn[], retained: number[], earnings: number[], distribution?: number[]): PrintedStatement {
  const total = retained.map((v, i) => Math.round((v + earnings[i] + (distribution?.[i] ?? 0)) * 100) / 100)
  return {
    kind: 'balance_sheet',
    title: 'Balance Sheet',
    pages: [1],
    columns: columns.map(asAt),
    rows: [
      r(['Equity'], 'Current Year Earnings', 'line', earnings),
      ...(distribution ? [r(['Equity'], 'Distribution to Beneficiaries', 'line', distribution)] : []),
      r(['Equity'], 'Retained Earnings', 'line', retained),
      r(['Equity'], 'Total Equity', 'subtotal', total),
    ],
    wholeDollars: false,
  }
}

const doc = (id: string, kind: 'export' | 'annual_statements', ...statements: PrintedStatement[]): ComparisonDocument => ({
  documentId: id,
  filename: `${id}.pdf`,
  uploadedAt: '2026-11-20',
  read: { status: 'read', pageCount: 1, statements, issues: [], report: { kind, markers: kind === 'export' ? [] : ['Contents page (page 1)'] } },
})

const YEARS = [2026, 2025, 2024].map(annual)
const proofOf = (docs: ComparisonDocument[]) => comparisonProof(buildPrintedComparison(docs))
const year = (proofs: ReturnType<typeof comparisonProof>, column: string) => proofs.find((p) => p.column === column)!

describe('cross-checks', () => {
  it('both pass on a Xero layout: three badges, proven', () => {
    // Fortitude's figures: 149,111.15 + 172,799.90 = 321,911.05.
    const proofs = proofOf([doc('pl', 'export', pl(YEARS, [-53586.4, 172799.9, 88331.14])), doc('bs', 'export', bs(YEARS, [321911.05, 149111.15, 60780.01], [-53586.4, 172799.9, 88331.14]))])
    const fy26 = year(proofs, 'FY2026')
    expect(fy26.status).toBe('proven')
    expect(fy26.badges).toEqual([STATEMENTS_BADGE, CROSS_CHECK_BADGE.pl_agrees_bs, CROSS_CHECK_BADGE.carries_forward])
    expect(fy26.crossChecks.find((c) => c.check === 'carries_forward')!.terms).toEqual([
      'FY2025: "Retained Earnings" 149,111.15 — bs.pdf, page 1',
      'FY2025: "Current Year Earnings" 172,799.90 — bs.pdf, page 1',
      'Now: "Retained Earnings" 321,911.05 — bs.pdf, page 1',
    ])
    // The oldest year: no previous period, so no carry-forward check (not a failure).
    expect(year(proofs, 'FY2024').crossChecks.map((c) => c.check)).toEqual(['pl_agrees_bs'])
    expect(year(proofs, 'FY2024').status).toBe('proven')
  })

  it('carries forward when the year\'s distribution was closed into retained earnings too', () => {
    // Fortitude FY2022 → FY2023: (21,168) + 131,797.62 + (135,043.62) = (24,414).
    const cols = [2023, 2022].map(annual)
    const proofs = proofOf([doc('pl', 'export', pl(cols, [85194.01, 131797.62])), doc('bs', 'export', bs(cols, [-24414, -21168], [85194.01, 131797.62], [-88181.1, -135043.62]))])
    const check = year(proofs, 'FY2023').crossChecks.find((c) => c.check === 'carries_forward')!
    expect(check.status).toBe('passed')
    expect(check.terms).toContain('FY2022, closed into retained earnings: "Distribution to Beneficiaries" (135,043.62) — bs.pdf, page 1')
  })

  it('a check that does not apply gives no badge and no failure', () => {
    // Equity printed without a "Current Year Earnings" line (an accountant's layout): neither check applies.
    const plain = (s: PrintedStatement) => ({ ...s, rows: s.rows.map((x) => (x.label === 'Current Year Earnings' ? { ...x, label: 'Share Capital', text: 'Share Capital' } : x)) })
    const proofs = proofOf([doc('pl', 'export', pl(YEARS, [1, 2, 3])), doc('bs', 'export', plain(bs(YEARS, [10, 9, 8], [1, 2, 3])))])
    for (const p of proofs) {
      expect(p.crossChecks).toEqual([])
      expect(p.status).toBe('proven')
      expect(p.badges).toEqual([STATEMENTS_BADGE])
    }
  })

  it('a failed check: shown as printed (printed_error) with a note naming it; the totals badge stays', () => {
    const proofs = proofOf([doc('both', 'export', pl(YEARS, [500, 172799.9, 88331.14]), bs(YEARS, [321911.05, 149111.15, 60780.01], [-53586.4, 172799.9, 88331.14]))])
    const fy26 = year(proofs, 'FY2026')
    expect(fy26.status).toBe('printed_error')
    expect(fy26.badge).toBeNull()
    expect(fy26.badges).toEqual([STATEMENTS_BADGE, CROSS_CHECK_BADGE.carries_forward])
    expect(fy26.notes).toEqual([
      'Profit and loss does not agree with balance sheet (FY2026): "Net Profit" 500 on the profit and loss, "Current Year Earnings" (53,586.40) on the balance sheet (difference 54,086.40).',
    ])
    // One file: nothing to offer.
    expect(fy26.crossChecks[0].sameSourceOffer).toBeUndefined()
  })

  it('a failed check across two files says so and offers the files that print both', () => {
    const fs26 = doc('fs26', 'annual_statements', pl([annual(2026)], [-50000]), bs([annual(2026)], [321911.05], [-50000]))
    const proofs = comparisonProof(
      buildPrintedComparison(
        [fs26, doc('pl5', 'export', pl(YEARS, [-53586.4, 172799.9, 88331.14])), doc('bs5', 'export', bs(YEARS, [321911.05, 149111.15, 60780.01], [-53586.4, 172799.9, 88331.14]))],
        // Staff took the export's profit and loss for FY2026: the two statements now disagree.
        { sourceChoices: [{ column: 'FY2026', statement: 'profit_and_loss', documentId: 'pl5', chosenBy: 'Jane Example', chosenAt: '2026-11-25T01:00:00Z' }] },
      ),
    )
    const check = year(proofs, 'FY2026').crossChecks.find((c) => c.check === 'pl_agrees_bs')!
    expect(check.status).toBe('failed')
    expect(check.sources).toEqual({ profitAndLoss: 'pl5', balanceSheet: 'fs26' })
    expect(check.note).toContain('They come from different files: the profit and loss from "pl5.pdf", the balance sheet from "fs26.pdf".')
    expect(check.sameSourceOffer).toEqual([{ documentId: 'fs26', filename: 'fs26.pdf', label: 'Annual financial statements' }])
  })

  it('a failed carry-forward names both years\' lines', () => {
    const proofs = proofOf([doc('pl', 'export', pl(YEARS, [-53586.4, 172799.9, 88331.14])), doc('bs', 'export', bs(YEARS, [300000, 149111.15, 60780.01], [-53586.4, 172799.9, 88331.14]))])
    expect(year(proofs, 'FY2026').notes).toEqual([
      'Does not carry forward from FY2025 (FY2026): "Retained Earnings" 300,000, but FY2025\'s "Retained Earnings" 149,111.15 + "Current Year Earnings" 172,799.90 = 321,911.05 (difference (21,911.05)).',
    ])
  })

  it('whole-dollar statements agree to $1', () => {
    const proofs = proofOf([doc('both', 'export', pl([annual(2026)], [1001]), bs([annual(2026)], [5000], [1000]))])
    expect(year(proofs, 'FY2026').crossChecks[0].status).toBe('passed')
  })

  it('the alert carries ids, the period and the check only', () => {
    const comparison = buildPrintedComparison([doc('both', 'export', pl(YEARS, [500, 172799.9, 88331.14]), bs(YEARS, [321911.05, 149111.15, 60780.01], [-53586.4, 172799.9, 88331.14]))])
    expect(failedCrossChecks(comparison)).toEqual([
      { key: 'cross_check:pl_agrees_bs:FY2026', check: 'pl_agrees_bs', column: 'FY2026', documentId: 'both', documentIds: ['both'], differentSources: false },
    ])
  })
})
