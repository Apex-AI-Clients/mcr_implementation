import { candidateAbnsForAcn, digitsOnly, formatAbn, isValidAcn } from '@/lib/asic/identifiers'
import { lookupAbn, type AbrDetailsResult } from './browser'

/**
 * "Does the company with this ACN have an ABN of its own?" — asked of the
 * register for free, without a new endpoint.
 *
 * A company's ABN is two check digits plus its ACN, so the candidates are
 * worked out here (candidateAbnsForAcn: one, occasionally two) and each is
 * checked with the existing ABN details lookup. A candidate only counts when
 * the register's record for it carries this same ACN.
 *
 * Three honest answers, and a fourth for when the register could not be asked:
 *
 *   found      an ABN for this ACN that is not cancelled — offer it
 *   cancelled  the only ABN for this ACN was cancelled. Not the same as "none":
 *              cancelled ABNs are everyday in insolvency work, so staff decide
 *   none       the register has no ABN for this ACN — normal for a company that
 *              only acts as trustee
 *   unavailable  a lookup failed and nothing was found; say nothing definite
 *
 * Never run in "Enter manually" mode, and only once per ACN (acnToLookUp).
 */

export type AcnAbnOutcome =
  | { kind: 'found'; abn: string }
  | { kind: 'cancelled'; abn: string; cancelledOn: string }
  | { kind: 'none' }
  | { kind: 'unavailable'; message: string }

export interface CandidateLookup {
  abn: string
  result: AbrDetailsResult
}

/**
 * The ACN to check now, or null.
 *
 * Only with the company's manual mode off, a valid ACN, an empty company ABN,
 * and an ACN this form has not already asked about.
 */
export function acnToLookUp(
  state: { companyManual: boolean; acnNumber: string; abnNumber: string },
  alreadyChecked: ReadonlySet<string>,
): string | null {
  if (state.companyManual) return null
  if (state.abnNumber.trim()) return null
  const acn = digitsOnly(state.acnNumber)
  if (!isValidAcn(acn) || alreadyChecked.has(acn)) return null
  return acn
}

/** The lookups' answers -> one outcome. Pure. */
export function interpretAcnLookups(acn: string, lookups: CandidateLookup[]): AcnAbnOutcome {
  const wanted = digitsOnly(acn)
  const matching = lookups.flatMap(({ result }) =>
    result.kind === 'ok' && digitsOnly(result.details.acn) === wanted ? [result.details] : [],
  )

  // Anything not positively cancelled is offered — an unrecognised status is
  // not a reason to claim the ABN is dead.
  const live = matching.find((details) => details.status !== 'cancelled')
  if (live) return { kind: 'found', abn: digitsOnly(live.abn) }

  const cancelled = matching[0]
  if (cancelled) {
    return {
      kind: 'cancelled',
      abn: digitsOnly(cancelled.abn),
      cancelledOn: cancelled.abnStatusEffectiveFrom,
    }
  }

  const failure = lookups.find(
    ({ result }) => result.kind === 'failed' && !result.notFound,
  )?.result
  if (failure && failure.kind === 'failed') return { kind: 'unavailable', message: failure.message }

  return { kind: 'none' }
}

/** Ask the register. `lookup` is the seam for tests. */
export async function lookupAbnForAcn(
  acn: string,
  lookup: (abn: string) => Promise<AbrDetailsResult> = lookupAbn,
): Promise<AcnAbnOutcome> {
  const candidates = candidateAbnsForAcn(acn)
  const lookups = await Promise.all(
    candidates.map(async (abn) => ({ abn, result: await lookup(abn) })),
  )
  return interpretAcnLookups(acn, lookups)
}

/** "2024-03-11" -> "11 March 2024". The raw value when it is not a date. */
function formatRegisterDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return iso
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/** The line shown under the company ABN. Empty when there is nothing to say. */
export function describeAcnAbnOutcome(outcome: AcnAbnOutcome): string {
  switch (outcome.kind) {
    case 'found':
      return `Use ABN ${formatAbn(outcome.abn)}`
    case 'cancelled':
      return outcome.cancelledOn
        ? `ABN ${formatAbn(outcome.abn)} was cancelled on ${formatRegisterDate(outcome.cancelledOn)}`
        : `ABN ${formatAbn(outcome.abn)} was cancelled`
    case 'none':
      return 'No ABN registered for this ACN (normal for trustee companies)'
    case 'unavailable':
      return ''
  }
}
