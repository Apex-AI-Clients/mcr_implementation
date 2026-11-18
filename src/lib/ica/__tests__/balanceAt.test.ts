import { describe, expect, it } from 'vitest'
import { readStoredRows } from '../read'
import { reconcile } from '../reconcile'
import { balanceAt, icaHeadline, type VerifiedAccount } from '../balanceAt'

/** "ATO related debt – ICA": the ATO's proven balance at a period end. Synthetic rows, newest first. */

const row = (processedDate: string, description: string, debit: number | null, credit: number | null, balance: number) => ({
  processedDate,
  effectiveDate: processedDate,
  description,
  debit,
  credit,
  balance,
})

function account(label = 'Activity statement 001'): VerifiedAccount {
  const file = readStoredRows(
    [
      row('2025-10-02', 'Payment received', null, 500, 2500),
      row('2025-07-28', 'Original Activity Statement for the period ending 30 Jun 25', 1000, null, 3000),
      row('2025-06-15', 'General interest charge', 200, null, 2000),
      row('2024-06-20', 'Original Activity Statement for the period ending 31 Mar 24', 1800, null, 1800),
    ],
    { label },
  )!
  const reconciliation = reconcile(file)
  expect(reconciliation.verified).toBe(true)
  return { label, documentId: 'ica-1', filename: 'ica.csv', file, reconciliation }
}

describe('balanceAt', () => {
  it("is the ATO's closing balance on the last balance day on or before the date, with the row that printed it", () => {
    const b = balanceAt(account(), '2025-06-30')
    expect(b).toMatchObject({ kind: 'balance', balance: { cents: 200000, day: '2025-06-15', row: { description: 'General interest charge', rawBalance: '$2,000.00 DR' } } })
    expect(balanceAt(account(), '2024-06-30')).toMatchObject({ kind: 'balance', balance: { cents: 180000, day: '2024-06-20' } })
  })

  it("after the export's newest balance day, the ATO's balance on that day", () => {
    expect(balanceAt(account(), '2025-12-31')).toMatchObject({ kind: 'balance', balance: { cents: 250000, day: '2025-10-02' } })
  })

  it('nothing before the export starts', () => {
    expect(balanceAt(account(), '2023-06-30')).toEqual({ kind: 'none', reason: 'Activity statement 001: the ATO export starts after 30 Jun 2023' })
  })

  it('several accounts are added up, each named; any missing date leaves the year blank with why', () => {
    const cells = icaHeadline([account(), account('Activity statement 002')], ['2025-06-30', '2023-06-30'])
    expect(cells[0]).toMatchObject({ cell: { value: 4000, date: '2025-06-30' } })
    expect('cell' in cells[0] && cells[0].cell.balances.map((b) => b.label)).toEqual(['Activity statement 001', 'Activity statement 002'])
    expect(cells[1]).toEqual({ none: 'Activity statement 001: the ATO export starts after 30 Jun 2023' })
  })
})
