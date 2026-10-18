import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { computeLateLodgement } from '../computeLateLodgement'
import { parseActivityStatementCsv, extractPeriodEnding } from '../parseActivityStatement'
import { classifyLodgement } from '../classifyLodgement'
import type { ParsedCsv, ParsedRow } from '../types'

// Helper: build a minimal ParsedRow for a lodgement-type entry
function makeRow(
  processedIso: string | null,
  effectiveIso: string | null,
  description: string,
  rowIndex = 0,
): ParsedRow {
  return {
    rowIndex,
    processedDate: processedIso ? new Date(processedIso) : null,
    effectiveDate: effectiveIso ? new Date(effectiveIso) : null,
    rawProcessed: processedIso ?? '',
    rawEffective: effectiveIso ?? '',
    description,
    debit: null,
    credit: null,
    balance: null,
    periodEnding: null,
  }
}

function makeCsv(rows: ParsedRow[]): ParsedCsv {
  return { statementLabel: 'Test', companyName: 'Test Co', rows }
}

// Returns lateLodgementDays for a single row (signed)
function lateDays(processedIso: string, effectiveIso: string, description: string): number {
  const result = computeLateLodgement(makeCsv([makeRow(processedIso, effectiveIso, description)]))
  return result.rows[0].lateLodgementDays
}

// Returns lateLodgeDaysCleaned for a raw number via a dummy row
function cleaned(lateLodgementDays: number): number {
  return Math.max(lateLodgementDays, 0)
}

describe('computeLateLodgement — sign convention sanity checks (synthetic dataset values)', () => {
  it('early lodgement returns negative days', () => {
    expect(
      lateDays(
        '2026-02-24',
        '2026-03-03',
        'Original Activity Statement for the period ending 31 Dec 25',
      ),
    ).toBe(-7)
  })

  it('early lodgement returns negative days (2)', () => {
    expect(
      lateDays(
        '2025-08-19',
        '2025-08-25',
        'Original Activity Statement for the period ending 30 Jun 25',
      ),
    ).toBe(-6)
  })

  it('late ClientAmended returns positive days', () => {
    expect(
      lateDays(
        '2024-12-02',
        '2023-08-25',
        'Client initiated amended Activity Statement for the period ending 30 Jun 23',
      ),
    ).toBe(465)
  })

  it('late ClientAmended returns positive days (2)', () => {
    expect(
      lateDays(
        '2022-11-10',
        '2022-08-25',
        'Client initiated amended Activity Statement for the period ending 30 Jun 22',
      ),
    ).toBe(77)
  })

  it('late Original returns positive days', () => {
    expect(
      lateDays(
        '2021-03-19',
        '2021-03-02',
        'Original Activity Statement for the period ending 31 Dec 20',
      ),
    ).toBe(17)
  })

  it('late ClientAmended spanning multiple years returns positive days', () => {
    expect(
      lateDays(
        '2020-03-02',
        '2018-11-26',
        'Client initiated amended Activity Statement for the period ending 30 Sep 18',
      ),
    ).toBe(462)
  })
})

describe('computeLateLodgement — sub-lines and non-lodgement types always return zero', () => {
  it('- GST returns 0', () => {
    expect(lateDays('2024-12-02', '2023-08-25', '- GST')).toBe(0)
  })

  it('- PAYG Withholding returns 0', () => {
    expect(lateDays('2024-12-02', '2023-08-25', '- PAYG Withholding')).toBe(0)
  })

  it('Payment received returns 0', () => {
    expect(lateDays('2024-12-02', '2023-08-25', 'Payment received')).toBe(0)
  })

  it('General interest charge returns 0', () => {
    expect(
      lateDays(
        '2024-12-02',
        '2023-08-25',
        'General interest charge calculated from 01 Aug 25 to 31 Aug 25',
      ),
    ).toBe(0)
  })

  it('ATOAmended returns 0', () => {
    expect(
      lateDays(
        '2024-12-02',
        '2023-08-25',
        'ATO initiated amended Activity Statement for the period ending 30 Jun 24',
      ),
    ).toBe(0)
  })
})

describe('computeLateLodgement — cleaned = max(value, 0)', () => {
  it('cleans negative to 0', () => expect(cleaned(-14)).toBe(0))
  it('leaves 0 as 0', () => expect(cleaned(0)).toBe(0))
  it('leaves positive as-is', () => expect(cleaned(465)).toBe(465))

  it('lateLodgeDaysCleaned is zero for early lodgement', () => {
    const result = computeLateLodgement(
      makeCsv([
        makeRow(
          '2026-02-24',
          '2026-03-03',
          'Original Activity Statement for the period ending 31 Dec 25',
        ),
      ]),
    )
    expect(result.rows[0].lateLodgementDays).toBe(-7)
    expect(result.rows[0].lateLodgeDaysCleaned).toBe(0)
  })
})

describe('computeLateLodgement — defensive: missing date', () => {
  it('adds warning and returns 0 when processedDate is null on a lodgement row', () => {
    const result = computeLateLodgement(
      makeCsv([
        makeRow(null, '2024-08-25', 'Original Activity Statement for the period ending 30 Jun 24'),
      ]),
    )
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].reason).toBe('missing_dates_on_lodgement')
    expect(result.rows[0].lateLodgementDays).toBe(0)
    expect(result.rows[0].lateLodgeDaysCleaned).toBe(0)
  })

  it('adds warning and returns 0 when effectiveDate is null on a lodgement row', () => {
    const result = computeLateLodgement(
      makeCsv([
        makeRow('2024-12-02', null, 'Client initiated amended Activity Statement for the period ending 30 Jun 23'),
      ]),
    )
    expect(result.warnings).toHaveLength(1)
    expect(result.rows[0].lateLodgementDays).toBe(0)
  })

  it('does not add warning for missing dates on non-lodgement rows', () => {
    const result = computeLateLodgement(
      makeCsv([makeRow(null, null, '- GST')]),
    )
    expect(result.warnings).toHaveLength(0)
    expect(result.rows[0].lateLodgementDays).toBe(0)
  })
})

describe('computeLateLodgement — summary statistics', () => {
  it('counts only rows with lateLodgeDaysCleaned > 0', () => {
    const result = computeLateLodgement(
      makeCsv([
        makeRow('2024-12-02', '2023-08-25', 'Client initiated amended Activity Statement for the period ending 30 Jun 23', 0),
        makeRow('2026-02-24', '2026-03-03', 'Original Activity Statement for the period ending 31 Dec 25', 1),
        makeRow('2021-03-19', '2021-03-02', 'Original Activity Statement for the period ending 31 Dec 20', 2),
      ]),
      'originals_and_amendments',
    )
    expect(result.summary.numberOfLateLodgements).toBe(2)
    expect(result.summary.cumulativeDaysLate).toBe(465 + 17)
  })

  it('counts original statements only under the default setting (amendments are corrections)', () => {
    const result = computeLateLodgement(
      makeCsv([
        makeRow('2024-12-02', '2023-08-25', 'Client initiated amended Activity Statement for the period ending 30 Jun 23', 0),
        makeRow('2026-02-24', '2026-03-03', 'Original Activity Statement for the period ending 31 Dec 25', 1),
        makeRow('2021-03-19', '2021-03-02', 'Original Activity Statement for the period ending 31 Dec 20', 2),
      ]),
    )
    expect(result.summary.numberOfLateLodgements).toBe(1)
    expect(result.summary.cumulativeDaysLate).toBe(17)
  })
})

describe('computeLateLodgement — integration with sample fixture CSV', () => {
  it('produces correct summary from the sample fixture', () => {
    const csvText = readFileSync(
      join(__dirname, 'fixtures', 'activity_statement_sample.csv'),
      'utf-8',
    )
    const parsed = parseActivityStatementCsv(csvText)
    const result = computeLateLodgement(parsed, 'originals_and_amendments')
    // Under the default (originals only), just the original: 1 lodgement, 17 days.
    expect(computeLateLodgement(parsed).summary).toEqual({ numberOfLateLodgements: 1, cumulativeDaysLate: 17 })

    // 4 lodgement rows are late in the sample fixture when amendments count:
    // ClientAmended 30 Jun 23: 465 days
    // ClientAmended 30 Jun 22: 77 days
    // Original 31 Dec 20: 17 days
    // ClientAmended 30 Sep 18: 462 days
    expect(result.summary.numberOfLateLodgements).toBe(4)
    expect(result.summary.cumulativeDaysLate).toBe(465 + 77 + 17 + 462)

    // DPN: pooled-credit netting (19 May 2026 methodology).
    //   gross = sum of debits among late Original/ClientAmended rows
    //   paid  = sum of credits among the same rows (cash Payments are NOT counted)
    //   net   = max(0, gross - paid)
    // Late debits: ClientAmended 30 Jun 23 ($2000) + ClientAmended 30 Sep 18 ($1100) = $3100
    // Late credits in fixture: none (no credit-only ClientAmended >90 days)
    // The 10 Jun 2023 $3500 is a Payment row → ignored.
    expect(result.dpnRisk.contributingDebits).toHaveLength(2)
    expect(result.dpnRisk.totalGrossLate).toBe(3100)
    expect(result.dpnRisk.totalPaidSince).toBe(0)
    expect(result.dpnRisk.totalNetAtRisk).toBe(3100)

    // Debt breakdown (new field names)
    // principalDebits = $1234.56 + $987 + $2000 + $500 + $750 + $1100 = $6571.56
    // principalCredits = 0 (no credit lodgements in sample)
    // interestDebits = $45, interestCredits = 0
    // paymentsReceived = $3500
    expect(result.debtBreakdown.principalDebits).toBeCloseTo(6571.56, 1)
    expect(result.debtBreakdown.principalCredits).toBe(0)
    expect(result.debtBreakdown.interestDebits).toBeCloseTo(45, 1)
    expect(result.debtBreakdown.interestCredits).toBe(0)
    expect(result.debtBreakdown.penaltyDebits).toBe(0)
    expect(result.debtBreakdown.paymentsReceived).toBe(3500)
    expect(result.debtBreakdown.totalAtoDebt).toBeCloseTo(6571.56 + 45, 1)
    // The rows add up to this…
    expect(result.debtBreakdown.composedBalance).toBeCloseTo(6571.56 + 45 - 3500, 1)
    // …but the balance owing is the ATO's own printed balance on the newest row.
    expect(result.debtBreakdown.currentBalance).toBe(1234.56)
    expect(result.debtBreakdown.atoBalance).toBe(1234.56)
    expect(result.debtBreakdown.atoBalanceDate).toBe('2026-02-24')
    expect(result.debtBreakdown.unexplainedDifference).toBeCloseTo(1234.56 - (6571.56 + 45 - 3500), 1)
  })
})

describe('computeLateLodgement — integration with the company fixture CSV', () => {
  it('produces the exact reference figures for the synthetic company account', () => {
    const csvText = readFileSync(
      join(__dirname, 'fixtures', 'sample_company_activity_statement.csv'),
      'utf-8',
    )
    const parsed = parseActivityStatementCsv(csvText)
    // The reference figures below count amendments (originals_and_amendments).
    const result = computeLateLodgement(parsed, 'originals_and_amendments')

    // Under the default (originals only): this fixture's three late originals
    // (171 + 17 + 83 days).
    const originalsOnly = computeLateLodgement(parsed)
    expect(originalsOnly.summary).toEqual({ numberOfLateLodgements: 3, cumulativeDaysLate: 171 + 17 + 83 })
    expect(originalsOnly.dpnRisk.totalGrossLate).toBe(7250)

    // 6 late lodgements when amendments count: 171 + 462 + 17 + 77 + 83 + 465 = 1275 days
    expect(result.summary.numberOfLateLodgements).toBe(6)
    expect(result.summary.cumulativeDaysLate).toBe(1275)

    // DPN methodology (19 May 2026): pooled-credit netting.
    //   Late debits:  Row 0 Original 171d $7,250 → only contributing debit
    //   Late credits: Row 3 ClientAmended 462d credit $3,615
    //                 Row 10 ClientAmended 465d credit $2,895
    //                 Pool total = $6,510
    //   Cash payments $150,000 + $121,550 are ignored — the ATO applies
    //   payments to the oldest debt first and we can't prove they hit the
    //   DPN-qualifying row, so the conservative position is not to credit them.
    expect(result.dpnRisk.contributingDebits).toHaveLength(1)
    expect(result.dpnRisk.totalGrossLate).toBe(7250)
    expect(result.dpnRisk.totalPaidSince).toBe(6510)
    expect(result.dpnRisk.totalNetAtRisk).toBe(740)

    const debit = result.dpnRisk.contributingDebits[0]
    expect(debit.debit).toBe(7250)
    expect(debit.daysLate).toBe(171)
    expect(debit.paymentsSinceLodged).toBe(6510)
    expect(debit.netAtRisk).toBe(740)

    // Period spans full CSV range
    expect(result.dpnRisk.periodStart).not.toBeNull()
    expect(result.dpnRisk.periodEnd).not.toBeNull()
    expect(new Date(result.dpnRisk.periodStart!).getFullYear()).toBe(2019)
    expect(new Date(result.dpnRisk.periodEnd!).getFullYear()).toBe(2026)

    // Debt breakdown
    // principalDebits: $7250 + $152300 + $141760 + $6840 + $5330 + $7610 = $321,090
    // principalCredits: $12480 + $3615 + $2895 = $18,990
    // interestDebits: $24180 + $29860 = $54,040
    // interestCredits: $2415 (remission)
    // paymentsReceived: $150000 + $121550 = $271,550
    // otherCredits: $26740 (credit transfer)
    expect(result.debtBreakdown.principalDebits).toBe(321090)
    expect(result.debtBreakdown.principalCredits).toBe(18990)
    expect(result.debtBreakdown.principalNet).toBe(302100)
    expect(result.debtBreakdown.interestDebits).toBe(54040)
    expect(result.debtBreakdown.interestCredits).toBe(2415)
    expect(result.debtBreakdown.interestNet).toBe(51625)
    expect(result.debtBreakdown.paymentsReceived).toBe(271550)
    expect(result.debtBreakdown.governmentCredits).toBe(0)
    expect(result.debtBreakdown.otherCredits).toBe(26740)
    expect(result.debtBreakdown.totalAtoDebt).toBe(302100 + 51625)
    expect(result.debtBreakdown.currentBalance).toBe(302100 + 51625 - 271550 - 26740)
    // The printed running balance on the newest row agrees.
    expect(result.debtBreakdown.currentBalance).toBe(55435)
  })
})

describe('extractPeriodEnding', () => {
  it('extracts 2-digit year from Original statement', () => {
    expect(extractPeriodEnding('Original Activity Statement for the period ending 31 Dec 25'))
      .toEqual(new Date('2025-12-31'))
  })

  it('extracts 2-digit year from ClientAmended statement', () => {
    expect(extractPeriodEnding('Client initiated amended Activity Statement for the period ending 30 Jun 23'))
      .toEqual(new Date('2023-06-30'))
  })

  it('returns null for Payment received', () => {
    expect(extractPeriodEnding('Payment received')).toBeNull()
  })

  it('returns null for GIC description', () => {
    expect(extractPeriodEnding('General interest charge calculated from 01 Aug 25 to 31 Aug 25')).toBeNull()
  })
})

describe('classifyLodgement — new types', () => {
  it('classifies failure to lodge penalty', () => {
    expect(classifyLodgement('Failure to lodge penalty')).toBe('FTLPenalty')
  })

  it('classifies general penalty', () => {
    expect(classifyLodgement('General penalty for late lodgement')).toBe('GeneralPenalty')
  })

  it('classifies administrative penalty', () => {
    expect(classifyLodgement('Administrative penalty assessment')).toBe('GeneralPenalty')
  })

  it('classifies credit transfer', () => {
    expect(classifyLodgement('Credit transfer from Income Tax Account')).toBe('CreditTransfer')
  })

  it('classifies debit transfer as CreditTransfer', () => {
    expect(classifyLodgement('Debit transfer to Income Tax Account')).toBe('CreditTransfer')
  })

  it('existing classifier behaviour unchanged — Original', () => {
    expect(classifyLodgement('Original Activity Statement for the period ending 31 Dec 25')).toBe('Original')
  })

  it('existing classifier behaviour unchanged — SubLine', () => {
    expect(classifyLodgement('- GST')).toBe('SubLine')
  })

  // Bug 1: bare "Payment" rows
  it('classifies bare Payment (exact match)', () => {
    expect(classifyLodgement('Payment')).toBe('Payment')
  })

  it('classifies bare Payment with apostrophe prefix', () => {
    expect(classifyLodgement("'Payment")).toBe('Payment')
  })

  it('classifies Payment received', () => {
    expect(classifyLodgement('Payment received')).toBe('Payment')
  })

  it('classifies bare payment (lower case)', () => {
    expect(classifyLodgement('payment')).toBe('Payment')
  })

  // Bug 2: GovernmentCredit rows
  it('classifies Cash Flow Boost as GovernmentCredit', () => {
    expect(classifyLodgement('Original Cash Flow Boost 1 Payment for the period ending 31 Mar 20')).toBe('GovernmentCredit')
  })

  it('classifies JobKeeper as GovernmentCredit', () => {
    expect(classifyLodgement('JobKeeper top-up payment')).toBe('GovernmentCredit')
  })

  it('does NOT classify Original Activity Statement as GovernmentCredit', () => {
    expect(classifyLodgement('Original Activity Statement for the period ending 30 Jun 20')).toBe('Original')
  })
})
