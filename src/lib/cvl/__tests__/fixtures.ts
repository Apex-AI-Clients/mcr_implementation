import type { CvlContext } from '../context'
import { readCvlSettings } from '../settings'
import type { MappedLine } from '@/lib/printed/mapping'

/**
 * A synthetic CVL client file: a fictional company, fictional people,
 * example.test addresses. Nothing here is a real client.
 */

const line = (label: string, printed: number, value = printed): MappedLine => ({
  label,
  printed,
  value,
  rule: null,
  source: { documentId: 'doc-fy26', filename: 'fy26.pdf', page: 2, text: label, header: 'FY2026' } as MappedLine['source'],
})

const bs = (lines: MappedLine[]) => ({
  amount: Math.round(lines.reduce((s, l) => s + l.value, 0) * 100) / 100,
  lines,
  statement: 'FY2026 balance sheet',
})

export function context(over: Partial<CvlContext> = {}): CvlContext {
  return {
    clientId: 'cl_1',
    client: { name: 'Jordan Sample', email: 'jordan@example.test', phone: '0400 000 001' },
    company: {
      companyName: 'Example Trading Pty Ltd',
      entityType: 'company',
      acn: '123456780',
      abn: '11123456780',
      trustName: null,
      registeredOffice: 'Unit 1, 10 Sample Road, North Melbourne VIC 3051',
      principalPlace: '20 Example Street, Sampleton NSW 2000',
      directors: [
        { name: 'Jordan Sample', dateOfBirth: '1970-03-14', appointedOn: '2016-08-05' },
        { name: 'Casey Example', dateOfBirth: '1981-11-02' },
      ],
      registrationDate: '2014-06-12',
      asicExtractDate: '2026-09-23T14:07:38+10:00',
      source: 'asic_pdf',
    },
    asicExtract: { id: 'ex-1', extractedAt: '2026-09-23T14:07:38+10:00', pages: { organisation: 1, addresses: 1, directors: 2 } },
    accountant: { companyName: 'Sample Accounting', contactPerson: 'Alex Ledger', phone: '02 0000 0000', email: 'alex@example.test' },
    balanceSheet: {
      cash_at_bank: bs([line('Cash at Bank', 3204.17)]),
      cash_on_hand: bs([line('Petty Cash', 150)]),
      trade_debtors: bs([line('Trade Debtors', 12480.5)]),
      stock: bs([line('Stock on Hand', 8900)]),
      plant_equipment: bs([line('Plant and Equipment', 22500)]),
      share_capital: bs([line('Share Capital', 100)]),
      loan_receivable: bs([line('Loan - Director', 4000)]),
      loan_payable: bs([line('Owner Funds Introduced', 2500)]),
      trade_suppliers: bs([line('Trade Creditors', 5000)]),
      cash_loans: bs([line('Chattel Mortgage - Ute', 18500), line('Business Loan', 7000)]),
      ato_debt: bs([line('BAS Payable', 9000)]),
    },
    atoAccounts: {
      accounts: [
        { id: 'a1', documentId: 'doc-ica', kind: 'activity_statement', label: 'Activity statement 001', balance: 172320.55, balanceDate: '2026-09-30', needsReview: false, reviewedAt: null, entityMatches: true, olderFiles: 0 },
        { id: 'a2', documentId: 'doc-sg', kind: 'super_guarantee', label: 'Superannuation guarantee 551', balance: 6400, balanceDate: '2026-09-30', needsReview: false, reviewedAt: null, entityMatches: true, olderFiles: 0 },
        { id: 'a3', documentId: 'doc-it', kind: 'income_tax', label: 'Income tax 551', balance: -120, balanceDate: '2026-09-30', needsReview: false, reviewedAt: null, entityMatches: true, olderFiles: 0 },
      ],
      totalDebt: 178600.55,
    },
    sbrCreditors: [
      { label: 'Trade suppliers', amount: 5000, kind: 'tradeSuppliers' },
      { label: 'Sample Landlord Pty Ltd', amount: 3300 },
    ],
    settings: readCvlSettings([]),
    ...over,
  }
}
