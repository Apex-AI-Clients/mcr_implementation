import { describe, expect, it } from 'vitest'
import type { ComparisonCell, PrintedComparison } from '../compare'
import { comparisonProof, STATEMENTS_BADGE } from '../proof'
import type { ScanCellStatus } from '../types'

/** Which years of the financial statements are proven (Gabby, 18 Nov 2026). Synthetic comparisons only. */

const source = (documentId: string) => ({ documentId, filename: `${documentId}.pdf`, page: 1, text: 'Line 1,000', header: '2025' })
const cell = (documentId: string, scan?: ScanCellStatus): ComparisonCell => ({
  printed: true,
  value: 1000,
  source: source(documentId),
  restated: [],
  check: null,
  ...(scan ? { scan: { status: scan, claude: 1000, ocr: scan === 'agree' ? 1000 : 1001, key: 'k', documentId, page: 1, band: null, column: 0 } } : {}),
})

function comparison(cells: ComparisonCell[], over: Partial<PrintedComparison> = {}): PrintedComparison {
  return {
    columns: [{ key: 'FY2025', kind: 'annual', financialYear: 2025, periodStart: '2024-07-01', periodEnd: '2025-06-30' }],
    tables: [{ kind: 'profit_and_loss', title: 'Profit & Loss', rows: cells.map((c, i) => ({ key: `r${i}`, path: [], label: `Line ${i}`, style: 'line', cells: [c] })) }],
    failures: [],
    documents: [{ documentId: 'fy25', filename: 'fy25.pdf', status: 'read', found: null, used: true, message: null, issues: [] }],
    annualYears: 1,
    hiddenComparativeYears: [],
    periodSources: [],
    ...over,
  }
}

const failure = { kind: 'totals_reconciliation' as const, statement: 'profit_and_loss' as const, column: 'FY2025', financialYear: 2025, currentPeriod: false, documentId: 'fy25', message: 'fy25.pdf, Profit & Loss (page 1): Total Expenses does not add up', terms: [] }

describe('comparisonProof', () => {
  it('a text-layer year whose totals add up is proven, with the badge', () => {
    expect(comparisonProof(comparison([cell('fy25'), cell('fy25')]))[0]).toMatchObject({ status: 'proven', badge: STATEMENTS_BADGE })
  })

  it('scanned figures both readings agree on (or staff chose) prove the year', () => {
    expect(comparisonProof(comparison([cell('fy25', 'agree'), cell('fy25', 'chosen')]))[0].status).toBe('proven')
  })

  it('a text-layer year whose own printed totals do not add up: shown as printed, the line named, never held', () => {
    const p = comparisonProof(comparison([cell('fy25')], { failures: [failure] }))[0]
    expect(p).toMatchObject({ status: 'printed_error', badge: null, notes: [failure.message], reasons: [] })
  })

  it('an uncertain scan reading holds the year back, saying why', () => {
    for (const status of ['disagree', 'single', 'read'] as const) {
      const p = comparisonProof(comparison([cell('fy25', 'agree'), cell('fy25', status)]))[0]
      expect(p.status).toBe('held')
      expect(p.reasons).toHaveLength(1)
    }
  })

  it('a scanned year whose totals do not add up is held (both readers would have to be wrong the same way, or the accountant)', () => {
    expect(comparisonProof(comparison([cell('fy25', 'agree')], { failures: [failure] }))[0].status).toBe('held')
  })

  it('scanned pages still being read hold the year', () => {
    const docs = [{ documentId: 'fy25', filename: 'fy25.pdf', status: 'scan_pending' as const, found: null, used: true, message: null, issues: [] }]
    expect(comparisonProof(comparison([cell('fy25')], { documents: docs }))[0].reasons).toContain('Scanned pages not read yet')
  })
})
