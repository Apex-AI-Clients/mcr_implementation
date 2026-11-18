import { describe, expect, it } from 'vitest'
import type { ComparisonCell, PrintedComparison } from '@/lib/printed/compare'
import type { ScanCellStatus } from '@/lib/printed/types'
import type { DpnNoticeView } from '@/lib/dpn/view'
import type { NoticeProof } from '@/lib/dpn/proof'
import { documentProofs, type DocumentProofInput } from '../documentProofs'

/** The client page's "Documents" proof list. Synthetic files only. */

const doc = (id: string, docCategory: string, uploadedAt = '2026-11-01') => ({ id, originalFilename: `${id}.file`, docCategory, uploadedAt })

const proof = (status: NoticeProof['status']): NoticeProof => ({
  addsUp: status === 'verified',
  rowsNotAddingUp: [],
  totalsMatchRows: true,
  fieldsMissing: [],
  account: null,
  status,
  badges: status === 'verified' ? ['Notice adds up', 'Matches the ATO account'] : [],
  note: null,
})
const notice = (documentId: string, p: NoticeProof | null): DpnNoticeView => ({ documentId, filename: `${documentId}.pdf`, notice: null, issues: [], deadline: null, proof: p })

const cell = (documentId: string, scan?: ScanCellStatus): ComparisonCell => ({
  printed: true,
  value: 1000,
  source: { documentId, filename: `${documentId}.pdf`, page: 1, text: 'x', header: '2025' },
  restated: [],
  check: null,
  ...(scan ? { scan: { status: scan, claude: 1000, ocr: 1001, key: 'k', documentId, page: 1, band: null, column: 0 } } : {}),
})

function comparison(cells: [ComparisonCell, ComparisonCell], over: Partial<PrintedComparison> = {}): PrintedComparison {
  return {
    columns: [
      { key: 'FY2024', kind: 'annual', financialYear: 2024, periodStart: '2023-07-01', periodEnd: '2024-06-30' },
      { key: 'FY2025', kind: 'annual', financialYear: 2025, periodStart: '2024-07-01', periodEnd: '2025-06-30' },
    ],
    tables: [{ kind: 'profit_and_loss', title: 'P&L', rows: [{ key: 'r', path: [], label: 'Sales', style: 'line', cells }] }],
    failures: [],
    documents: [
      { documentId: 'fs24', filename: 'fs24.pdf', status: 'read', found: null, used: true, message: null, issues: [] },
      { documentId: 'fs25', filename: 'fs25.pdf', status: 'read', found: null, used: true, message: null, issues: [] },
    ],
    annualYears: 2,
    hiddenComparativeYears: [],
    ...over,
  }
}

const input = (over: Partial<DocumentProofInput>): DocumentProofInput => ({ documents: [], atoChecks: new Map(), notices: [], comparison: null, ...over })

describe('documentProofs', () => {
  it('an ATO file: the badge when verified, "Being prepared" otherwise (never a balance)', () => {
    const rows = documentProofs(
      input({
        documents: [doc('as', 'integrated_client_account'), doc('it', 'ato_income_tax_account'), doc('sg', 'ato_super_guarantee_account')],
        atoChecks: new Map([
          ['as', { icaStatus: 'verified', balance: 1000, balanceDate: '2026-09-14' }],
          ['it', { icaStatus: 'unverified', balance: null, balanceDate: null }],
          ['sg', { icaStatus: 'empty', balance: null, balanceDate: null }],
        ]),
      }),
    )
    expect(rows.map((r) => [r.documentId, r.status, r.text])).toEqual([
      ['as', 'proven', "Matches the ATO's own balance: $1,000.00 DR at 14 Sep 2026"],
      ['it', 'being_prepared', 'Being prepared'],
      ['sg', 'not_used', 'The export has no rows'],
    ])
  })

  it('an ATO file not checked yet is "Being prepared"', () => {
    expect(documentProofs(input({ documents: [doc('as', 'integrated_client_account')] }))[0].status).toBe('being_prepared')
  })

  it('a notice: its badges when proven, "Being prepared" when not proven or not read yet', () => {
    const rows = documentProofs(
      input({
        documents: [doc('n1', 'director_penalty_notices'), doc('n2', 'director_penalty_notices'), doc('n3', 'director_penalty_notices')],
        notices: [notice('n1', proof('verified')), notice('n2', proof('unverified')), notice('n3', null)],
      }),
    )
    expect(rows.map((r) => [r.status, r.text])).toEqual([
      ['proven', 'Notice adds up · Matches the ATO account'],
      ['being_prepared', 'Being prepared'],
      ['being_prepared', 'Being prepared'],
    ])
  })

  it('statements: proven years with the badge; a held year "Being prepared" with why', () => {
    const rows = documentProofs(
      input({
        documents: [doc('fs24', 'historical_financials'), doc('fs25', 'current_financials')],
        comparison: comparison([cell('fs24', 'agree'), cell('fs25', 'disagree')]),
      }),
    )
    expect(rows[0]).toMatchObject({ status: 'proven', text: expect.stringContaining('Every total on the statements adds up') })
    expect(rows[1]).toMatchObject({ status: 'being_prepared', text: expect.stringMatching(/^Being prepared: .*FY2025.*disagree on/) })
  })

  it("statements whose own printed totals do not add up: as printed, with the count (the accountant's error)", () => {
    const failure = { kind: 'totals_reconciliation' as const, statement: 'profit_and_loss' as const, column: 'FY2025', financialYear: 2025, currentPeriod: false, documentId: 'fs25', message: 'Total does not add up', terms: [] }
    const rows = documentProofs(
      input({ documents: [doc('fs25', 'current_financials')], comparison: comparison([cell('fs24'), cell('fs25')], { failures: [failure] }) }),
    )
    expect(rows[0]).toMatchObject({ status: 'as_printed', text: expect.stringContaining('1 printed total does not add up') })
  })

  it('a statement no year comes from is "not used", with the reason; one still being read is "Being prepared"', () => {
    const c = comparison([cell('fs24'), cell('fs24')], {
      documents: [
        { documentId: 'old', filename: 'old.pdf', status: 'read', found: null, used: false, message: 'Not used: a later report prints these years', issues: [] },
        { documentId: 'scan', filename: 'scan.pdf', status: 'scan_pending', found: null, used: false, message: null, issues: [] },
      ],
    })
    const rows = documentProofs(input({ documents: [doc('old', 'historical_financials'), doc('scan', 'historical_financials', '2026-11-02')], comparison: c }))
    expect(rows.map((r) => [r.status, r.text])).toEqual([
      ['not_used', 'Not used: a later report prints these years'],
      ['being_prepared', 'Being prepared'],
    ])
  })

  it('lists files oldest first and leaves other documents out', () => {
    const rows = documentProofs(input({ documents: [doc('b', 'integrated_client_account', '2026-11-05'), doc('t', 'trust_deed'), doc('a', 'integrated_client_account', '2026-11-01')] }))
    expect(rows.map((r) => r.documentId)).toEqual(['a', 'b'])
  })
})
