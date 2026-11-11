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
    // An amendment lodged 472 days after the original period's due date, adding debt.
    row('10 Apr 2021', '25 Dec 2019', 'Client initiated amended Activity Statement for the period ending 30 Sep 19', '$8,150.00', '', '$11,150.00 DR'),
    // An original lodged 24 days late.
    row('18 Mar 2021', '22 Feb 2021', 'Original Activity Statement for the period ending 31 Dec 20', '$3,000.00', '', '$3,000.00 DR'),
  ].join('\n') +
  '\n'

describe('late-lodgement scope', () => {
  it('is set to the RBA ICA rule: originals and amendments (decided 12 Nov 2026)', () => {
    expect(LATE_LODGEMENT_SCOPE).toBe('originals_and_amendments')
    expect(computeLateLodgement(parseActivityStatementCsv(CSV)).summary).toEqual({ numberOfLateLodgements: 2, cumulativeDaysLate: 24 + 472 })
  })

  it('originals and amendments: an amendment counts from the original due date', () => {
    const r = computeLateLodgement(parseActivityStatementCsv(CSV), 'originals_and_amendments')
    expect(r.summary).toEqual({ numberOfLateLodgements: 2, cumulativeDaysLate: 24 + 472 })
    expect(r.dpnRisk.totalGrossLate).toBe(8_150)
  })

  it('originals only: amendments neither count as late nor add DPN debt', () => {
    const r = computeLateLodgement(parseActivityStatementCsv(CSV), 'originals_only')
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

  it('counts every row whose description contains "Activity Statement", in any case, as the spreadsheet does', () => {
    const csv =
      HEADER +
      [
        row('27 May 2026', '25 May 2022', 'Tax Office audit amended Activity Statement for the period ending 31 Mar 22', '$1,800.00', '', '$1,800.00 DR'),
        row('10 Apr 2021', '25 Dec 2019', 'ATO initiated amended ACTIVITY STATEMENT for the period ending 30 Sep 19', '', '$10.00', '$1,790.00 DR'),
        // A sub-line never carries the phrase.
        row('10 Apr 2021', '25 Dec 2019', '- GST', '$8,150.00'),
        // Nor does interest.
        row('10 Apr 2021', '25 Dec 2019', 'General interest charge calculated from 01 Mar 21 to 31 Mar 21', '$5.00'),
        // Lodged early: negative, so 0.
        row('20 Feb 2021', '28 Feb 2021', 'Original Activity Statement for the period ending 31 Dec 20', '$1.00'),
      ].join('\n') +
      '\n'
    const r = computeLateLodgement(parseActivityStatementCsv(csv))
    // 27 May 2026 − 25 May 2022 = 1,463 days; 10 Apr 2021 − 25 Dec 2019 = 472 days.
    expect(r.summary).toEqual({ numberOfLateLodgements: 2, cumulativeDaysLate: 1463 + 472 })
    // The audit amendment's debit, over 90 days late, is in the DPN gross too.
    expect(r.dpnRisk.totalGrossLate).toBe(1_800)
    expect(computeLateLodgement(parseActivityStatementCsv(csv), 'originals_only').summary).toEqual({ numberOfLateLodgements: 0, cumulativeDaysLate: 0 })
  })

  it('never lets a penalty remission relieve a statement debit in the DPN estimate', () => {
    const csv =
      HEADER +
      [
        row('30 Jun 2023', '28 Feb 2022', 'Remission of penalty for failure to lodge Activity Statement on time for the period ending 31 Dec 21', '', '$900.00'),
        row('30 Jun 2022', '28 Feb 2022', 'Original Activity Statement for the period ending 31 Dec 21', '$5,000.00', '', '$5,000.00 DR'),
      ].join('\n') +
      '\n'
    const r = computeLateLodgement(parseActivityStatementCsv(csv))
    // The spreadsheet counts both rows (the remission has "Activity Statement" in it).
    expect(r.summary.numberOfLateLodgements).toBe(2)
    expect(r.dpnRisk.totalGrossLate).toBe(5_000)
    expect(r.dpnRisk.totalReducedByAmendments).toBe(0)
  })
})
