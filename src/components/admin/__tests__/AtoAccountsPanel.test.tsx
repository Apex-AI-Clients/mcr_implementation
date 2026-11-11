import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AtoAccountsPanel } from '../AtoAccountsPanel'

/** The ATO accounts panel with an account whose dates could not be read. Synthetic figures only. */

afterEach(() => cleanup())

describe('AtoAccountsPanel — dates that could not be read', () => {
  it('shows the account as failed, with why, and no balance or total', () => {
    render(
      <AtoAccountsPanel
        clientId="c1"
        overview={{
          accounts: [
            { id: 'a', documentId: 'd', kind: 'activity_statement', label: 'Activity statement 001', balance: 10_000, balanceDate: '2026-09-30', needsReview: false, reviewedAt: null, entityMatches: true, olderFiles: 0, unparsedDateRows: 0 },
            { id: 'b', documentId: 'e', kind: 'income_tax', label: 'Income tax 001', balance: null, balanceDate: null, needsReview: false, reviewedAt: null, entityMatches: true, olderFiles: 0, unparsedDateRows: 34 },
          ],
          totalDebt: null,
          unreadable: [{ label: 'Income tax 001', rows: 34 }],
        }}
      />,
    )
    expect(screen.getByText('Failed: dates unreadable')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(
      "We couldn't read the dates on 34 rows of this file — was it edited in Excel? Upload the original ATO download.",
    )
    expect(screen.getByText('Not read')).toBeTruthy()
    expect(screen.getByText('Total ATO debt not available: dates unreadable')).toBeTruthy()
    // The readable account still shows its balance.
    expect(screen.getByText('$10,000.00 DR')).toBeTruthy()
  })
})
