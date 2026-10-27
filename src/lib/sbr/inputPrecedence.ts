/**
 * Saved prediction inputs against fresh evidence.
 *
 * A prediction saves the inputs it ran with, and the page used to start from
 * them. That let a value saved before the evidence existed outlive it: a
 * director loan saved as No before the loan lines were mapped stayed No after
 * the balance sheet showed $427,550 owed to the company.
 *
 * The rule here: fresh evidence wins over a saved value, with a note saying
 * what changed. A saved value only wins when staff set it after the evidence
 * was last read or confirmed (or the evidence has not changed since), or when
 * there is no evidence to compare with.
 *
 * Which inputs this covers:
 *   - Director loan at appointment: the loan lines confirmed on the balance
 *     sheet (printed/mapping.ts). Changed here.
 *   - ATO debt: the ATO account statement, else the balance sheet
 *     (creditorDebt.ts). A figure staff typed used to win for ever. Changed here.
 *   - DPN: notices on file already win (readiness.ts; the predict route
 *     ignores staff's tick then). Only the note and the stale check are new.
 *   - Days late, late lodgements, days since last payment, loan receivable
 *     amount: never taken from the saved prediction; always read afresh. A
 *     saved prediction that used other figures is marked stale.
 *
 * Pure: the page and the predict route both use it.
 */
import { longDate } from './creditorDebt'
import type { SavedCreditors } from './creditors'

const AUD = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`
const at = (iso: string | null) => (iso ? ` at ${longDate(iso)}` : '')

/** The newest of some timestamps, or null when there are none. */
export function latest(...times: (string | null | undefined)[]): string | null {
  let best: string | null = null
  for (const t of times) {
    if (t && (best === null || Date.parse(t) > Date.parse(best))) best = t
  }
  return best
}

const notBefore = (a: string, b: string) => Date.parse(a) >= Date.parse(b)

// ─── Director loan at appointment ─────────────────────────────────────────────

/** What the balance sheet says about a loan owed to the company. */
export interface LoanEvidence {
  /** True: an amount above 0. False: confirmed 0 or none printed. Null: the loan lines are not identified. */
  detected: boolean | null
  /** The receivable amount the prediction uses; 0 when not identified. */
  amount: number
  /** The balance sheet's date (ISO), when there is one. */
  asOf: string | null
  /** The printed lines it comes from. */
  lines: string[]
  /** When the evidence last changed: the loan lines confirmed, or the statements read. */
  changedAt: string | null
}

/**
 * Staff changing "Director loan at appointment" away from what the amount
 * says (> 0 is Yes). Recorded with who and when, stored with the prediction
 * (sbr_outcome_predictions.input_overrides); no reason is asked and nothing
 * is blocked. Overrides saved before carried a reason, kept as it was.
 */
export interface DirectorLoanOverride {
  value: boolean
  /** Who changed it; null on an override saved before this was recorded. */
  setBy: string | null
  /** When they changed it. */
  setAt: string
  /** The receivable amount it was changed against. */
  amount: number
  reason?: string
}

export function readDirectorLoanOverride(value: unknown): DirectorLoanOverride | null {
  if (!value || typeof value !== 'object') return null
  const o = (value as Record<string, unknown>).directorLoanAtAppointment
  if (!o || typeof o !== 'object') return null
  const r = o as Record<string, unknown>
  if (typeof r.value !== 'boolean' || typeof r.setAt !== 'string') return null
  return {
    value: r.value,
    setBy: typeof r.setBy === 'string' ? r.setBy : null,
    setAt: r.setAt,
    amount: typeof r.amount === 'number' ? r.amount : 0,
    ...(typeof r.reason === 'string' ? { reason: r.reason } : {}),
  }
}

/** "Director loan at appointment (from the balance sheet at 30 Jun 2025)". */
export function directorLoanLabel(base: string, asOf: string | null): string {
  return asOf ? `${base} (from the balance sheet at ${longDate(asOf)})` : base
}

/** What the tick is when nobody has changed it: Yes when anything is owed to the company. */
export const directorLoanFromAmount = (amount: number) => amount > 0

/** "Changed by Jane Staff on 26 Oct 2026". */
export function changedNote(o: Pick<DirectorLoanOverride, 'setBy' | 'setAt'>): string {
  return `Changed by ${o.setBy ?? 'staff'} on ${longDate(o.setAt)}`
}

export interface ResolvedDirectorLoan {
  value: boolean
  /** What changed from the saved value, and why. Null when nothing did. */
  note: string | null
  /** The staff change, when it still stands (shown as "Changed by … on …"). */
  override: DirectorLoanOverride | null
}

/**
 * The value the page starts from. `saved` is what the last prediction ran
 * with (null: no prediction); `override` the staff change, if any.
 */
export function resolveDirectorLoan(
  saved: boolean | null,
  override: DirectorLoanOverride | null,
  evidence: LoanEvidence,
): ResolvedDirectorLoan {
  const standing = override && override.value === saved ? override : null

  // Nothing on the balance sheet to compare with: staff's answer stands.
  if (evidence.detected === null) return { value: saved ?? false, note: null, override: standing }
  if (saved === null || saved === evidence.detected) {
    return { value: evidence.detected, note: null, override: null }
  }

  // They disagree. A change staff made after the evidence last changed — or
  // against the same amount — still stands.
  if (
    standing &&
    (standing.amount === evidence.amount || evidence.changedAt === null || notBefore(standing.setAt, evidence.changedAt))
  ) {
    return { value: saved, note: null, override: standing }
  }

  const note = evidence.detected
    ? `Ticked Yes: the balance sheet${at(evidence.asOf)} shows ${evidence.lines.map((l) => `“${l}”`).join(' + ') || 'a loan'} ${AUD(evidence.amount)} owed to the company (last prediction said No).`
    : `Unticked: the balance sheet${at(evidence.asOf)} shows no loan owed to the company (last prediction said Yes).`
  return { value: evidence.detected, note, override: null }
}

/**
 * The staff change to store with a prediction: only when the tick differs from
 * what the amount says. The same change sent again keeps its original time
 * and author, so a re-run does not make an old change look new.
 */
export function recordDirectorLoanChange(input: {
  value: boolean
  amount: number
  stored: DirectorLoanOverride | null
  by: string | null
  now: string
}): DirectorLoanOverride | null {
  if (input.value === directorLoanFromAmount(input.amount)) return null
  if (input.stored && input.stored.value === input.value) return input.stored
  return { value: input.value, setBy: input.by, setAt: input.now, amount: input.amount }
}

// ─── ATO debt ─────────────────────────────────────────────────────────────────

/** The automatic ATO debt, and when its evidence last changed. */
export interface AtoEvidence {
  amount: number | null
  /** "ATO account statement, 26 Sep 2026" and the like. */
  description: string
  /** The lodgement analysis, or the mapping / statements read, whichever it came from. */
  changedAt: string | null
}

/**
 * A staff-typed ATO debt saved with the last prediction: whether it still
 * stands. It does when staff typed it after the evidence last changed, or the
 * automatic figure is the one they typed over. Saved before the time was
 * recorded, the prediction's own time stands in for it.
 */
export function resolveAtoDebt(
  saved: SavedCreditors | null,
  savedComputedAt: string | null,
  evidence: AtoEvidence,
): { staffAmount: number | null; note: string | null } {
  if (!saved?.atoDebtEdited || saved.atoDebt == null) return { staffAmount: null, note: null }
  const staffAmount = saved.atoDebt
  if (evidence.amount === null) return { staffAmount, note: null }

  const editedAt = saved.atoDebtEditedAt ?? savedComputedAt
  const sameEvidence = saved.atoDebtAuto != null && Math.round(saved.atoDebtAuto) === Math.round(evidence.amount)
  if (sameEvidence || evidence.changedAt === null || (editedAt !== null && notBefore(editedAt, evidence.changedAt))) {
    return { staffAmount, note: null }
  }
  return {
    staffAmount: null,
    note: `Updated to ${AUD(evidence.amount)} from the ${evidence.description} (last prediction used ${AUD(staffAmount)}, entered by staff before it). Re-enter it if it is still right.`,
  }
}

// ─── DPN ──────────────────────────────────────────────────────────────────────

/** A note when the notices on file give a different answer from the last prediction. */
export function dpnNote(saved: boolean | null, fromFile: boolean | null): string | null {
  if (saved === null || fromFile === null || saved === fromFile) return null
  return fromFile
    ? 'Yes: a notice is on file (last prediction said No).'
    : 'No: "none issued" is ticked on the client page (last prediction said Yes).'
}

// ─── A saved prediction whose inputs no longer match ──────────────────────────

export interface CurrentInputs {
  directorLoanAtAppointment: boolean
  directorLoanReceivableAmount: number
  dpn: boolean | null
  cumulativeDaysLate: number | null
  numberOfLateLodgements: number | null
  daysSinceLastPayment: number | null
  /** The ATO debt the page now starts from; undefined when not compared. */
  atoDebt?: number | null
}

/**
 * Which saved inputs the current evidence contradicts, as labels. Empty: the
 * saved prediction still matches. Keys the saved prediction does not carry
 * (older versions) are not compared.
 */
export function inputsChanged(
  saved: Record<string, unknown>,
  savedAtoDebt: number | null | undefined,
  current: CurrentInputs,
): string[] {
  const changed: string[] = []
  const differs = (key: string, now: number | boolean | null) =>
    now !== null && key in saved && (typeof now === 'number' ? Math.round(Number(saved[key])) !== Math.round(now) : saved[key] !== now)

  if (differs('directorLoanAtAppointment', current.directorLoanAtAppointment)) changed.push('Director loan at appointment')
  if (differs('directorLoanReceivableAmount', current.directorLoanReceivableAmount)) changed.push('Director loan receivable amount')
  if (differs('dpn', current.dpn)) changed.push('Director Penalty Notice')
  if (differs('cumulativeDaysLate', current.cumulativeDaysLate)) changed.push('Cumulative days late')
  if (differs('numberOfLateLodgements', current.numberOfLateLodgements)) changed.push('Number of late lodgements')
  if (differs('daysSinceLastPayment', current.daysSinceLastPayment)) changed.push('Days since last payment')
  if (
    current.atoDebt !== undefined &&
    current.atoDebt !== null &&
    savedAtoDebt != null &&
    Math.round(savedAtoDebt) !== Math.round(current.atoDebt)
  ) {
    changed.push('ATO debt')
  }
  return changed
}
