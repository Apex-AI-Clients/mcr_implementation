import { describe, expect, it } from 'vitest'
import { buildPrintedComparison, type ComparisonDocument } from '../compare'
import { loanSideConflicts, predictionFinancials, type MappingEntry } from '../mapping'
import { headlineRows } from '../headline'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '../types'

/** A stored loan choice that contradicts the sign-aware section rule is flagged, never moved silently. Synthetic. */

const fy = (y: number): PrintedColumn => ({ header: String(y), periodStart: `${y - 1}-07-01`, periodEnd: `${y}-06-30`, kind: 'annual', financialYear: y })
const r = (path: string[], label: string, style: PrintedRow['style'], amount: number | null): PrintedRow => ({ page: 1, path, label, style, amounts: [amount], text: label })
const st = (kind: PrintedStatement['kind'], rows: PrintedRow[]): PrintedStatement => ({ kind, title: kind, pages: [1], columns: [fy(2026)], rows, wholeDollars: false })

function comparison() {
  const doc: ComparisonDocument = {
    documentId: 'doc',
    filename: 'fy26.pdf',
    uploadedAt: '',
    read: {
      status: 'read',
      pageCount: 1,
      issues: [],
      statements: [
        st('balance_sheet', [
          r([], 'Assets', 'heading', null),
          r(['Assets'], 'Business Account', 'line', 1000),
          r(['Assets'], 'Loans to Directors', 'line', 5000),
          r(['Assets'], 'Total Assets', 'subtotal', 6000),
          r([], 'Equity', 'heading', null),
          r(['Equity'], 'Owner A Drawings', 'line', 44952.22),
          r(['Equity'], 'Retained Earnings', 'line', 100),
        ]),
      ],
    },
  }
  return buildPrintedComparison([doc])
}

const key = (c: ReturnType<typeof comparison>, label: string) => c.tables.flatMap((t) => t.rows).find((x) => x.label === label)!.key
const entry = (meaning: MappingEntry['meaning'], rowKey: string, by = 'staff@example.com'): MappingEntry => ({
  meaning,
  rowKey,
  label: null,
  nonePrinted: false,
  confirmedBy: by,
  confirmedAt: '2026-11-01T00:00:00Z',
})

describe('loanSideConflicts', () => {
  it('flags a positive Equity line stored on the Debit side, with the message staff see', () => {
    const c = comparison()
    const mapping = [entry('loan_receivable', key(c, 'Loans to Directors')), entry('loan_receivable', key(c, 'Owner A Drawings'))]
    const conflicts = loanSideConflicts(c, mapping, 0)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ label: 'Owner A Drawings', printed: 44952.22, storedAs: 'loan_receivable', belongsTo: 'loan_payable', chosenBy: 'staff@example.com' })
    expect(conflicts[0].message).toBe('“Owner A Drawings” is printed under Equity, so it belongs to Loan account director (Credit), not Director loan account (Debit) — move it?')
  })

  it('no conflict when every line is on its side, whoever chose it', () => {
    const c = comparison()
    expect(loanSideConflicts(c, [entry('loan_receivable', key(c, 'Loans to Directors'), 'auto'), entry('loan_payable', key(c, 'Owner A Drawings'), 'auto')], 0)).toEqual([])
  })

  it('the prediction waits (never $0, never moved silently) and the comparison page says "Move needed"', () => {
    const c = comparison()
    const mapping = [entry('loan_receivable', key(c, 'Loans to Directors')), entry('loan_receivable', key(c, 'Owner A Drawings'))]
    const f = predictionFinancials(c, mapping)
    expect(f.loanReceivable).toBeNull()
    expect(f.loanPayable).toBeNull()
    expect(f.notIdentified.loanReceivable?.conflicts).toHaveLength(1)
    expect(f.notIdentified.loanReceivable?.message).toMatch(/belongs to Loan account director \(Credit\)/)
    const rows = headlineRows(c, mapping, {} as never, { status: 'none', cells: [] })
    for (const k of ['loan_receivable', 'loan_payable']) {
      const cell = rows.find((x) => x.key === k)!.cells[0]
      expect(cell).toMatchObject({ kind: 'blank', conflict: true })
    }
  })
})
