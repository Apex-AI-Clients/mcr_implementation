import { describe, it, expect } from 'vitest'
import { buildPrintedComparison, type ComparisonDocument } from '../compare'
import { namesParty, suggestMapping } from '../dictionary'
import { AUTO_BY, autoMapping, sameChoices } from '../autoMapping'
import { mappingConfirmed, predictionFinancials, type MappingEntry } from '../mapping'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '../types'

/** Related-party loans by name and phrase, and auto-selection with its safeguard. Synthetic statements only. */

const fy = (y: number): PrintedColumn => ({ header: String(y), periodStart: `${y - 1}-07-01`, periodEnd: `${y}-06-30`, kind: 'annual', financialYear: y })
const r = (path: string[], label: string, style: PrintedRow['style'], amount: number | null): PrintedRow => ({ page: 1, path, label, style, amounts: [amount], text: label })
const st = (kind: PrintedStatement['kind'], rows: PrintedRow[]): PrintedStatement => ({ kind, title: kind, pages: [1], columns: [fy(2025)], rows, wholeDollars: false })

const NCL = ['Liabilities', 'Non-current Liabilities']
const PARTIES = ['Jane Example', 'Example Family Trust', 'Example Earthworks & Haulage Pty Ltd']

function trustComparison(extra: PrintedRow[] = []) {
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
          r([], 'Trading Income', 'heading', null),
          r(['Trading Income'], 'Sales', 'line', 1000),
          r(['Trading Income'], 'Total Trading Income', 'subtotal', 1000),
          r([], 'Net Profit', 'total', 100),
        ]),
        st('balance_sheet', [
          r([], 'Assets', 'heading', null),
          r(['Assets'], 'Business Transaction Account', 'line', 900),
          r(['Assets'], 'Total Assets', 'subtotal', 900),
          r([], 'Liabilities', 'heading', null),
          r(NCL, 'Funds Loaned to Trust - Example Earthworks & Haulage Pty Ltd', 'line', 45712.5),
          r(NCL, 'Funds Loaned to Trust - Jane Example', 'line', 130333),
          r(NCL, 'Funds Loaned to Trust - Sam Other', 'line', 119864.1),
          r(NCL, 'Loan - Angle Finance 2019 Roadwest Trailer', 'line', 48177.9),
          r(NCL, 'Loan - Angle Finance 2019 Roadwest Trailer: Interest', 'line', -4168.56),
          r(NCL, 'Loan - Dynamoney 2021 Case CX300', 'line', 228920.6),
          r(NCL, 'Loan - Earlypay 2023 ASV RT75-HD', 'line', 175723.34),
          r(NCL, 'Loan - Flexi Commercial 2011 Kenworth T409 Tipper', 'line', 151555.34),
          r(NCL, 'Chattel Mortgage Repayments - Current', 'line', 80000),
          r(NCL, 'ATO Integrated Client Account', 'line', 2000),
          ...extra,
          r(NCL, 'Total Non-current Liabilities', 'subtotal', 0),
          r(['Liabilities'], 'Total Liabilities', 'subtotal', 0),
          r([], 'Net Assets', 'total', -100),
        ]),
      ],
    },
  }
  return buildPrintedComparison([doc])
}

const labels = (c: ReturnType<typeof trustComparison>, keys: string[]) => keys.map((k) => c.tables.flatMap((t) => t.rows).find((x) => x.key === k)?.label)

describe('related-party loans (dictionary)', () => {
  it('reads "Funds Loaned to Trust - <anyone>" under liabilities as owed BY the company, and leaves finance out', () => {
    const c = trustComparison()
    const s = suggestMapping(c, { parties: PARTIES })
    expect(labels(c, s.loan_payable)).toEqual([
      'Funds Loaned to Trust - Example Earthworks & Haulage Pty Ltd',
      'Funds Loaned to Trust - Jane Example',
      'Funds Loaned to Trust - Sam Other',
    ])
    expect(s.loan_receivable).toEqual([])
    const finance = labels(c, s.cash_loans)
    expect(finance).toContain('Loan - Dynamoney 2021 Case CX300')
    expect(finance).toContain('Loan - Angle Finance 2019 Roadwest Trailer: Interest')
    expect(finance).toContain('Loan - Earlypay 2023 ASV RT75-HD')
    expect(finance).toContain('Loan - Flexi Commercial 2011 Kenworth T409 Tipper')
  })

  it('owed by the company adds up to the three lines on the prediction', () => {
    const c = trustComparison()
    const auto = autoMapping(c, [], { parties: PARTIES })
    const f = predictionFinancials(c, auto.entries, { parties: PARTIES })
    expect(f.loanPayable?.amount).toBe(295909.6)
  })

  it('takes a loan line naming the client, the trust or the trustee company; a person or the word "loan account" too', () => {
    const c = trustComparison([
      r(NCL, 'Example Earthworks - 2020 Div 7A Loan', 'line', 32791.15),
      r(NCL, 'Loan from Peter Smith', 'line', 1000),
      r(NCL, 'Mary Jones Loan Account', 'line', 2000),
      r(NCL, 'Loan from Westpac', 'line', 3000),
      // Names the client but is no loan: not a loan account (a possible line instead).
      r(NCL, 'Profit Distribution - Jane Example', 'line', 5000),
    ])
    const s = suggestMapping(c, { parties: PARTIES })
    const by = labels(c, s.loan_payable)
    expect(by).toContain('Example Earthworks - 2020 Div 7A Loan')
    expect(by).toContain('Loan from Peter Smith')
    expect(by).toContain('Mary Jones Loan Account')
    expect(by).not.toContain('Loan from Westpac')
    expect(by).not.toContain('Profit Distribution - Jane Example')
  })

  it('names a party by its own words, never by "Pty Ltd" or "Family Trust"', () => {
    expect(namesParty('Loan - Example', ['Example Family Trust'])).toBe(true)
    expect(namesParty('Loan - Example Earthworks', ['Example Earthworks & Haulage Pty Ltd'])).toBe(true)
    expect(namesParty('Loan - Acme Pty Ltd', ['Example Earthworks & Haulage Pty Ltd'])).toBe(false)
    expect(namesParty('Loan - Haulage Trust', ['Example Earthworks & Haulage Pty Ltd'])).toBe(false)
  })
})

describe('auto-selection', () => {
  it('auto-selects every matched meaning with its rule, and "Not printed" where nothing looks like it', () => {
    const c = trustComparison()
    const { entries, possible } = autoMapping(c, [], { parties: PARTIES })
    const of = (m: string) => entries.filter((e) => e.meaning === m)
    expect(entries.every((e) => e.confirmedBy === AUTO_BY && !!e.autoRule)).toBe(true)
    expect(of('revenue').map((e) => e.label)).toEqual(['Total Trading Income'])
    expect(of('loan_payable')).toHaveLength(3)
    expect(of('loan_payable')[0].autoRule).toMatch(/Funds loaned to/)
    expect(of('loan_receivable')).toEqual([expect.objectContaining({ nonePrinted: true })])
    expect(of('income_tax_payable')).toEqual([expect.objectContaining({ nonePrinted: true })])
    expect(possible).toEqual({})
    // Counts as confirmed for the prediction.
    expect(mappingConfirmed(entries)).toBe(true)
  })

  it('does not say "Not printed" while a line that looks related is unmatched: it is a possible line', () => {
    const c = trustComparison([
      r(NCL, 'Profit Distribution - Jane Example', 'line', 5000),
      r(NCL, 'Payroll Tax Payable', 'line', 650),
    ])
    const { entries, possible } = autoMapping(c, [], { parties: PARTIES })
    expect(entries.find((e) => e.meaning === 'loan_receivable')).toBeUndefined()
    expect(possible.loan_receivable?.map((p) => [p.label, p.value])).toEqual([['Profit Distribution - Jane Example', 5000]])
    expect(entries.find((e) => e.meaning === 'income_tax_payable')).toBeUndefined()
    expect(possible.income_tax_payable?.map((p) => p.label)).toEqual(['Payroll Tax Payable'])
    // Waiting for a click: not confirmed.
    expect(mappingConfirmed(entries)).toBe(false)
  })

  it('never replaces a staff choice; a staff "Not printed" the dictionary now disagrees with shows its lines as possible', () => {
    const c = trustComparison()
    const staff: MappingEntry[] = [{ meaning: 'loan_payable', rowKey: '', label: null, nonePrinted: true, confirmedBy: 'Staff', confirmedAt: '2026-11-01T00:00:00Z' }]
    const { entries, possible } = autoMapping(c, staff, { parties: PARTIES })
    expect(entries.find((e) => e.meaning === 'loan_payable')).toBeUndefined()
    expect(possible.loan_payable?.map((p) => p.label)).toHaveLength(3)
    expect(possible.loan_payable?.[0].why).toMatch(/Confirmed as not printed, but now matched/)
  })

  it('switches a staff "Not printed" given under an older reader to the lines matched now, with a note', () => {
    const c = trustComparison([r(NCL, 'Example Earthworks - 2020 Div 7A Loan', 'line', 32791.15), r(NCL, 'Example Earthworks - 2022 Div 7A Loan', 'line', 27620.66)])
    const staff: MappingEntry[] = [{ meaning: 'loan_payable', rowKey: '', label: null, nonePrinted: true, confirmedBy: 'assist', confirmedAt: '2026-11-04T08:58:19Z' }]
    const { entries, possible, replaced } = autoMapping(c, staff, { parties: PARTIES }, { staleBefore: '2026-11-05T00:00:00Z' })
    expect(replaced).toEqual(staff)
    const by = entries.filter((e) => e.meaning === 'loan_payable')
    expect(by).toHaveLength(5)
    expect(by[0].updatedNote).toBe('Updated after a reading fix (was: Not printed, by assist on 4 Nov 2026)')
    expect(possible.loan_payable).toBeUndefined()
    // The Div 7A lines are counted, labelled as such.
    expect(by.filter((e) => /^Div 7A loan/.test(e.autoRule ?? '')).map((e) => e.label)).toEqual(['Example Earthworks - 2020 Div 7A Loan', 'Example Earthworks - 2022 Div 7A Loan'])
    expect(predictionFinancials(c, entries, { parties: PARTIES }).loanPayable?.amount).toBe(356321.41)
  })

  it('never changes a staff answer given since the reader went live', () => {
    const c = trustComparison()
    const staff: MappingEntry[] = [{ meaning: 'loan_payable', rowKey: '', label: null, nonePrinted: true, confirmedBy: 'assist', confirmedAt: '2026-11-06T00:00:00Z' }]
    const { entries, possible, replaced } = autoMapping(c, staff, { parties: PARTIES }, { staleBefore: '2026-11-05T00:00:00Z' })
    expect(replaced).toEqual([])
    expect(entries.find((e) => e.meaning === 'loan_payable')).toBeUndefined()
    expect(possible.loan_payable).toHaveLength(3)
  })

  it('selects nothing from a statement no file prints', () => {
    const c = buildPrintedComparison([])
    expect(autoMapping(c, [], {}).entries).toEqual([])
  })

  it('compares choices whoever made them', () => {
    const a: MappingEntry = { meaning: 'revenue', rowKey: 'k', label: 'x', nonePrinted: false, confirmedBy: AUTO_BY, confirmedAt: '1', autoRule: 'r' }
    expect(sameChoices([a], [{ ...a, confirmedAt: '2', autoRule: 'other' }])).toBe(true)
    expect(sameChoices([a], [{ ...a, rowKey: 'j' }])).toBe(false)
  })
})

describe('beneficiary accounts and loans naming a person', () => {
  it('counts beneficiary accounts in owed BY, as their own labelled line', () => {
    const c = trustComparison([r(NCL, "Beneficiaries' Accounts", 'line', 1001505)])
    const { entries } = autoMapping(c, [], { parties: PARTIES })
    const line = entries.find((e) => e.label === "Beneficiaries' Accounts")!
    expect(line.meaning).toBe('loan_payable')
    expect(line.autoRule).toMatch(/^Beneficiary accounts — unpaid distributions/)
  })

  it('never auto-selects a loan naming a person who is not on file: it is a possible line', () => {
    const c = trustComparison([r(NCL, 'Loan - Aaron Peters', 'line', 5000), r(NCL, 'Profit Distribution - Sam Other', 'line', 100)])
    const { entries, possible } = autoMapping(c, [], { parties: PARTIES })
    expect(entries.some((e) => e.label === 'Loan - Aaron Peters')).toBe(false)
    expect(possible.loan_payable?.map((p) => p.label)).toEqual(['Loan - Aaron Peters'])
    // The other owed-BY lines are still auto-selected.
    expect(entries.filter((e) => e.meaning === 'loan_payable')).toHaveLength(3)
  })

  it('related-party words are never an unknown person', () => {
    const c = trustComparison([r(NCL, 'Loan - Related Parties', 'line', 5000)])
    const { entries, possible } = autoMapping(c, [], { parties: PARTIES })
    expect(entries.some((e) => e.label === 'Loan - Related Parties')).toBe(true)
    expect(possible.loan_payable).toBeUndefined()
  })

  it('a loan naming a beneficiary the statements name is related, not unknown', () => {
    const c = trustComparison([r(NCL, 'Loan - Sam Other', 'line', 5000), r(NCL, 'Profit Distribution - Sam Other', 'line', 100)])
    const { entries } = autoMapping(c, [], { parties: PARTIES })
    expect(entries.some((e) => e.label === 'Loan - Sam Other')).toBe(true)
  })
})
