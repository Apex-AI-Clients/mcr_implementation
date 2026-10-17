import { isValidAcn } from '@/lib/asic/identifiers'
import type { DirectorPenaltyNotice, DpnRow } from './types'

/**
 * Checks on a parsed notice, against itself and against what the client's
 * file says. Every one is a warning for staff to look at, never a refusal:
 * the notice is the ATO's document, and it stands as issued.
 */

/** One cent either way: the notice prints to the cent. */
const TOLERANCE_CENTS = 1

/** The notice's own wording: act "within 21 days after the date of this notice". */
export const DPN_RESPONSE_DAYS = 21

export type DpnCheck =
  /** Column 3 is not Column 4 + Column 5 on this row. */
  | { code: 'row_does_not_add_up'; rowIndex: number; periodFrom: string; periodTo: string }
  /** The ACN on the notice fails its check digit: probably misread. */
  | { code: 'acn_invalid' }
  /** The client's company details have no ACN to compare with. */
  | { code: 'acn_not_on_file' }
  /** The notice is for a different ACN from the client's company. */
  | { code: 'acn_mismatch' }
  /** The client's company details list no directors to compare with. */
  | { code: 'no_directors_on_file' }
  /** The director named on the notice is not among the client's directors. */
  | { code: 'director_not_on_file' }

export interface ClientFileForDpn {
  acn: string | null
  directors: readonly { name: string }[]
}

export function rowAddsUp(row: Pick<DpnRow, 'column3' | 'column4' | 'column5'>): boolean {
  return Math.abs(row.column3 - (row.column4 + row.column5)) <= TOLERANCE_CENTS
}

const TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'MX', 'DR', 'PROF', 'SIR', 'DAME'])

function nameTokens(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^A-Z\s'-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^['-]+|['-]+$/g, ''))
    .filter((token) => token && !TITLES.has(token))
}

/**
 * Whether two spellings name the same person: "MR JANE Q SAMPLE" and
 * "Jane Quinn Sample", or "J SAMPLE". Surnames must agree; first names must
 * agree, or one must be the other's initial. Middle names are ignored — the
 * ATO and ASIC print them differently.
 */
export function directorNameMatches(a: string, b: string): boolean {
  const left = nameTokens(a)
  const right = nameTokens(b)
  if (left.length === 0 || right.length === 0) return false
  if (left[left.length - 1] !== right[right.length - 1]) return false
  if (left.length === 1 || right.length === 1) return true
  const [first, other] = [left[0], right[0]]
  if (first === other) return true
  return (first.length === 1 && other.startsWith(first)) || (other.length === 1 && first.startsWith(other))
}

export function checkDirectorPenaltyNotice(
  notice: Pick<DirectorPenaltyNotice, 'acn' | 'directorName' | 'rows'>,
  file: ClientFileForDpn,
): DpnCheck[] {
  const checks: DpnCheck[] = []

  notice.rows.forEach((row, rowIndex) => {
    if (!rowAddsUp(row)) {
      checks.push({
        code: 'row_does_not_add_up',
        rowIndex,
        periodFrom: row.periodFrom,
        periodTo: row.periodTo,
      })
    }
  })

  if (!isValidAcn(notice.acn)) checks.push({ code: 'acn_invalid' })
  const fileAcn = file.acn?.replace(/\D/g, '') || null
  if (!fileAcn) checks.push({ code: 'acn_not_on_file' })
  else if (fileAcn !== notice.acn) checks.push({ code: 'acn_mismatch' })

  if (file.directors.length === 0) checks.push({ code: 'no_directors_on_file' })
  else if (!file.directors.some((d) => directorNameMatches(d.name, notice.directorName))) {
    checks.push({ code: 'director_not_on_file' })
  }

  return checks
}

/** The last day to act: the date of issue + 21 days, as an ISO date. */
export function dpnDeadline(issuedOn: string): string {
  const date = new Date(`${issuedOn}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + DPN_RESPONSE_DAYS)
  return date.toISOString().slice(0, 10)
}

/**
 * Whole days from `today` to `deadline`, both ISO dates. 0 on the day itself,
 * negative once it has passed. `today` is the caller's: the page decides it in
 * Sydney time, so a notice does not tick over at UTC midnight.
 */
export function daysUntil(deadline: string, today: string): number {
  const ms = Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}
