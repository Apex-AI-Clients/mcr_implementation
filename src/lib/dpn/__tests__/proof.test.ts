import { describe, expect, it } from 'vitest'
import { readIcaCsv } from '@/lib/ica/read'
import { reconcile } from '@/lib/ica/reconcile'
import { noticeAccountFrom, proveNotice } from '../proof'
import type { DpnRow } from '../types'

/** A notice is used only when proven: its own arithmetic, and Column 2 against the verified ATO account. Synthetic only. */

type Cells = [string, string, string, string, string, string]
const csv = (rows: Cells[]) =>
  ['"Activity statement 001"', '"TEST ENTITY"', 'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance', ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\r\n')

// Q3 2025: GST 600 + PAYGW 400, then an amendment taking GST down by 100; Q4 2025: PAYGW 500 only.
const ACCOUNT_ROWS: Cells[] = [
  ['10 Mar 2026', '28 Feb 2026', "'Original Activity Statement for the period ending 31 Dec 25", '', '', '$1,400.00 DR'],
  ['10 Mar 2026', '28 Feb 2026', "'- PAYG Withholding", '$500.00', '', ''],
  ['20 Jan 2026', '28 Oct 2025', "'Client initiated amended Activity Statement for the period ending 30 Sep 25", '', '$100.00', '$900.00 DR'],
  ['20 Jan 2026', '28 Oct 2025', "'- GST", '', '$100.00', ''],
  ['01 Dec 2025', '28 Oct 2025', "'Original Activity Statement for the period ending 30 Sep 25", '$1,000.00', '', '$1,000.00 DR'],
  ['01 Dec 2025', '28 Oct 2025', "'- GST", '$600.00', '', ''],
  ['01 Dec 2025', '28 Oct 2025', "'- PAYG Withholding", '$400.00', '', ''],
]
const file = readIcaCsv(csv(ACCOUNT_ROWS))
const account = noticeAccountFrom([{ file, reconciliation: reconcile(file) }])

const row = (periodFrom: string, periodTo: string, column2: number, column3: number, column4: number, column5: number): DpnRow => ({ periodFrom, periodTo, column2, column3, column4, column5 })
const notice = (type: 'gst' | 'paygw', rows: DpnRow[]) => ({ type, issuedOn: '2026-10-01', acn: '000000019', rows, totals: null })

describe('the ATO account per period and tax type', () => {
  it('nets every statement of the period (original and amendments), each tax line on its own', () => {
    expect(reconcile(file).verified).toBe(true)
    expect(account.byPeriod.get('2025-09-30|gst')?.cents).toBe(50_000)
    expect(account.byPeriod.get('2025-09-30|paygw')?.cents).toBe(40_000)
    expect(account.byPeriod.get('2025-12-31|paygw')?.cents).toBe(50_000)
    expect(account.byPeriod.get('2025-12-31|gst')).toBeUndefined()
  })
})

describe('proveNotice', () => {
  it('a notice that adds up and matches the ATO account on every period', () => {
    const p = proveNotice(notice('paygw', [row('2025-07-01', '2025-09-30', 40_000, 40_000, 40_000, 0), row('2025-10-01', '2025-12-31', 50_000, 30_000, 10_000, 20_000)]), account)
    expect(p).toMatchObject({ status: 'verified', badges: ['Notice adds up', 'Matches the ATO account'], note: null })
  })

  it('a row whose Column 3 is not Column 4 + Column 5 (to the cent) makes it unverified', () => {
    const p = proveNotice(notice('paygw', [row('2025-07-01', '2025-09-30', 40_000, 40_000, 30_000, 9_999)]), account)
    expect(p.status).toBe('unverified')
    expect(p.badges).toEqual([])
    expect(p.rowsNotAddingUp).toEqual([{ periodFrom: '2025-07-01', periodTo: '2025-09-30', column3: 40_000, column4: 30_000, column5: 9_999 }])
  })

  it('a Column 2 that differs from the ATO account makes it unverified, with the account rows in its words', () => {
    const p = proveNotice(notice('gst', [row('2025-07-01', '2025-09-30', 60_000, 60_000, 60_000, 0)]), account)
    expect(p.status).toBe('unverified')
    expect(p.badges).toEqual(['Notice adds up'])
    expect(p.account?.mismatches[0]).toMatchObject({ periodTo: '2025-09-30', notice: 60_000, account: 50_000 })
    expect(p.account?.mismatches[0].accountRows.join(' ')).toMatch(/- GST/)
  })

  it('periods outside the ATO export are listed, not a mismatch: still verified, no alert', () => {
    const p = proveNotice(notice('paygw', [row('2025-07-01', '2025-09-30', 40_000, 40_000, 40_000, 0), row('2026-01-01', '2026-03-31', 70_000, 70_000, 70_000, 0)]), account)
    expect(p.status).toBe('verified')
    expect(p.badges).toEqual(['Notice adds up'])
    expect(p.note).toBe('Matches the ATO account for 1 of 2 periods; 1 period is outside the ATO export (1 Jan 2026 – 31 Mar 2026)')
  })

  it('with no verified ATO account on file, proven by its own arithmetic only', () => {
    expect(proveNotice(notice('gst', [row('2025-07-01', '2025-09-30', 1, 1, 1, 0)]), null)).toMatchObject({ status: 'verified', badges: ['Notice adds up'], account: null })
  })

  it('a three-column PAYGW notice (Column 4 = Column 3, Column 5 = 0) adds up', () => {
    expect(proveNotice(notice('paygw', [row('2025-07-01', '2025-09-30', 40_000, 40_000, 40_000, 0)]), null).addsUp).toBe(true)
  })

  it('needs its type, issue date, ACN and rows; stored totals must be its rows’ sums', () => {
    expect(proveNotice({ type: null, issuedOn: null, acn: null, rows: [], totals: null }, null)).toMatchObject({ status: 'unverified', fieldsMissing: ['type', 'issue date', 'ACN', 'rows'] })
    const r = row('2025-07-01', '2025-09-30', 1, 1, 1, 0)
    expect(proveNotice({ type: 'gst', issuedOn: '2026-10-01', acn: '1', rows: [r], totals: { column2: 1, column3: 2, column4: 1, column5: 0 } }, null).status).toBe('unverified')
  })
})
