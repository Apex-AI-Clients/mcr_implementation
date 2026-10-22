import { describe, it, expect } from 'vitest'
import { exportsLocked, hardCheckFailures, hardChecksFingerprint } from '../hardChecks'
import type { FinancialCheck } from '../types'

/** The "Needs review" lock. Synthetic checks only. */

const check = (over: Partial<FinancialCheck> = {}): FinancialCheck => ({
  kind: 'totals_reconciliation',
  severity: 'warning',
  financialYear: 2023,
  statement: 'income_statement',
  message: 'Gross profit $300,000 + other income $0 − total expenses $250,000 = $50,000, but the profit before tax shown is $60,000.',
  documentIds: [],
  ...over,
})

const BUILT = '2026-10-21T01:13:16.416+00:00'

describe('hard checks', () => {
  it('counts failed arithmetic and roll-forward warnings, not notes or other warnings', () => {
    const failures = hardCheckFailures([
      check(),
      check({ kind: 'balance_sheet_equation' }),
      check({ kind: 'retained_earnings_rollforward' }),
      check({ severity: 'info', kind: 'retained_earnings_rollforward' }),
      check({ kind: 'extraction_note' }),
      check({ kind: 'entity_mismatch' }),
    ])
    expect(failures.map((c) => c.kind)).toEqual(['totals_reconciliation', 'balance_sheet_equation', 'retained_earnings_rollforward'])
  })

  it('locks the exports until a tick covers this build and these failures', () => {
    const failures = [check()]
    const fingerprint = hardChecksFingerprint(BUILT, failures)!
    expect(exportsLocked(failures, BUILT, null)).toBe(true)
    expect(exportsLocked(failures, BUILT, { fingerprint, by: 'Staff', at: BUILT })).toBe(false)
    // A rebuilt comparison needs a new tick.
    expect(exportsLocked(failures, '2026-10-22T00:00:00Z', { fingerprint, by: 'Staff', at: BUILT })).toBe(true)
    // So does a different failure.
    expect(exportsLocked([check({ financialYear: 2024 })], BUILT, { fingerprint, by: 'Staff', at: BUILT })).toBe(true)
  })

  it('never locks without a failure', () => {
    expect(hardChecksFingerprint(BUILT, [])).toBeNull()
    expect(exportsLocked([], BUILT, null)).toBe(false)
  })

  it('reads the same instant the same way, however it was written', () => {
    expect(hardChecksFingerprint('2026-10-21T01:13:16.416+00:00', [check()])).toBe(hardChecksFingerprint('2026-10-21T01:13:16.416Z', [check()]))
  })

  it('does not depend on the order of the failures', () => {
    const a = check()
    const b = check({ kind: 'balance_sheet_equation', message: 'Net assets do not equal total equity.' })
    expect(hardChecksFingerprint(BUILT, [a, b])).toBe(hardChecksFingerprint(BUILT, [b, a]))
  })
})
