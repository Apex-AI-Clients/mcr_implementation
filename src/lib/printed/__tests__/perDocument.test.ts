import { describe, expect, it } from 'vitest'
import { buildPrintedComparison, type ComparisonDocument } from '../compare'
import { suggestMappingWithRules } from '../dictionary'
import { autoMapping } from '../autoMapping'
import { resolveMeaning } from '../mapping'
import { headlineRows, overdrawnBankNote } from '../headline'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '../types'

/** Key figures per document (Gabby, 18 Nov 2026): a new layout in the latest year. Synthetic statements only. */

const fy = (y: number): PrintedColumn => ({ header: String(y), periodStart: `${y - 1}-07-01`, periodEnd: `${y}-06-30`, kind: 'annual', financialYear: y })
const r = (path: string[], label: string, style: PrintedRow['style'], amount: number | null): PrintedRow => ({ page: 1, path, label, style, amounts: [amount], text: `${label} ${amount ?? ''}` })
const doc = (id: string, year: number, pl: PrintedRow[], bs: PrintedRow[]): ComparisonDocument => {
  const st = (kind: PrintedStatement['kind'], rows: PrintedRow[]): PrintedStatement => ({ kind, title: kind, pages: [1], columns: [fy(year)], rows, wholeDollars: true })
  return { documentId: id, filename: `${id}.pdf`, uploadedAt: id, read: { status: 'read', pageCount: 2, issues: [], statements: [st('profit_and_loss', pl), st('balance_sheet', bs)] } }
}

// FY2025: the accountant's layout. FY2026: a Xero export ("Bank", "Fixed Assets", "Net Profit", drawings).
const fy25 = doc(
  'fy25',
  2025,
  [r([], 'Net Profit After Tax', 'total', 1459), r([], 'Net Profit After Dividends Paid', 'total', 1459)],
  [
    r(['Assets', 'Current Assets'], 'Cheque Account', 'line', -59281),
    r(['Assets', 'Current Assets'], 'Loans to Directors (NCA)', 'line', 100),
    r(['Assets', 'Current Assets'], 'Total Current Assets', 'subtotal', -59181),
    r(['Assets', 'Non-Current Assets'], 'Plant', 'line', 299833),
    r(['Assets', 'Non-Current Assets'], 'Total Non-Current Assets', 'subtotal', 299833),
    r(['Assets'], 'Total Assets', 'subtotal', 240652),
  ],
)
const fy26 = (fixed = 313633.2) =>
  doc(
    'fy26',
    2026,
    [r([], 'Net Profit', 'total', -15120.89)],
    [
      r(['Assets', 'Bank'], 'Cheque Account', 'line', 11885.53),
      r(['Assets', 'Bank'], 'Total Bank', 'subtotal', 11885.53),
      r(['Assets', 'Fixed Assets'], 'Excavator', 'line', fixed),
      r(['Assets', 'Fixed Assets'], 'Total Fixed Assets', 'subtotal', fixed),
      r(['Assets'], 'Total Assets', 'subtotal', 325518.73),
      r(['Equity'], 'Owner A Drawings', 'line', 44952.22),
    ],
  )

describe('key figures per document', () => {
  it('maps net profit to each year’s own line, and counts one line per year', () => {
    const c = buildPrintedComparison([fy25, fy26()])
    const { entries } = autoMapping(c, [])
    const net = resolveMeaning(c, entries, 'net_profit')
    expect(net.years.map((y) => [y.value, y.lines.map((l) => l.label)])).toEqual([
      [1459, ['Net Profit After Tax']],
      [-15120.89, ['Net Profit']],
    ])
  })

  it('uses "Total Bank" and "Total Fixed Assets" only when they add up exactly to the printed Total Assets, and says so', () => {
    const c = buildPrintedComparison([fy25, fy26()])
    const { entries } = autoMapping(c, [])
    const cur = resolveMeaning(c, entries, 'total_current_assets')
    expect(cur.years.map((y) => y.value)).toEqual([-59181, 11885.53])
    expect(cur.years[1].lines[0].rule).toBe('From “Total Bank” and “Total Fixed Assets”, which add up to the printed Total Assets.')
    expect(resolveMeaning(c, entries, 'total_non_current_assets').years.map((y) => y.value)).toEqual([299833, 313633.2])
  })

  it('offers them as possible lines, never auto-selected, when they do not add up', () => {
    const c = buildPrintedComparison([fy25, fy26(313000)])
    const { entries, possible } = autoMapping(c, [])
    expect(resolveMeaning(c, entries, 'total_current_assets').years[1].value).toBeNull()
    expect(possible.total_current_assets?.map((p) => p.label)).toEqual(['Total Bank'])
    expect(suggestMappingWithRules(c).total_current_assets.find((l) => l.possibleOnly)).toBeTruthy()
  })

  it('offers drawings printed positive under Equity for the Credit row (owed by the company, 24 Nov 2026), never auto-selected', () => {
    const c = buildPrintedComparison([fy25, fy26()])
    const { entries, possible } = autoMapping(c, [])
    expect(possible.loan_receivable ?? []).toEqual([])
    expect(possible.loan_payable).toEqual([expect.objectContaining({ label: 'Owner A Drawings', why: 'Drawings printed as a positive amount under Equity: owed by the company (Credit).' })])
    expect(entries.filter((e) => e.meaning === 'loan_receivable').map((e) => e.label)).toEqual(['Loans to Directors (NCA)'])
  })

  it('notes an overdrawn bank account inside current assets, shown as printed', () => {
    const c = buildPrintedComparison([fy25, fy26()])
    expect(overdrawnBankNote(c, 0)).toBe('As printed: current assets include an overdrawn bank account (−$59,281)')
    expect(overdrawnBankNote(c, 1)).toBeNull()
    const { entries } = autoMapping(c, [])
    const tca = headlineRows(c, entries, Object.fromEntries(Object.keys(entries).map(() => ['x', []])) as never, { status: 'none', cells: [] }).find((x) => x.key === 'total_current_assets')!
    expect(tca.cells[0]).toMatchObject({ kind: 'value', value: -59181, note: 'As printed: current assets include an overdrawn bank account (−$59,281)' })
  })
})
