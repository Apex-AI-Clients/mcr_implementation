import { describe, it, expect } from 'vitest'
import { analyseAtoAccount } from '..'
import { analyseAccountCore } from '../engine'
import { SG_EVENT_LABEL, sgEventKind } from '../superGuarantee'
import { unpaidPhrase } from '../incomeTax'

/**
 * Income tax and superannuation guarantee accounts through the shared engine.
 * Synthetic exports only, laid out as the ATO prints them (newest first).
 */

const HEADER = 'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance'
type Row = [processed: string, effective: string, description: string, debit: string, credit: string, balance: string]
const csv = (line1: string, rows: Row[]) =>
  [`"${line1}"`, '"EXAMPLE TRADING PTY LTD"', HEADER, ...rows.map((r) => r.map((c, i) => `"${i === 2 ? `'${c}` : c}"`).join(','))].join('\n') + '\n'

describe('income tax account', () => {
  // Brought forward $10,000. A payment split into two allocation rows, a GIC
  // total over its parts, and an oldest day printed out of time order.
  const INCOME_TAX = csv('Income tax 001', [
    ['01 Oct 2026', '01 Oct 2026', 'General interest charge calculated from 01 Sep 26 to 30 Sep 26', '$100.00', '', '$26,950.00 DR'],
    ['16 Apr 2026', '15 May 2026', ' Tax return Companies - Income Tax for the period from 01 Jul 24 to 30 Jun 25', '$20,000.00', '', '$26,850.00 DR'],
    ['31 Oct 2025', '30 Oct 2025', 'Payment received', '', '$3,000.00', '$6,850.00 DR'],
    ['31 Oct 2025', '30 Oct 2025', 'Payment received', '', '$2,000.00', ''],
    ['31 Oct 2025', '30 Oct 2025', 'Payment received', '', '$1,000.00', ''],
    ['06 May 2025', '06 May 2025', 'Remission of general interest charge', '', '$50.00', '$9,850.00 DR'],
    ['01 Nov 2024', '31 Oct 2024', 'Payment received', '', '$1,000.00', '$9,000.00 DR'],
    ['01 Nov 2024', '01 Nov 2024', 'General interest charge', '$900.00', '', '$9,900.00 DR'],
    ['01 Nov 2024', '01 Nov 2024', 'Amended general interest charge calculated from 01 Oct 24 to 31 Oct 24', '', '$100.00', ''],
    ['01 Nov 2024', '01 Nov 2024', 'General interest charge calculated from 01 Oct 24 to 31 Oct 24', '$1,000.00', '', ''],
  ])

  it('reconciles with the ATO balance: splits and GIC totals counted once, oldest day in time order', () => {
    const a = analyseAtoAccount(INCOME_TAX)
    expect(a.kind).toBe('income_tax')
    expect(a.balance).toBe(26_950)
    expect(a.balanceDate).toBe('2026-10-01')
    // Before the payment effective 31 Oct (printed above the 1 Nov interest).
    expect(a.openingBalance).toBe(10_000)
    expect(a.unexplainedDifference).toBe(0)
    expect(a.needsReview).toBe(false)
    expect(a.payments).toEqual({ count: 2, total: 4_000, first: '2024-10-31', last: '2025-10-30' })
  })

  it('lists each assessment with when it was assessed, when payment was due, and how long it has been unpaid', () => {
    const a = analyseAtoAccount(INCOME_TAX)
    if (a.kind !== 'income_tax') throw new Error('kind')
    expect(a.summary.assessments).toEqual([
      {
        rowIndex: 1,
        period: { from: '2024-07-01', to: '2025-06-30' },
        description: 'Tax return Companies - Income Tax for the period from 01 Jul 24 to 30 Jun 25',
        amount: 20_000,
        assessedOn: '2026-04-16',
        paymentDue: '2026-05-15',
        unpaid: 20_000,
        daysUnpaidPastDue: 139,
      },
    ])
    expect(unpaidPhrase(a.summary.assessments[0])).toBe('unpaid 139 days past the payment due date')
    expect(a.summary.gic).toEqual({ charged: 1_100, remitted: 150, net: 950 })
    expect(a.summary.note).toBe("Company income tax isn't covered by director penalty notices.")
  })

  it('shows a charge it does not recognise as unexplained, and needs review above $1,000', () => {
    const a = analyseAccountCore(
      csv('Income tax 001', [
        ['01 Oct 2026', '01 Oct 2026', 'Something new from the ATO', '$1,500.00', '', '$1,500.00 DR'],
        ['01 Sep 2026', '01 Sep 2026', 'Payment received', '', '$0.00', '$0.00'],
      ]),
    )
    expect(a.unexplainedDifference).toBe(1_500)
    expect(a.needsReview).toBe(true)
    expect(a.composition.uncounted.map((g) => g.kind)).toEqual(['Other'])
  })
})

describe('superannuation guarantee account', () => {
  // Two quarters. Q3 2021: SGC statement, then a client amendment adding
  // to it (with a GIC row printed in between), then an ATO audit for $0 with
  // a Part 7 penalty and its remission. Q1 2026: an ATO default assessment.
  const SG = csv('Superannuation guarantee employer 005', [
    ['22 Sep 2026', '22 Sep 2026', 'General interest charge', '$30.00', '', '$12,700.00 DR'],
    ['22 Sep 2026', '22 Sep 2026', 'General interest charge calculated from 21 Sep 26 to 21 Sep 26 for SG Shortfall GIC', '$20.00', '', ''],
    ['22 Sep 2026', '22 Sep 2026', 'General interest charge calculated from 21 Sep 26 to 21 Sep 26 for SG Shortfall GIC', '$10.00', '', ''],
    ['17 Sep 2026', '20 Jul 2026', 'Tax Office audit amended SGC Statement (Liability) - Superannuation Guarantee (Quarterly) for the period from 01 Jul 21 to 30 Sep 21', '', '$0.00', '$12,670.00 DR'],
    ['17 Sep 2026', '04 Nov 2026', 'SG Part 7 penalty - remission', '', '$600.00', '$12,670.00 DR'],
    ['17 Sep 2026', '04 Nov 2026', 'SG Part 7 penalty', '$1,000.00', '', '$13,270.00 DR'],
    ['16 Sep 2026', '16 Sep 2026', 'SGC Statement (Liability) - SG Administration Fee for the period from 01 Jan 26 to 31 Mar 26', '$200.00', '', '$12,270.00 DR'],
    ['16 Sep 2026', '16 Sep 2026', 'SGC Statement (Liability) - SG Nominal Interest for the period from 01 Jan 26 to 31 Mar 26', '$300.00', '', '$12,070.00 DR'],
    ['16 Sep 2026', '16 Sep 2026', 'SGC Statement (Liability) - SG Shortfall for the period from 01 Jan 26 to 31 Mar 26', '$4,000.00', '', '$11,770.00 DR'],
    ['16 Sep 2026', '16 Sep 2026', 'Default SGC Statement (Liability) - Superannuation Guarantee (Quarterly) for the period from 01 Jan 26 to 31 Mar 26', '', '$0.00', '$7,770.00 DR'],
    ['28 Jul 2026', '20 Jul 2026', 'SGC Statement (Liability) - SG Shortfall for the period from 01 Jul 21 to 30 Sep 21', '$1,000.00', '', '$7,770.00 DR'],
    ['28 Jul 2026', '28 Jul 2026', 'General interest charge calculated from 01 Jul 21 to 27 Jul 26 for SG Shortfall GIC', '$20.00', '', '$6,770.00 DR'],
    ['28 Jul 2026', '20 Jul 2026', 'Client initiated amended SGC Statement (Liability) - Superannuation Guarantee (Quarterly) for the period from 01 Jul 21 to 30 Sep 21', '', '$0.00', '$6,750.00 DR'],
    ['27 Jul 2026', '20 Jul 2026', 'SGC Statement (Liability) - SG Administration Fee for the period from 01 Jul 21 to 30 Sep 21', '$500.00', '', '$6,750.00 DR'],
    ['27 Jul 2026', '20 Jul 2026', 'SGC Statement (Liability) - SG Nominal Interest for the period from 01 Jul 21 to 30 Sep 21', '$1,250.00', '', '$6,250.00 DR'],
    ['27 Jul 2026', '20 Jul 2026', 'SGC Statement (Liability) - SG Shortfall for the period from 01 Jul 21 to 30 Sep 21', '$5,000.00', '', '$5,000.00 DR'],
    ['27 Jul 2026', '20 Jul 2026', 'SGC Statement (Liability) - Superannuation Guarantee (Quarterly) for the period from 01 Jul 21 to 30 Sep 21', '', '$0.00', '$0.00'],
  ])

  it('reconciles with the ATO balance', () => {
    const a = analyseAtoAccount(SG)
    expect(a.kind).toBe('super_guarantee')
    expect(a.balance).toBe(12_700)
    expect(a.openingBalance).toBe(0)
    expect(a.unexplainedDifference).toBe(0)
    expect(a.composition.lines.map((l) => [l.key, l.amount])).toEqual([
      ['sgShortfall', 10_000],
      ['sgNominalInterest', 1_550],
      ['sgAdminFee', 700],
      ['part7', 400],
      ['interest', 50],
      ['totalDebt', 12_700],
      ['payments', 0],
      ['composed', 12_700],
      ['atoBalance', 12_700],
      ['unexplained', 0],
    ])
  })

  it('totals each quarter over every event, lists the events newest first, and heads with the latest', () => {
    const a = analyseAtoAccount(SG)
    if (a.kind !== 'super_guarantee') throw new Error('kind')
    const [q3, q1] = a.summary.quarters
    expect(q3).toMatchObject({ period: { from: '2021-07-01', to: '2021-09-30' }, shortfall: 6_000, nominalInterest: 1_250, adminFee: 500, total: 7_750 })
    expect(q3.events.map((e) => [e.label, e.total])).toEqual([
      ['ATO audit', 0],
      // The GIC row printed between the amendment's shortfall and its statement row is passed over.
      ['Client amendment', 1_000],
      ['SGC statement', 6_750],
    ])
    expect(q3.headline?.label).toBe('ATO audit')
    expect(q1.headline?.label).toBe('ATO default assessment')
    expect(q1.total).toBe(4_500)
    expect(a.summary.unattributed).toBe(0)
    expect(a.summary.part7).toEqual({ charged: 1_000, remitted: 600, net: 400 })
    expect(a.summary.quartersRaisedBy).toEqual({ statement: 1, ato_default: 1, ato_audit: 1, client_amendment: 1, ato_amendment: 0 })
    expect(a.summary.note).toBe('Unpaid superannuation guarantee charge can be the subject of a director penalty notice.')
  })

  it('names how a quarter was raised neutrally: never "lodged by the company"', () => {
    expect(sgEventKind(' SGC Statement (Liability) - Superannuation Guarantee (Quarterly) for the period from 01 Jul 21 to 30 Sep 21')).toBe('statement')
    expect(sgEventKind('Tax Office initiated amended SGC Statement (Liability)')).toBe('ato_amendment')
    expect(Object.values(SG_EVENT_LABEL).join(' ')).not.toMatch(/lodged/i)
  })
})

describe('what the engine refuses', () => {
  it('leaves activity statements to their own analysis, and an unknown account to staff', () => {
    expect(() => analyseAtoAccount(csv('Activity statement 001', []))).toThrow(/own analysis/)
    expect(() => analyseAtoAccount(csv('Fringe benefits tax 001', []))).toThrow(/not recognised/)
  })
})
