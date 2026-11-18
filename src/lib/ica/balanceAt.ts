import type { Reconciliation } from './reconcile'
import { audBalance, type Cents, type IcaFile, type IcaRow } from './types'
import { formatBadgeDate } from './view'

/**
 * "ATO related debt – ICA" on the financial statements comparison (Gabby, 16 Nov 2026): for each
 * year's column, the ATO's own running balance at that column's period end, from the activity
 * statement account(s) verified against it (src/lib/ica). Pure.
 *
 * Only a balance the reconciliation proved is used: the closing balance of the last balance day
 * on or before the date (each matched window proves its last day's closing balance). After the
 * export's newest balance day, the ATO's balance on that day. None for a date before the export
 * starts, or inside a window of several days (only its last day's balance is proven). With several
 * activity statement accounts, their balances added up, each named.
 */

export interface VerifiedAccount {
  label: string
  documentId: string
  filename: string
  file: IcaFile
  reconciliation: Reconciliation
}

export interface AccountBalance {
  label: string
  documentId: string
  filename: string
  cents: Cents
  /** The balance day it is the closing balance of. */
  day: string
  /** The row the ATO printed that balance on, exactly as printed. */
  row: Pick<IcaRow, 'rawProcessed' | 'description' | 'rawBalance'> | null
}

export type BalanceAt = { kind: 'balance'; balance: AccountBalance } | { kind: 'none'; reason: string }

export function balanceAt(account: VerifiedAccount, date: string): BalanceAt {
  const rec = account.reconciliation
  if (rec.atoBalance === null || !rec.atoBalanceDate) return { kind: 'none', reason: `${account.label}: no balance printed` }
  const at = (cents: Cents, day: string): BalanceAt => {
    const row = account.file.rows.find((r) => r.processed === day && r.balance === cents) ?? null
    return {
      kind: 'balance',
      balance: { label: account.label, documentId: account.documentId, filename: account.filename, cents, day, row: row && { rawProcessed: row.rawProcessed, description: row.description, rawBalance: row.rawBalance } },
    }
  }
  if (date >= rec.atoBalanceDate) return at(rec.atoBalance, rec.atoBalanceDate)
  const windows = [...rec.matched].filter((w) => w.days.length > 0).sort((a, b) => a.days[a.days.length - 1].localeCompare(b.days[b.days.length - 1]))
  if (windows.some((w) => w.days[0] <= date && date < w.days[w.days.length - 1])) {
    return { kind: 'none', reason: `${account.label}: the ATO's balance on ${formatBadgeDate(date)} is inside a run of days proven only together` }
  }
  // Proven closing balances: each window's last day, and the day it starts after (its opening, the
  // closing balance the window was matched from: the export's first balance day for the first window).
  const points = windows.flatMap((w) => [...(w.after ? [{ day: w.after, cents: w.from }] : []), { day: w.days[w.days.length - 1], cents: w.to }])
  const last = points.filter((p) => p.day <= date).sort((a, b) => a.day.localeCompare(b.day)).pop()
  if (!last) return { kind: 'none', reason: `${account.label}: the ATO export starts after ${formatBadgeDate(date)}` }
  return at(last.cents, last.day)
}

export interface IcaHeadlineCell {
  /** Dollars (DR positive, CR negative), the accounts added up. */
  value: number
  date: string
  balances: AccountBalance[]
}

/** Each column's ATO balance at its period end: the accounts added up, or null with why. */
export function icaHeadline(accounts: VerifiedAccount[], periodEnds: string[]): ({ cell: IcaHeadlineCell } | { none: string })[] {
  return periodEnds.map((date) => {
    const each = accounts.map((a) => balanceAt(a, date))
    const missing = each.find((b): b is { kind: 'none'; reason: string } => b.kind === 'none')
    if (missing) return { none: missing.reason }
    const balances = each.map((b) => (b as { kind: 'balance'; balance: AccountBalance }).balance)
    return { cell: { value: balances.reduce((s, b) => s + b.cents, 0) / 100, date, balances } }
  })
}

/** "$12,345.67 DR on 30 Jun 2025 — Activity statement 001 (ica.csv), the row “…” printed …". */
export function balanceLine(b: AccountBalance): string {
  const row = b.row ? `, the row “${b.row.description}” processed ${b.row.rawProcessed}, balance printed ${b.row.rawBalance}` : ''
  return `${b.label} (${b.filename}): ${audBalance(b.cents)} at the end of ${formatBadgeDate(b.day)}${row}`
}
