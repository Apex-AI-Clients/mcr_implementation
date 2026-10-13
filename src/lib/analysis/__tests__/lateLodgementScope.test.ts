import { describe, expect, it } from 'vitest'
import { computeLateLodgement } from '../computeLateLodgement'
import { LATE_LODGEMENT_SCOPE, lateLodgementSummary, storedLateLodgements } from '../config'
import { parseActivityStatementCsv } from '../parseActivityStatement'

/** The late-lodgement setting (config.ts). Synthetic account only. */

const HEADER = '"Activity statement 001"\n"SAMPLE TRADING PTY LTD"\nProcessed date,Effective date,Description,Debit (DR),Credit (CR),Balance\n'
const row = (p: string, e: string, d: string, dr = '', cr = '', bal = '') => `"${p}","${e}","'${d}","${dr}","${cr}","${bal}"`
const CSV =
  HEADER +
  [
    // An amendment lodged 471 days after the original period's due date, adding debt.
    row('10 Apr 2021', '25 Dec 2019', 'Client initiated amended Activity Statement for the period ending 30 Sep 19', '$9,408.00', '', '$12,408.00 DR'),
    // An original lodged 24 days late.
    row('18 Mar 2021', '22 Feb 2021', 'Original Activity Statement for the period ending 31 Dec 20', '$3,000.00', '', '$3,000.00 DR'),
  ].join('\n') +
  '\n'

describe('late-lodgement scope', () => {
  it('is set to originals only: amendments are corrections, not late lodgements', () => {
    expect(LATE_LODGEMENT_SCOPE).toBe('originals_only')
  })

  it('originals and amendments: an amendment counts from the original due date', () => {
    const r = computeLateLodgement(parseActivityStatementCsv(CSV), 'originals_and_amendments')
    expect(r.summary).toEqual({ numberOfLateLodgements: 2, cumulativeDaysLate: 24 + 472 })
    expect(r.dpnRisk.totalGrossLate).toBe(9_408)
  })

  it('originals only: amendments neither count as late nor add DPN debt', () => {
    const r = computeLateLodgement(parseActivityStatementCsv(CSV))
    expect(r.summary).toEqual({ numberOfLateLodgements: 1, cumulativeDaysLate: 24 })
    expect(r.dpnRisk.totalGrossLate).toBe(0)
  })

  it('counts stored rows the same way, for the prediction', () => {
    const rows = computeLateLodgement(parseActivityStatementCsv(CSV)).rows
    const stored = JSON.parse(JSON.stringify(rows)) // as lodgement_analyses.rows holds them
    expect(storedLateLodgements(stored, { numberOfLateLodgements: 99, cumulativeDaysLate: 99 })).toEqual(lateLodgementSummary(rows))
    expect(storedLateLodgements(stored, { numberOfLateLodgements: 99, cumulativeDaysLate: 99 }, 'originals_and_amendments')).toEqual({
      numberOfLateLodgements: 2,
      cumulativeDaysLate: 24 + 472,
    })
    expect(storedLateLodgements(stored, { numberOfLateLodgements: 99, cumulativeDaysLate: 99 }, 'originals_only')).toEqual({
      numberOfLateLodgements: 1,
      cumulativeDaysLate: 24,
    })
  })

  it('falls back to the stored columns when the rows are not analysed rows', () => {
    expect(storedLateLodgements(null, { numberOfLateLodgements: 3, cumulativeDaysLate: 40 })).toEqual({ numberOfLateLodgements: 3, cumulativeDaysLate: 40 })
  })
})
