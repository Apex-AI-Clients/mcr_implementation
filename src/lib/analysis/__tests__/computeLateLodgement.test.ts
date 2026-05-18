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

describe('computeLateLodgement — sign convention sanity checks (PARKCON dataset values)', () => {
  it('early lodgement returns negative days', () => {
    expect(
      lateDays(
        '2026-02-26',
        '2026-03-03',
        'Original Activity Statement for the period ending 31 Dec 25',
      ),
    ).toBe(-5)
  })

  it('early lodgement returns negative days (2)', () => {
    expect(
      lateDays(
        '2025-08-21',
        '2025-08-25',
        'Original Activity Statement for the period ending 30 Jun 25',
      ),
    ).toBe(-4)
  })

  it('late ClientAmended returns positive days', () => {
    expect(
      lateDays(
        '2024-12-11',
        '2023-08-25',
        'Client initiated amended Activity Statement for the period ending 30 Jun 23',
      ),
    ).toBe(474)
  })

  it('late ClientAmended returns positive days (2)', () => {
    expect(
      lateDays(
        '2022-11-17',
        '2022-08-25',
        'Client initiated amended Activity Statement for the period ending 30 Jun 22',
      ),
    ).toBe(84)
  })

  it('late Original returns positive days', () => {
    expect(
      lateDays(
        '2021-03-26',
        '2021-03-02',
        'Original Activity Statement for the period ending 31 Dec 20',
      ),
    ).toBe(24)
  })

  it('late ClientAmended spanning multiple years returns positive days', () => {
    expect(
      lateDays(
        '2020-03-11',
        '2018-11-26',
        'Client initiated amended Activity Statement for the period ending 30 Sep 18',
      ),
    ).toBe(471)
  })
})

describe('computeLateLodgement — sub-lines and non-lodgement types always return zero', () => {
  it('- GST returns 0', () => {
    expect(lateDays('2024-12-11', '2023-08-25', '- GST')).toBe(0)
  })

  it('- PAYG Withholding returns 0', () => {
    expect(lateDays('2024-12-11', '2023-08-25', '- PAYG Withholding')).toBe(0)
  })

  it('Payment received returns 0', () => {
    expect(lateDays('2024-12-11', '2023-08-25', 'Payment received')).toBe(0)
  })

  it('General interest charge returns 0', () => {
    expect(
      lateDays(
        '2024-12-11',
        '2023-08-25',
        'General interest charge calculated from 01 Aug 25 to 31 Aug 25',
      ),
    ).toBe(0)
  })

  it('ATOAmended returns 0', () => {
    expect(
      lateDays(
        '2024-12-11',
        '2023-08-25',
        'ATO initiated amended Activity Statement for the period ending 30 Jun 24',
      ),
    ).toBe(0)
  })
})

describe('computeLateLodgement — cleaned = max(value, 0)', () => {
  it('cleans negative to 0', () => expect(cleaned(-14)).toBe(0))
  it('leaves 0 as 0', () => expect(cleaned(0)).toBe(0))
  it('leaves positive as-is', () => expect(cleaned(474)).toBe(474))

  it('lateLodgeDaysCleaned is zero for early lodgement', () => {
    const result = computeLateLodgement(
      makeCsv([
        makeRow(
          '2026-02-26',
          '2026-03-03',
          'Original Activity Statement for the period ending 31 Dec 25',
        ),
      ]),
    )
    expect(result.rows[0].lateLodgementDays).toBe(-5)
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
        makeRow('2024-12-11', null, 'Client initiated amended Activity Statement for the period ending 30 Jun 23'),
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
        makeRow('2024-12-11', '2023-08-25', 'Client initiated amended Activity Statement for the period ending 30 Jun 23', 0),
        makeRow('2026-02-26', '2026-03-03', 'Original Activity Statement for the period ending 31 Dec 25', 1),
        makeRow('2021-03-26', '2021-03-02', 'Original Activity Statement for the period ending 31 Dec 20', 2),
      ]),
    )
    expect(result.summary.numberOfLateLodgements).toBe(2)
    expect(result.summary.cumulativeDaysLate).toBe(474 + 24)
  })
})

describe('computeLateLodgement — integration with sample fixture CSV', () => {
  it('produces correct summary from the sample fixture', () => {
    const csvText = readFileSync(
      join(__dirname, 'fixtures', 'activity_statement_sample.csv'),
      'utf-8',
    )
    const parsed = parseActivityStatementCsv(csvText)
    const result = computeLateLodgement(parsed)

    // 4 lodgement rows are late in the sample fixture:
    // ClientAmended 30 Jun 23: 474 days
    // ClientAmended 30 Jun 22: 84 days
    // Original 31 Dec 20: 24 days
    // ClientAmended 30 Sep 18: 471 days
    expect(result.summary.numberOfLateLodgements).toBe(4)
    expect(result.summary.cumulativeDaysLate).toBe(474 + 84 + 24 + 471)

    // DPN: Original/ClientAmended rows with lateLodgementDays > 90 AND debit > 0
    // ClientAmended 30 Jun 23 (474d, processedDate 11 Dec 2024): debit $2000
    //   → payments since 11 Dec 2024: none (only payment is 10 Jun 2023) → net $2000
    // ClientAmended 30 Sep 18 (471d, processedDate 11 Mar 2020): debit $1100
    //   → payments since 11 Mar 2020: $3500 (10 Jun 2023), capped at $1100 → net $0
    expect(result.dpnRisk.contributingDebits).toHaveLength(2)
    expect(result.dpnRisk.totalGrossLate).toBe(3100)
    expect(result.dpnRisk.totalPaidSince).toBe(1100)
    expect(result.dpnRisk.totalNetAtRisk).toBe(2000)

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
    expect(result.debtBreakdown.currentBalance).toBeCloseTo(6571.56 + 45 - 3500, 1)
  })
})

describe('computeLateLodgement — integration with PARKCON fixture CSV', () => {
  it('produces the exact PARKCON reference figures', () => {
    const csvText = readFileSync(
      join(__dirname, 'fixtures', 'parkcon_activity_statement.csv'),
      'utf-8',
    )
    const parsed = parseActivityStatementCsv(csvText)
    const result = computeLateLodgement(parsed)

    // 6 late lodgements: 178 + 471 + 24 + 84 + 89 + 474 = 1320 days
    expect(result.summary.numberOfLateLodgements).toBe(6)
    expect(result.summary.cumulativeDaysLate).toBe(1320)

    // DPN methodology corrected (15 May 2026): per-row netting of cash payments only.
    // Row 0: Original, 178d, debit $9,408 → only qualifying contributing debit
    // Row 3: ClientAmended, 471d, credit $4,144 → credit-only, NOT a contributing debit
    // Row 10: ClientAmended, 474d, credit $4,390 → credit-only, NOT a contributing debit
    // Payments since 21 Feb 2019: $200,000 (01 Jun 2023) + $162,335 (01 Mar 2025) = $362,335
    // Capped at $9,408 → totalPaidSince = $9,408, totalNetAtRisk = $0
    expect(result.dpnRisk.contributingDebits).toHaveLength(1)
    expect(result.dpnRisk.totalGrossLate).toBe(9408)
    expect(result.dpnRisk.totalPaidSince).toBe(9408)
    expect(result.dpnRisk.totalNetAtRisk).toBe(0)

    // The single contributing debit is the 21 Feb 2019 lodgement
    const debit = result.dpnRisk.contributingDebits[0]
    expect(debit.debit).toBe(9408)
    expect(debit.daysLate).toBe(178)
    expect(debit.paymentsSinceLodged).toBe(9408)
    expect(debit.netAtRisk).toBe(0)

    // Period spans full CSV range
    expect(result.dpnRisk.periodStart).not.toBeNull()
    expect(result.dpnRisk.periodEnd).not.toBeNull()
    expect(new Date(result.dpnRisk.periodStart!).getFullYear()).toBe(2019)
    expect(new Date(result.dpnRisk.periodEnd!).getFullYear()).toBe(2026)

    // Debt breakdown
    // principalDebits: $9408 + $200000 + $184412 + $7500 + $6200 + $8900 = $416,420
    // principalCredits: $15862 + $4144 + $4390 = $24,396
    // interestDebits: $30000 + $37494 = $67,494
    // interestCredits: $3047 (remission)
    // paymentsReceived: $200000 + $162335 = $362,335
    // otherCredits: $32999 (credit transfer)
    expect(result.debtBreakdown.principalDebits).toBe(416420)
    expect(result.debtBreakdown.principalCredits).toBe(24396)
    expect(result.debtBreakdown.principalNet).toBe(392024)
    expect(result.debtBreakdown.interestDebits).toBe(67494)
    expect(result.debtBreakdown.interestCredits).toBe(3047)
    expect(result.debtBreakdown.interestNet).toBe(64447)
    expect(result.debtBreakdown.paymentsReceived).toBe(362335)
    expect(result.debtBreakdown.governmentCredits).toBe(0)
    expect(result.debtBreakdown.otherCredits).toBe(32999)
    expect(result.debtBreakdown.totalAtoDebt).toBe(392024 + 64447)
    expect(result.debtBreakdown.currentBalance).toBe(392024 + 64447 - 362335 - 32999)
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
