import { analyseIca } from './index'
import { searchHelpers } from './compose'
import { readStoredRows } from './read'
import { audBalance, type Cents } from './types'
import { forcedFrom, type IcaStatus } from './status'
import { dateText } from '@/lib/dates'

/**
 * What the pages show of an ATO account file, from its stored rows and stored
 * check (migration 0058). Serialisable (server → client). Amounts in dollars.
 *
 * VERIFIED: the badge, the composition in the ATO's words, the statements
 * lodged more than 90 days late.
 * Anything else (not verified, not checked yet, or no rows): no calculated
 * figure at all — the rows exactly as printed, and "Totals being prepared".
 * Late lodgements (dates only) are given whenever every date reads.
 */

export { TOTALS_HELD_BACK } from './status'

export interface AsPrintedRow {
  id: number
  processed: string
  effective: string
  description: string
  debit: string
  credit: string
  balance: string
}

export interface CompositionLineView {
  key: string
  label: string
  section: string
  /** True when we named the line from known ATO wording; false when the label is the ATO's description. */
  named: boolean
  net: number
  debit: number
  credit: number
  rows: number
  /** What to search the spreadsheet for. */
  search: string[]
  /** The rows of the line, by position (they are in asPrinted). */
  rowIds: number[]
}

export interface IcaView {
  status: IcaStatus | 'not_checked'
  verified: boolean
  /** "Matches the ATO's own balance: $453,278.19 DR at 2 Nov 2026" (verified only). */
  badge: string | null
  balance: number | null
  balanceDate: string | null
  composition: {
    opening: number
    lines: CompositionLineView[]
    atoDebt: number
    total: number
    notCounted: number
  } | null
  lodgedOver90: { statements: number; debit: number; byLine: { label: string; debit: number }[] } | null
  lateLodgements: { count: number; cumulativeDays: number } | null
  /** The RBA ICA spreadsheet comparison, when one is on file: shown only when it matches (otherwise the file is not verified). */
  spreadsheet: { lateLodgements: number; cumulativeDaysLate: number } | null
  asPrinted: AsPrintedRow[]
}

const dollars = (c: Cents) => c / 100


/** "2 Nov 2026", as the ATO writes dates (not the locale's "Sept"). */
export function formatBadgeDate(iso: string): string {
  return dateText(iso)
}

export function badgeText(balanceCents: Cents, date: string): string {
  return `Matches the ATO's own balance: ${audBalance(balanceCents)} at ${formatBadgeDate(date)}`
}

/** The view of a stored analysis row (lodgement_analyses or ato_account_analyses). */
export function icaViewOf(stored: {
  rows: unknown
  label?: string | null
  ica_status?: string | null
  ica_forced?: unknown
  ica_check?: unknown
}): IcaView {
  const file = readStoredRows(stored.rows, { label: stored.label ?? 'Activity statement' })
  const asPrinted: AsPrintedRow[] = (file?.rows ?? []).map((r) => ({
    id: r.id,
    processed: r.rawProcessed,
    effective: r.rawEffective,
    description: r.description,
    debit: r.rawDebit,
    credit: r.rawCredit,
    balance: r.rawBalance,
  }))
  const status = (['verified', 'unverified', 'empty'] as const).find((s) => s === stored.ica_status) ?? 'not_checked'
  const held: IcaView = {
    status,
    verified: false,
    badge: null,
    balance: null,
    balanceDate: null,
    composition: null,
    lodgedOver90: null,
    lateLodgements: null,
    spreadsheet: null,
    asPrinted,
  }
  if (!file) return held

  const a = analyseIca(file, { forced: forcedFrom(stored.ica_forced) })
  const late = a.lateLodgements.count === null ? null : { count: a.lateLodgements.count, cumulativeDays: a.lateLodgements.cumulativeDays ?? 0 }
  // Shown only when the stored check says verified AND reading the stored rows again verifies too.
  if (status !== 'verified' || !a.verified || !a.composition || a.reconciliation.atoBalance === null || !a.reconciliation.atoBalanceDate) {
    return { ...held, lateLodgements: late }
  }

  const c = a.composition
  const over = a.lodgedOver90DaysLate ?? []
  const byLine = new Map<string, number>()
  for (const s of over) for (const x of s.amounts) byLine.set(x.label, (byLine.get(x.label) ?? 0) + x.debit)
  const check = stored.ica_check as { spreadsheet?: { lateLodgements: number; cumulativeDaysLate: number; matches: boolean } | null } | null
  return {
    status,
    verified: true,
    badge: badgeText(a.reconciliation.atoBalance, a.reconciliation.atoBalanceDate),
    balance: dollars(a.reconciliation.atoBalance),
    balanceDate: a.reconciliation.atoBalanceDate,
    composition: {
      opening: dollars(c.opening),
      lines: c.lines.map((l) => ({
        key: l.key,
        label: l.label,
        section: l.section,
        named: l.named,
        net: dollars(l.net),
        debit: dollars(l.debit),
        credit: dollars(l.credit),
        rows: l.parts.length,
        search: searchHelpers(l),
        rowIds: l.parts.map((p) => p.rowId),
      })),
      atoDebt: dollars(c.atoDebt),
      total: dollars(c.total),
      notCounted: c.notCounted.length,
    },
    lodgedOver90: {
      statements: over.length,
      debit: dollars(over.reduce((s, x) => s + x.debit, 0)),
      byLine: [...byLine].map(([label, debit]) => ({ label, debit: dollars(debit) })),
    },
    lateLodgements: late,
    spreadsheet: check?.spreadsheet?.matches ? { lateLodgements: check.spreadsheet.lateLodgements, cumulativeDaysLate: check.spreadsheet.cumulativeDaysLate } : null,
    asPrinted,
  }
}
