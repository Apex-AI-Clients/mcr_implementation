// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { NO_PAYMENTS_EVER_DAYS } from '../config'
import { nameKey } from '../normalise'
import { DEFAULT_VALIDATE_OPTIONS, validateRow } from '../validateRow'
import { sourceRow, validated } from './fixtures'

const codes = (row: ReturnType<typeof validated>) => row.reasons.map((r) => r.code)
const noteCodes = (row: ReturnType<typeof validated>) => row.notes.map((n) => n.code)

describe('validateRow: a valid row', () => {
  it('is accepted and stored in the table columns', () => {
    const row = validated()
    expect(row.reasons).toEqual([])
    expect(row.notes).toEqual([])
    expect(row.nameKey).toBe('example trading')
    expect(row.record).toMatchObject({
      client_name: 'Example Trading Pty Ltd',
      dpn: false,
      payment_plan_type: 'plan',
      term_months: null,
      director_loan_at_appointment: false,
      director_loan_raw: 'N',
      director_loan_receivable_amount: 0,
      director_loan_payable_amount: null,
      cumulative_days_late: 450,
      number_of_late_lodgements: 9,
      days_since_last_payment: 120,
      outcome_percent: 35,
      accepted: true,
      creditor_amount: 250000,
      sbr_payment: 100000,
      business_type: 'Cafe & Restaurant',
      number_of_creditors: 3,
    })
    expect(row.share).toBeCloseTo(0.875)
  })

  it('accepts numeric cells as Excel gives them', () => {
    const row = validated({ creditorAmount: 250000, sbrPayment: 100000, centsInDollar: 35, cumulativeDaysLate: 450 })
    expect(row.reasons).toEqual([])
  })
})

describe('validateRow: the rules', () => {
  it('a. needs a client name', () => {
    expect(codes(validated({ clientName: '  ' }))).toContain('missing_name')
    expect(codes(validated({ clientName: 'Pty Ltd' }))).toContain('missing_name')
  })

  it('b. takes only Accepted or Rejected', () => {
    expect(validated({ outcome: 'rejected' }).record?.accepted).toBe(false)
    const row = validated({ outcome: 'Cancelled' })
    expect(codes(row)).toEqual(['outcome'])
    expect(row.reasons[0].message).toContain('"Cancelled"')
  })

  it('c. takes Upfront, Plan and Plan N months', () => {
    expect(validated({ paymentType: 'Upfront' }).record?.payment_plan_type).toBe('upfront')
    expect(validated({ paymentType: 'Plan 24 Months' }).record).toMatchObject({
      payment_plan_type: 'plan',
      term_months: 24,
    })
    expect(validated({ paymentType: 'plan  30 month' }).record?.term_months).toBe(30)
    const both = validated({ paymentType: 'Upfront and Plan' })
    expect(codes(both)).toEqual(['payment_type'])
    expect(both.reasons[0].message).toBe('Payment type "Upfront and Plan" not supported yet.')
    expect(codes(validated({ paymentType: 'Plan 0 months' }))).toEqual(['payment_type'])
  })

  it('d. takes DPN as Y/N/Yes/No', () => {
    expect(validated({ dpn: 'Yes' }).record?.dpn).toBe(true)
    expect(codes(validated({ dpn: 'Unknown' }))).toEqual(['dpn'])
  })

  it('e. reads the director loan, including Receivable and Payable', () => {
    expect(validated({ directorLoanAtAppointment: 'Yes (Receivable)', directorLoanAmount: '12,000' }).record)
      .toMatchObject({ director_loan_at_appointment: true, director_loan_receivable_amount: 12000 })
    expect(codes(validated({ directorLoanAtAppointment: 'Sometimes' }))).toEqual(['director_loan'])
    expect(codes(validated({ directorLoanAmount: 'lots' }))).toEqual(['director_loan'])
  })

  it('e. treats a payable loan as no receivable loan, keeping the cell and amount', () => {
    const row = validated({ directorLoanAtAppointment: 'Yes (Payable)', directorLoanAmount: '8,500.00' })
    expect(row.reasons).toEqual([])
    expect(noteCodes(row)).toEqual(['payable_loan'])
    expect(row.notes[0].message).toBe('Payable loan, treated as not receivable.')
    expect(row.record).toMatchObject({
      director_loan_at_appointment: false,
      director_loan_receivable_amount: 0,
      director_loan_raw: 'Yes (Payable)',
      director_loan_payable_amount: 8500,
    })
  })

  it('e. rejects a payable loan when the switch says so', () => {
    const row = validateRow(
      sourceRow({ directorLoanAtAppointment: 'Yes (Payable)' }),
      { ...DEFAULT_VALIDATE_OPTIONS, directorLoanPayableMode: 'reject' },
    )
    expect(codes(row)).toEqual(['director_loan_payable'])
  })

  it('f. checks every figure', () => {
    expect(codes(validated({ creditorAmount: '0' }))).toContain('creditor_amount')
    expect(codes(validated({ sbrPayment: '' }))).toContain('sbr_payment')
    expect(codes(validated({ centsInDollar: '101' }))).toContain('cents_in_dollar')
    expect(codes(validated({ cumulativeDaysLate: '-1' }))).toEqual(['cumulative_days_late'])
    expect(codes(validated({ numberOfLateLodgements: '2.5' }))).toEqual(['number_of_late_lodgements'])
    expect(codes(validated({ daysSinceLastPayment: 'recently' }))).toEqual(['days_since_last_payment'])
    expect(codes(validated({ daysSinceLastPayment: '' }))).toEqual(['days_since_last_payment'])
  })

  it('f. reads "-" as 0 and NO PAYMENTS EVER as the sentinel', () => {
    expect(validated({ cumulativeDaysLate: '-' }).record?.cumulative_days_late).toBe(0)
    expect(validated({ daysSinceLastPayment: 'NO PAYMENTS EVER.' }).record?.days_since_last_payment).toBe(
      NO_PAYMENTS_EVER_DAYS,
    )
    // A real figure can never be mistaken for the sentinel.
    expect(codes(validated({ daysSinceLastPayment: String(NO_PAYMENTS_EVER_DAYS) }))).toEqual([
      'days_since_last_payment',
    ])
  })

  it('g. rejects a payment above the debt', () => {
    const row = validated({ sbrPayment: '300,000', centsInDollar: '100' })
    expect(codes(row)).toContain('payment_exceeds_debt')
  })

  it('h. rejects payment and C$ that do not match, and notes a rough match', () => {
    // 20 × 250,000 ÷ 100,000 = 50%
    const mismatch = validated({ centsInDollar: '20' })
    expect(codes(mismatch)).toEqual(['payment_cents_mismatch'])
    expect(mismatch.reasons[0].message).toContain("Payment and C/$ don't match")
    // 33 → 82.5%: accepted with a note. 41 → 102.5%: the same.
    expect(noteCodes(validated({ centsInDollar: '33' }))).toEqual(['share_borderline'])
    expect(noteCodes(validated({ centsInDollar: '41' }))).toEqual(['share_borderline'])
    // 45 → 112.5%: rejected.
    expect(codes(validated({ centsInDollar: '45' }))).toEqual(['payment_cents_mismatch'])
    // The edges are inside.
    expect(codes(validated({ centsInDollar: '32' }))).toEqual([]) // 80%
    expect(codes(validated({ centsInDollar: '44' }))).toEqual([]) // 110%
  })

  it('i. rejects an excluded name, however it is spelt', () => {
    const options = { ...DEFAULT_VALIDATE_OPTIONS, excluded: new Map([[nameKey('Bad Data Co'), 'previously confirmed data error']]) }
    const row = validateRow(sourceRow({ clientName: 'BAD DATA CO PTY LIMITED' }), options)
    expect(codes(row)).toEqual(['excluded'])
    expect(row.reasons[0].message).toBe('On the excluded list: previously confirmed data error.')
  })

  it('i. ships with the two names Gabby confirmed as data errors', () => {
    expect(DEFAULT_VALIDATE_OPTIONS.excluded.size).toBe(2)
  })

  it('reports every failing rule, not just the first', () => {
    const row = validated({ clientName: '', outcome: 'Withdrawn', dpn: '?', sbrPayment: '300,000' })
    expect(codes(row)).toEqual(expect.arrayContaining(['missing_name', 'outcome', 'dpn', 'payment_exceeds_debt']))
    expect(row.record).toBeNull()
  })

  it('leaves an unreadable creditor count blank, with a note', () => {
    const row = validated({ numberOfCreditors: 'several' })
    expect(row.reasons).toEqual([])
    expect(row.record?.number_of_creditors).toBeNull()
    expect(noteCodes(row)).toEqual(['number_of_creditors_ignored'])
  })
})
