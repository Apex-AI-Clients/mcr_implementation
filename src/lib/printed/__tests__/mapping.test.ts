import { describe, it, expect, vi } from 'vitest'
import { buildPrintedComparison, type ComparisonDocument } from '../compare'
import { suggestMapping } from '../dictionary'
import { mappingConfirmed, predictionFinancials, resolveMeaning, type MappingEntry } from '../mapping'
import { MappingError, saveMapping, type MappingSelection } from '../mappingStore'
import { MEANINGS } from '../meanings'
import { mappedCreditorHints } from '@/lib/sbr/creditors'
import { creditorDebt } from '@/lib/sbr/creditorDebt'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '../types'

/** Which printed lines mean what. Synthetic statements only. */

const fy = (y: number): PrintedColumn => ({ header: String(y), periodStart: `${y - 1}-07-01`, periodEnd: `${y}-06-30`, kind: 'annual', financialYear: y })
const r = (path: string[], label: string, style: PrintedRow['style'], ...amounts: (number | null)[]): PrintedRow => ({ page: 1, path, label, style, amounts, text: label })
const st = (kind: PrintedStatement['kind'], rows: PrintedRow[]): PrintedStatement => ({ kind, title: kind, pages: [1], columns: [fy(2025), fy(2024)], rows, wholeDollars: true })

function comparison() {
  const doc: ComparisonDocument = {
    documentId: 'fy25',
    filename: 'fy25.pdf',
    uploadedAt: '',
    read: {
      status: 'read',
      pageCount: 2,
      issues: [],
      statements: [
        st('profit_and_loss', [
          r([], 'Income', 'heading', null, null),
          r(['Income'], 'Sales', 'line', 500, 400),
          r(['Income'], 'Total Income', 'subtotal', 500, 400),
          r([], 'Expenses', 'heading', null, null),
          r(['Expenses'], 'Wages', 'line', 300, 350),
          r(['Expenses'], 'Total Expenses', 'subtotal', 300, 350),
          r([], 'Net Profit', 'total', 200, 50),
        ]),
        st('balance_sheet', [
          r([], 'Assets', 'heading', null, null),
          r(['Assets'], 'Cash', 'line', 100, 80),
          r(['Assets'], 'Loan - Related Parties', 'line', 40, 30),
          r(['Assets'], 'Total Assets', 'subtotal', 140, 110),
          r([], 'Liabilities and equity', 'heading', null, null),
          r(['Liabilities and equity', 'Current liabilities'], 'BAS Payable', 'line', 20, 10),
          r(['Liabilities and equity', 'Current liabilities'], 'PAYG Liability', 'line', 5, 5),
          r(['Liabilities and equity', 'Current liabilities'], 'Income Tax Payable', 'line', 7, null),
          r(['Liabilities and equity', 'Current liabilities'], 'Loan - Hino Truck', 'line', 30, 35),
          r(['Liabilities and equity', 'Current liabilities'], 'Less Unexpired Interest - Hino Truck', 'line', -4, -6),
          r(['Liabilities and equity', 'Current liabilities'], 'Total current liabilities', 'subtotal', 58, 44),
          r(['Liabilities and equity', "Shareholders' equity"], 'Income Tax Exp', 'line', -7, 0),
          r(['Liabilities and equity', "Shareholders' equity"], 'Retained earnings', 'line', 89, 66),
          r(['Liabilities and equity', "Shareholders' equity"], "Total shareholders' equity", 'subtotal', 82, 66),
          r(['Liabilities and equity'], 'Total liabilities and equity', 'subtotal', 140, 110),
        ]),
      ],
    },
  }
  // Both years shown: the FY2024 column is this report's comparative.
  return buildPrintedComparison([doc], { comparativeYears: true })
}

const labelOf = (c: ReturnType<typeof comparison>, key: string) => c.tables.flatMap((t) => t.rows).find((x) => x.key === key)?.label
const entries = (c: ReturnType<typeof comparison>, picks: Partial<Record<string, string[] | 'none'>>): MappingEntry[] =>
  MEANINGS.flatMap((m): MappingEntry[] => {
    const p = picks[m.key]
    if (p === undefined) return []
    if (p === 'none') return [{ meaning: m.key, rowKey: '', label: null, nonePrinted: true, confirmedBy: 'Test Staff', confirmedAt: '2026-10-25T00:00:00Z' }]
    const rows = c.tables.flatMap((t) => t.rows)
    return p.map((label) => ({ meaning: m.key, rowKey: rows.find((x) => x.label === label)!.key, label, nonePrinted: false, confirmedBy: 'Test Staff', confirmedAt: '2026-10-25T00:00:00Z' }))
  })

describe('suggestMapping', () => {
  it('suggests from the label and the section it sits in', () => {
    const c = comparison()
    const s = suggestMapping(c)
    const labels = (k: keyof typeof s) => s[k].map((key) => labelOf(c, key))
    expect(labels('revenue')).toEqual(['Total Income'])
    expect(labels('net_profit')).toEqual(['Net Profit'])
    expect(labels('ato_debt')).toEqual(['BAS Payable', 'PAYG Liability'])
    // Income tax on its own line; the equity line of the same name is not a liability.
    expect(labels('income_tax_payable')).toEqual(['Income Tax Payable'])
    expect(labels('loan_receivable')).toEqual(['Loan - Related Parties'])
    // A truck loan is finance, not a related party.
    expect(labels('loan_payable')).toEqual([])
    expect(labels('cash_loans')).toEqual(['Loan - Hino Truck', 'Less Unexpired Interest - Hino Truck'])
  })
})

describe('the confirmed mapping', () => {
  it('gives each year the mapped line, or the mapped lines added up, each named', () => {
    const c = comparison()
    const ato = resolveMeaning(c, entries(c, { ato_debt: ['BAS Payable', 'PAYG Liability'] }), 'ato_debt')
    expect(ato.status).toBe('mapped')
    expect(ato.years.map((y) => y.value)).toEqual([15, 25])
    expect(ato.years[1].lines).toEqual([{ label: 'BAS Payable', value: 20 }, { label: 'PAYG Liability', value: 5 }])
  })

  it('never guesses: not identified until confirmed, and "not printed" when staff say so', () => {
    const c = comparison()
    expect(resolveMeaning(c, [], 'revenue')).toMatchObject({ status: 'not_identified', years: [{ value: null }, { value: null }] })
    expect(resolveMeaning(c, entries(c, { loan_payable: 'none' }), 'loan_payable').status).toBe('none')
    expect(mappingConfirmed(entries(c, { revenue: ['Total Income'] }))).toBe(false)
  })

  it('feeds the prediction only what is confirmed, from the latest balance sheet', () => {
    const c = comparison()
    const all = entries(c, {
      revenue: ['Total Income'],
      net_profit: ['Net Profit'],
      net_assets: ["Total shareholders' equity"],
      ato_debt: ['BAS Payable', 'PAYG Liability'],
      income_tax_payable: ['Income Tax Payable'],
      loan_receivable: ['Loan - Related Parties'],
      loan_payable: 'none',
      credit_cards: 'none',
      cash_loans: ['Loan - Hino Truck', 'Less Unexpired Interest - Hino Truck'],
      bank_overdraft: 'none',
      trade_suppliers: 'none',
    })
    const f = predictionFinancials(c, all)
    expect(f.confirmed).toBe(true)
    expect(f.balanceSheet?.label).toBe('FY2025 balance sheet')
    expect(f.loanReceivable).toMatchObject({ amount: 40, source: 'FY2025 balance sheet' })
    expect(f.atoDebt?.amount).toBe(25)
    const hints = mappedCreditorHints(f)
    expect(hints.cashLoans).toMatchObject({ amount: 26, caution: expect.stringContaining('secured') })
    expect(hints.creditCards).toBeNull()
    const debt = creditorDebt({ icaRows: null, mappedAto: { amount: 25, lines: ['BAS Payable', 'PAYG Liability'] }, balanceSheetLabel: 'FY2025 balance sheet' })
    expect(debt).toMatchObject({ amount: 25, source: 'balance_sheet', description: 'Balance sheet (FY2025 balance sheet): “BAS Payable” + “PAYG Liability”' })
  })

  it('gives the prediction nothing for a loan account nobody confirmed', () => {
    const c = comparison()
    expect(predictionFinancials(c, []).loanReceivable).toBeNull()
    expect(creditorDebt({ icaRows: null, mappedAto: null }).amount).toBeNull()
  })
})

describe('saveMapping', () => {
  function db(previous: unknown[] = []) {
    const inserted: Record<string, unknown[]> = {}
    const from = vi.fn((table: string) => ({
      select: () => ({ eq: async () => ({ data: table === 'client_line_mappings' ? previous : [], error: null }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
      insert: async (rows: unknown[]) => {
        inserted[table] = rows
        return { error: null }
      },
    }))
    return { supabase: { from } as never, inserted }
  }
  const answerAll = (c: ReturnType<typeof comparison>): MappingSelection => {
    const key = (label: string) => c.tables.flatMap((t) => t.rows).find((x) => x.label === label)!.key
    return Object.fromEntries(MEANINGS.map((m) => [m.key, m.key === 'revenue' ? { rowKeys: [key('Total Income')] } : { none: true as const }]))
  }

  it('saves every answer with who confirmed it, and logs the changes', async () => {
    const c = comparison()
    const { supabase, inserted } = db()
    const saved = await saveMapping(supabase, 'client-1', 'Test Staff', answerAll(c), c)
    expect(saved).toHaveLength(MEANINGS.length)
    expect(inserted.client_line_mappings).toContainEqual(expect.objectContaining({ meaning: 'revenue', label: 'Total Income', statement: 'profit_and_loss', confirmed_by: 'Test Staff' }))
    expect(inserted.client_line_mapping_changes).toContainEqual(expect.objectContaining({ meaning: 'revenue', action: 'added', label: 'Total Income', changed_by: 'Test Staff' }))
  })

  it('saves one meaning at a time, the others keeping who confirmed them', async () => {
    const c = comparison()
    const kept = { meaning: 'net_profit', row_key: c.tables[0].rows.find((x) => x.label === 'Net Profit')!.key, label: 'Net Profit', none_printed: false, confirmed_by: 'Earlier Staff', confirmed_at: '2026-10-01T00:00:00Z' }
    const { supabase, inserted } = db([kept])
    const key = c.tables[0].rows.find((x) => x.label === 'Total Income')!.key
    await saveMapping(supabase, 'client-1', 'Test Staff', { revenue: { rowKeys: [key] } }, c)
    expect(inserted.client_line_mappings).toEqual([
      expect.objectContaining({ meaning: 'net_profit', confirmed_by: 'Earlier Staff', confirmed_at: '2026-10-01T00:00:00Z' }),
      expect.objectContaining({ meaning: 'revenue', confirmed_by: 'Test Staff' }),
    ])
    expect(inserted.client_line_mapping_changes).toEqual([expect.objectContaining({ meaning: 'revenue', action: 'added' })])
  })

  it('refuses nothing to confirm, two lines for a one-line figure, or a line from the wrong statement', async () => {
    const c = comparison()
    const { supabase } = db()
    await expect(saveMapping(supabase, 'client-1', 'Test Staff', {}, c)).rejects.toThrow(MappingError)
    const pl = c.tables[0].rows
    const two = { revenue: { rowKeys: [pl.find((x) => x.label === 'Sales')!.key, pl.find((x) => x.label === 'Total Income')!.key] } }
    await expect(saveMapping(supabase, 'client-1', 'Test Staff', two, c)).rejects.toThrow(/one printed line/)
    const wrong = { revenue: { rowKeys: [c.tables[1].rows.find((x) => x.label === 'Cash')!.key] } }
    await expect(saveMapping(supabase, 'client-1', 'Test Staff', wrong, c)).rejects.toThrow(/not on the profit and loss/)
  })
})
