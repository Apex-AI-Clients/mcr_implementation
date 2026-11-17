import { extractPeriodEnding } from '@/lib/analysis/parseActivityStatement'
import type { IcaFile } from '@/lib/ica/types'
import type { Reconciliation } from '@/lib/ica/reconcile'
import type { DpnAmounts, DpnRow, DpnType } from './types'

/**
 * A director penalty notice is used only when it is proven (Gabby, 17 Nov 2026):
 *
 *   1. Its own arithmetic: on every row Column 3 = Column 4 + Column 5, to the
 *      cent; its totals are the sums of its rows; its type, issue date and ACN
 *      were read. (A three-column PAYGW notice is read with Column 4 = Column 3
 *      and Column 5 = 0, so it adds up by construction.)
 *   2. When an ATO account verified against the ATO's own balance is on file:
 *      for each period on the notice, Column 2 equals what that account shows
 *      for the period and tax type (every statement of the period, original,
 *      amended or audit-raised, net). A period the account has no statement
 *      for is outside the ATO export: listed, but not a mismatch. Only an
 *      actual mismatch makes the notice unverified.
 *
 * Pure. Amounts in cents.
 */

export interface AccountPeriodAmount {
  cents: number
  /** The account's rows for it, in the ATO's words. */
  rows: string[]
}

export interface NoticeAccount {
  /** `${periodEnd}|${type}` → what the account shows for that period and tax type. */
  byPeriod: Map<string, AccountPeriodAmount>
  /** The account's labels ("Activity statement 002"), for the badge's source. */
  labels: string[]
}

const iso = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`

/**
 * What verified activity statement accounts show per period and tax type: each
 * statement's "- GST" / "- PAYG Withholding" sub-lines (or, for a statement with
 * no sub-lines, nothing: it is not split by tax type), and "PAYG Withholding
 * (STP Reported)" rows. Every statement of the period counts (original,
 * amendments, ATO audit), net, as the ATO's notice states the period's amount.
 */
export function noticeAccountFrom(accounts: readonly { file: IcaFile; reconciliation: Reconciliation }[]): NoticeAccount {
  const byPeriod = new Map<string, AccountPeriodAmount>()
  const add = (period: string, type: DpnType, cents: number, row: string) => {
    const key = `${period}|${type}`
    const e = byPeriod.get(key) ?? { cents: 0, rows: [] }
    e.cents += cents
    e.rows.push(row)
    byPeriod.set(key, e)
  }
  for (const { file, reconciliation } of accounts) {
    for (const g of reconciliation.groups) {
      const head = file.rows[g.head]
      const end = extractPeriodEnding(head.description)
      if (!end) continue
      if (/^PAYG Withholding \(STP Reported\)/i.test(head.description)) {
        add(iso(end), 'paygw', head.debit - head.credit, `${head.rawProcessed} ${head.description} ${head.rawDebit || head.rawCredit}`)
        continue
      }
      if (!/activity statement/i.test(head.description) || /penalty/i.test(head.description)) continue
      for (const p of g.parts) {
        const sub = file.rows[p]
        const line = sub.description.replace(/^- /, '').trim().toLowerCase()
        const type: DpnType | null = line === 'gst' ? 'gst' : line === 'payg withholding' ? 'paygw' : null
        if (type) add(iso(end), type, sub.debit - sub.credit, `${head.rawProcessed} ${head.description}: ${sub.description} ${sub.rawDebit || sub.rawCredit}`)
      }
    }
  }
  return { byPeriod, labels: accounts.map((a) => a.file.label).filter(Boolean) }
}

export interface NoticeProof {
  /** Column 3 = 4 + 5 on every row, totals = the rows' sums, type, date and ACN read. */
  addsUp: boolean
  rowsNotAddingUp: { periodFrom: string; periodTo: string; column3: number; column4: number; column5: number }[]
  totalsMatchRows: boolean
  fieldsMissing: string[]
  /** The cross-check with the verified ATO account; null with none on file (or an SGC notice). */
  account: {
    periods: number
    matched: number
    outside: { periodFrom: string; periodTo: string }[]
    mismatches: { periodFrom: string; periodTo: string; notice: number; account: number; accountRows: string[] }[]
  } | null
  status: 'verified' | 'unverified'
  /** "Notice adds up", "Matches the ATO account". */
  badges: string[]
  /** "Matches the ATO account for 9 of 11 periods; 2 periods are outside the ATO export (…)". */
  note: string | null
}

const day = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number)
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`
}

export function proveNotice(
  notice: { type: DpnType | null; issuedOn: string | null; acn: string | null; rows: readonly DpnRow[]; totals: DpnAmounts | null },
  account: NoticeAccount | null,
): NoticeProof {
  const rowsNotAddingUp = notice.rows
    .filter((r) => r.column3 !== r.column4 + r.column5)
    .map((r) => ({ periodFrom: r.periodFrom, periodTo: r.periodTo, column3: r.column3, column4: r.column4, column5: r.column5 }))
  const sums = notice.rows.reduce(
    (t, r) => ({ column2: t.column2 + r.column2, column3: t.column3 + r.column3, column4: t.column4 + r.column4, column5: t.column5 + r.column5 }),
    { column2: 0, column3: 0, column4: 0, column5: 0 },
  )
  // The notice prints no total row: the totals are the rows' sums. Stored totals must be exactly those sums.
  const totalsMatchRows = !notice.totals || (['column2', 'column3', 'column4', 'column5'] as const).every((c) => notice.totals![c] === sums[c])
  const fieldsMissing = [!notice.type && 'type', !notice.issuedOn && 'issue date', !notice.acn && 'ACN', notice.rows.length === 0 && 'rows'].filter(
    (f): f is string => !!f,
  )
  const addsUp = rowsNotAddingUp.length === 0 && totalsMatchRows && fieldsMissing.length === 0

  let cross: NoticeProof['account'] = null
  if (account && notice.type && notice.type !== 'sgc') {
    const outside: { periodFrom: string; periodTo: string }[] = []
    const mismatches: NonNullable<NoticeProof['account']>['mismatches'] = []
    let matched = 0
    for (const r of notice.rows) {
      const e = account.byPeriod.get(`${r.periodTo}|${notice.type}`)
      if (!e) outside.push({ periodFrom: r.periodFrom, periodTo: r.periodTo })
      else if (e.cents === r.column2) matched++
      else mismatches.push({ periodFrom: r.periodFrom, periodTo: r.periodTo, notice: r.column2, account: e.cents, accountRows: e.rows })
    }
    cross = { periods: notice.rows.length, matched, outside, mismatches }
  }

  const status = addsUp && (!cross || cross.mismatches.length === 0) ? 'verified' : 'unverified'
  const badges: string[] = []
  if (addsUp) badges.push('Notice adds up')
  if (addsUp && cross && cross.mismatches.length === 0 && cross.outside.length === 0) badges.push('Matches the ATO account')
  let note: string | null = null
  if (cross && cross.mismatches.length === 0 && cross.outside.length > 0) {
    note = `Matches the ATO account for ${cross.matched} of ${cross.periods} periods; ${cross.outside.length} period${cross.outside.length === 1 ? ' is' : 's are'} outside the ATO export (${cross.outside
      .map((o) => `${day(o.periodFrom)} – ${day(o.periodTo)}`)
      .join(', ')})`
  }
  return { addsUp, rowsNotAddingUp, totalsMatchRows, fieldsMissing, account: cross, status, badges, note }
}
