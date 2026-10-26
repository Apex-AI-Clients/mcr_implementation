import { describe, it, expect } from 'vitest'
import {
  directorLoanLabel,
  directorLoanMismatch,
  dpnNote,
  inputsChanged,
  nextDirectorLoanOverride,
  readDirectorLoanOverride,
  resolveAtoDebt,
  resolveDirectorLoan,
  type LoanEvidence,
} from '../inputPrecedence'

/**
 * Saved prediction inputs against fresh evidence: the evidence wins unless
 * staff set the value after it. Synthetic figures only.
 */

const MAPPED_AT = '2026-10-20T09:00:00Z'

const LOAN: LoanEvidence = {
  detected: true,
  amount: 120_000,
  asOf: '2026-06-30',
  lines: ['Loan - Related Parties'],
  changedAt: MAPPED_AT,
}

describe('director loan at appointment', () => {
  it('ticks Yes over a stale saved No when the balance sheet shows a loan, with a note', () => {
    const r = resolveDirectorLoan(false, null, LOAN)
    expect(r.value).toBe(true)
    expect(r.note).toBe(
      'Ticked Yes: the balance sheet at 30 Jun 2026 shows “Loan - Related Parties” $120,000 owed to the company (last prediction said No).',
    )
  })

  it('keeps No when staff overrode it with a reason after the mapping', () => {
    const override = { value: false, reason: 'Loan repaid before appointment', setAt: '2026-10-21T10:00:00Z', amount: 120_000 }
    const r = resolveDirectorLoan(false, override, LOAN)
    expect(r).toEqual({ value: false, note: null, override })
  })

  it('keeps the override against the same amount, even when the statements were read again since', () => {
    const override = { value: false, reason: 'Loan repaid before appointment', setAt: '2026-10-19T10:00:00Z', amount: 120_000 }
    expect(resolveDirectorLoan(false, override, LOAN).value).toBe(false)
  })

  it('lets a changed balance sheet win over an older override', () => {
    const override = { value: false, reason: 'Loan repaid before appointment', setAt: '2026-10-19T10:00:00Z', amount: 40_000 }
    const r = resolveDirectorLoan(false, override, LOAN)
    expect(r.value).toBe(true)
    expect(r.override).toBeNull()
  })

  it('unticks a stale Yes when the balance sheet shows no loan', () => {
    const r = resolveDirectorLoan(true, null, { ...LOAN, detected: false, amount: 0, lines: [] })
    expect(r.value).toBe(false)
    expect(r.note).toMatch(/^Unticked: the balance sheet at 30 Jun 2026 shows no loan owed to the company \(last prediction said Yes\)\.$/)
  })

  it("keeps staff's answer when the loan lines are not identified", () => {
    expect(resolveDirectorLoan(true, null, { ...LOAN, detected: null, amount: 0, asOf: null, lines: [] })).toMatchObject({ value: true, note: null })
  })

  it('takes the evidence, without a note, when there is no saved prediction or they agree', () => {
    expect(resolveDirectorLoan(null, null, LOAN)).toEqual({ value: true, note: null, override: null })
    expect(resolveDirectorLoan(true, null, LOAN)).toEqual({ value: true, note: null, override: null })
  })

  it('names the balance sheet in the labels', () => {
    expect(directorLoanLabel('Director loan at appointment', '2026-06-30')).toBe(
      'Director loan at appointment (from the balance sheet at 30 Jun 2026)',
    )
    expect(directorLoanLabel('Director loan receivable amount', null)).toBe('Director loan receivable amount')
  })
})

describe('director loan flag and amount must agree', () => {
  it('says why for No with a loan, and for Yes with nothing owed', () => {
    expect(directorLoanMismatch(false, 120_000, '2026-06-30')).toBe(
      'Director loan at appointment is No, but the balance sheet at 30 Jun 2026 shows $120,000 owed to the company. Tick Yes, or give a reason for keeping No.',
    )
    expect(directorLoanMismatch(true, 0, null)).toMatch(/^Director loan at appointment is Yes, but the director loan receivable amount is \$0\./)
    expect(directorLoanMismatch(true, 120_000, null)).toBeNull()
    expect(directorLoanMismatch(false, 0, null)).toBeNull()
  })

  it('refuses a mismatch without a reason, and stores one with it', () => {
    const base = { value: false, amount: 120_000, asOf: '2026-06-30', stored: null, now: '2026-10-22T00:00:00Z' }
    expect(nextDirectorLoanOverride({ ...base, reason: '' }).error).toMatch(/is No, but the balance sheet/)
    expect(nextDirectorLoanOverride({ ...base, reason: 'ok' }).error).not.toBeNull()
    expect(nextDirectorLoanOverride({ ...base, reason: '  Loan repaid before appointment ' })).toEqual({
      override: { value: false, reason: 'Loan repaid before appointment', setAt: '2026-10-22T00:00:00Z', amount: 120_000 },
      error: null,
    })
  })

  it('keeps the original time when the same answer and reason are sent again', () => {
    const stored = { value: false, reason: 'Loan repaid before appointment', setAt: '2026-10-01T00:00:00Z', amount: 120_000 }
    const next = nextDirectorLoanOverride({
      value: false,
      amount: 120_000,
      asOf: null,
      reason: 'Loan repaid before appointment',
      stored,
      now: '2026-10-22T00:00:00Z',
    })
    expect(next.override).toBe(stored)
  })

  it('stores nothing when they agree', () => {
    expect(nextDirectorLoanOverride({ value: true, amount: 1, asOf: null, reason: 'x', stored: null, now: 'n' })).toEqual({
      override: null,
      error: null,
    })
  })

  it('reads a stored override, and nothing malformed', () => {
    const o = { value: true, reason: 'r', setAt: '2026-10-01T00:00:00Z', amount: 0 }
    expect(readDirectorLoanOverride({ directorLoanAtAppointment: o })).toEqual(o)
    expect(readDirectorLoanOverride({ directorLoanAtAppointment: { value: 'yes' } })).toBeNull()
    expect(readDirectorLoanOverride(null)).toBeNull()
  })
})

describe('ATO debt staff typed', () => {
  const ICA = { amount: 90_000, description: 'ATO account statement, 26 Sep 2026', changedAt: '2026-10-10T00:00:00Z' }
  const saved = (extra: object = {}) => ({ atoDebt: 75_000, atoDebtEdited: true, rows: [], ...extra })

  it('gives way to a statement analysed after it was typed, with a note', () => {
    const r = resolveAtoDebt(saved({ atoDebtEditedAt: '2026-10-01T00:00:00Z', atoDebtAuto: 60_000 }), null, ICA)
    expect(r.staffAmount).toBeNull()
    expect(r.note).toBe(
      'Updated to $90,000 from the ATO account statement, 26 Sep 2026 (last prediction used $75,000, entered by staff before it). Re-enter it if it is still right.',
    )
  })

  it('stands when typed after the statement, or over the same automatic figure', () => {
    expect(resolveAtoDebt(saved({ atoDebtEditedAt: '2026-10-11T00:00:00Z' }), null, ICA).staffAmount).toBe(75_000)
    expect(resolveAtoDebt(saved({ atoDebtEditedAt: '2026-10-01T00:00:00Z', atoDebtAuto: 90_000 }), null, ICA).staffAmount).toBe(75_000)
  })

  it("uses the prediction's time for one saved before the edit time was kept", () => {
    expect(resolveAtoDebt(saved(), '2026-10-12T00:00:00Z', ICA).staffAmount).toBe(75_000)
    expect(resolveAtoDebt(saved(), '2026-10-05T00:00:00Z', ICA).staffAmount).toBeNull()
  })

  it('has nothing to resolve when staff did not type one', () => {
    expect(resolveAtoDebt({ atoDebt: 75_000, atoDebtEdited: false, rows: [] }, null, ICA)).toEqual({ staffAmount: null, note: null })
  })
})

describe('DPN', () => {
  it('notes a notice on file against a saved No, and nothing when they agree', () => {
    expect(dpnNote(false, true)).toBe('Yes: a notice is on file (last prediction said No).')
    expect(dpnNote(true, true)).toBeNull()
    expect(dpnNote(false, null)).toBeNull()
  })
})

describe('a saved prediction whose inputs the evidence contradicts', () => {
  const SAVED = {
    dpn: false,
    directorLoanAtAppointment: false,
    directorLoanReceivableAmount: 0,
    cumulativeDaysLate: 400,
    numberOfLateLodgements: 8,
    daysSinceLastPayment: 120,
  }
  const SAME = {
    directorLoanAtAppointment: false,
    directorLoanReceivableAmount: 0,
    dpn: false,
    cumulativeDaysLate: 400,
    numberOfLateLodgements: 8,
    daysSinceLastPayment: 120,
    atoDebt: 90_000,
  }

  it('lists what changed', () => {
    expect(
      inputsChanged(SAVED, 80_000, { ...SAME, directorLoanAtAppointment: true, directorLoanReceivableAmount: 120_000, dpn: true }),
    ).toEqual(['Director loan at appointment', 'Director loan receivable amount', 'Director Penalty Notice', 'ATO debt'])
  })

  it('is empty when nothing changed, and skips keys an older prediction does not carry', () => {
    expect(inputsChanged(SAVED, 90_000, SAME)).toEqual([])
    expect(inputsChanged({ directorLoanAtAppointment: false }, null, { ...SAME, cumulativeDaysLate: 999 })).toEqual([])
  })
})
