// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { parseActivityStatementCsv } from '@/lib/analysis/parseActivityStatement'
import { computeLateLodgement } from '@/lib/analysis/computeLateLodgement'
import type { SuperGuaranteeSummary } from '@/lib/analysis/atoAccount/superGuarantee'
import type { DpnSummary } from '@/lib/dpn/summary'
import { activityStatementExposure, directorLoanHistory, issuedByDirector, sgcDueDate, sgcExposure, subLineType } from '../directorRisk'

/** The director's personal risk (Stage 5). Synthetic files only. */

const SAMPLE_CSV = path.join(__dirname, '..', '..', 'analysis', '__tests__', 'fixtures', 'activity_statement_sample.csv')

describe('subLineType', () => {
  it('knows PAYG withholding and GST (with the taxes reported with it), and nothing a notice cannot cover', () => {
    expect(subLineType("'- PAYG Withholding")).toBe('paygw')
    expect(subLineType("'- GST")).toBe('gst')
    expect(subLineType('- Wine equalisation tax')).toBe('gst')
    expect(subLineType('- Luxury car tax')).toBe('gst')
    expect(subLineType("'- PAYG Instalments")).toBeNull()
    expect(subLineType('- Fuel tax credits')).toBeNull()
  })
})

describe('activityStatementExposure', () => {
  it('splits the synthetic activity statement by tax and by when each amount was reported', () => {
    const rows = computeLateLodgement(parseActivityStatementCsv(readFileSync(SAMPLE_CSV, 'utf8'))).rows
    const [paygw, gst] = activityStatementExposure(rows)

    // GST: four statements reported it. Two within 90 days of the due date
    // (Dec 25: processed 24 Feb 2026, due 3 Mar; Jun 25: 19 Aug, due 25 Aug),
    // one a client amendment 465 days after (Jun 23), and Dec 20 lodged
    // 17 days late — still within 3 months.
    expect(gst.items.map((i) => [i.period, i.amount, i.late])).toEqual([
      ['Period ending 31/12/2025', 1234.56, false],
      ['Period ending 30/06/2025', 987, false],
      ['Period ending 30/06/2023', 2000, true],
      ['Period ending 31/12/2020', 750, false],
    ])
    expect(gst.onTime).toBe(2971.56)
    expect(gst.late).toBe(2000)
    // PAYG withholding was only ever a credit here: nothing a notice could cover.
    expect(paygw).toMatchObject({ type: 'paygw', onTime: 0, late: 0, items: [] })
  })

  it('never counts PAYG instalments, payments or interest', () => {
    const rows = computeLateLodgement(parseActivityStatementCsv(readFileSync(SAMPLE_CSV, 'utf8'))).rows
    const all = activityStatementExposure(rows).flatMap((p) => p.items)
    expect(all.some((i) => i.amount === 300 || i.amount === 600)).toBe(false) // the PAYG instalment amendments
    expect(all.some((i) => i.amount === 45 || i.amount === 3500)).toBe(false) // GIC, payment
  })
})

describe('the superannuation guarantee charge', () => {
  it('is due on the 28th of the second month after the quarter', () => {
    expect(sgcDueDate('2025-09-30')).toBe('2025-11-28')
    expect(sgcDueDate('2025-12-31')).toBe('2026-02-28')
    expect(sgcDueDate('2026-03-31')).toBe('2026-05-28')
    expect(sgcDueDate('2026-06-30')).toBe('2026-08-28')
  })

  const quarter = (to: string, total: number, events: { kind: string; processed: string | null; label: string }[]) => ({
    period: { from: `${to.slice(0, 4)}-${String(Number(to.slice(5, 7)) - 2).padStart(2, '0')}-01`, to },
    shortfall: total,
    nominalInterest: 0,
    adminFee: 0,
    total,
    events: events.map((e, i) => ({ ...e, rowIndex: i, effective: null, shortfall: 0, nominalInterest: 0, adminFee: 0, total: 0 })),
    headline: events[0] ? { ...events[0], rowIndex: 0, effective: null, shortfall: 0, nominalInterest: 0, adminFee: 0, total: 0 } : null,
  })

  it('counts a quarter the company reported within 3 months of the due date apart from one reported late or only raised by the ATO', () => {
    const summary = {
      quarters: [
        quarter('2025-09-30', 1000, [{ kind: 'statement', processed: '2025-12-15', label: 'SGC statement' }]),
        quarter('2025-12-31', 2000, [{ kind: 'statement', processed: '2026-07-01', label: 'SGC statement' }]),
        quarter('2026-03-31', 400, [{ kind: 'ato_default', processed: '2026-09-01', label: 'ATO default assessment' }]),
      ],
    } as unknown as SuperGuaranteeSummary
    const sgc = sgcExposure([summary])
    expect(sgc.items.map((i) => [i.amount, i.reportedOn, i.daysLate, i.late, i.how])).toEqual([
      [1000, '2025-12-15', 17, false, 'SGC statement'],
      [2000, '2026-07-01', 123, true, 'SGC statement'],
      [400, null, null, true, 'ATO default assessment'],
    ])
    expect(sgc).toMatchObject({ type: 'sgc', onTime: 1000, late: 2400 })
  })
})

describe('issuedByDirector', () => {
  it('gives each director what liquidation by the deadline removes, and what stays, in dollars', () => {
    const summary = {
      notices: [
        { directorName: 'Jordan Sample', standing: 'current', deadline: '2026-11-20', daysLeft: 17 },
        { directorName: 'Jordan Sample', standing: 'current', deadline: '2026-11-10', daysLeft: 7 },
        { directorName: 'Jordan Sample', standing: 'history', deadline: '2025-01-01', daysLeft: -600 },
      ],
      directors: [
        {
          directorName: 'Jordan Sample',
          byType: [{ type: 'paygw' }, { type: 'gst' }],
          overall: { column2: 0, column3: 1_500_000, column4: 1_000_000, column5: 500_050 },
        },
      ],
    } as unknown as DpnSummary
    expect(issuedByDirector(summary)).toEqual([
      { directorName: 'Jordan Sample', removable: 10000, stays: 5000.5, deadline: '2026-11-10', daysLeft: 7, types: ['paygw', 'gst'] },
    ])
  })
})

describe('directorLoanHistory', () => {
  it('lists each year with a confirmed loan line, oldest first, and leaves out years with none', () => {
    const col = (key: string, kind = 'annual', periodEnd = `${key.slice(2)}-06-30`) => ({ key, kind, periodEnd })
    const years = (values: (number | null)[]) => values.map((value, i) => ({ column: [col('FY2024'), col('FY2025'), col('current', 'current_period', '2026-09-30')][i], value, lines: [] }))
    const history = directorLoanHistory((meaning) =>
      meaning === 'loan_receivable' ? { status: 'mapped', years: years([null, 40000, 52000.4]) } : { status: 'none', years: years([null, null, null]) },
    )
    expect(history.map((y) => [y.label, y.receivable, y.payable])).toEqual([
      ['FY2025', 40000, null],
      ['At 30/09/2026', 52000.4, null],
    ])
  })
})
