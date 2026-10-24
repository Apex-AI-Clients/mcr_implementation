import type { FinancialCheck, FinancialCheckKind } from './types'

/**
 * Hard checks: a statement's own arithmetic (totals, the balance-sheet
 * equation, the profit identities) and the retained-earnings roll-forward.
 * When one fails, the comparison shows "Needs review" and its PDF and CSV stay
 * locked until a staff member ticks that they checked the figures against the
 * source documents, in every deployment. The exports then carry "Reviewed by
 * X on <date>". Pure; shared by the page, the tick route and the tests.
 *
 * The tick is stored in sbr_readiness_reviews (item 'financials', migration
 * 0030) with the fingerprint below: it covers exactly the comparison and the
 * failures that were there when it was ticked. A rebuilt comparison, or a
 * different failure, needs a new tick.
 */

const HARD_KINDS = new Set<FinancialCheckKind>(['totals_reconciliation', 'balance_sheet_equation', 'retained_earnings_rollforward'])

export function hardCheckFailures(checks: FinancialCheck[] | undefined): FinancialCheck[] {
  return (checks ?? []).filter((c) => c.severity === 'warning' && HARD_KINDS.has(c.kind))
}

/** The comparison build and its failures, as one string. Null when nothing failed. */
export function hardChecksFingerprint(generatedAt: string | null, failures: FinancialCheck[]): string | null {
  if (failures.length === 0) return null
  const lines = failures.map((c) => `${c.kind}|${c.financialYear ?? ''}|${c.currentPeriod ? 'cp' : ''}|${c.message}`).sort()
  // The database and the job write the same instant differently ("+00:00" / "Z").
  const built = generatedAt && !Number.isNaN(Date.parse(generatedAt)) ? new Date(generatedAt).toISOString() : 'unbuilt'
  return `${built}#${hash(lines.join('\n'))}`
}

/** FNV-1a, hex: short and the same on the server and in the browser. */
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export interface FiguresChecked {
  fingerprint: string
  by: string
  at: string
}

/** The exports are locked while a hard check fails and no tick covers it. */
export function exportsLocked(failures: FinancialCheck[], generatedAt: string | null, checked: FiguresChecked | null): boolean {
  const fingerprint = hardChecksFingerprint(generatedAt, failures)
  return fingerprint !== null && checked?.fingerprint !== fingerprint
}

/** "Reviewed by X on 24/10/2026" when a tick covers the failures shown now; else null. */
export function reviewLine(failures: FinancialCheck[], generatedAt: string | null, checked: FiguresChecked | null): string | null {
  const fingerprint = hardChecksFingerprint(generatedAt, failures)
  if (fingerprint === null || checked?.fingerprint !== fingerprint) return null
  const date = new Intl.DateTimeFormat('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Australia/Sydney' }).format(new Date(checked.at))
  return `Reviewed by ${checked.by} on ${date}`
}
