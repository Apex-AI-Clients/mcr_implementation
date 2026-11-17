import type { IcaRow } from './types'

/**
 * Patterns learned from a Claude proposal that reconciled to the cent
 * (propose.ts). A pattern says, for rows of one wording, printed with or
 * without a balance, whether they count. It is never applied blindly: the
 * engine tries it only in a window the known rules could not match, and keeps
 * it only if the ATO's balance then matches to the cent (reconcile.ts).
 *
 * A pattern holds wording only: dates and numbers are masked, so no amount,
 * date or identifier is ever stored in it.
 */
export interface LearnedPattern {
  /** wordingKey(): lower case, dates and numbers masked. */
  wording: string
  printed: 'with_balance' | 'without_balance'
  count: boolean
  /** Claude's explanation of the structure, kept for staff. */
  explanation: string
}

/** A description's wording with dates and numbers masked, for matching. */
export function wordingKey(description: string): string {
  return description
    .replace(/^'/, '')
    .trim()
    .toLowerCase()
    .replace(/\b\d{1,2}[ \-/](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[ \-/]\d{2,4}\b/g, '<date>')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
}

export const printedOf = (r: Pick<IcaRow, 'balance'>): LearnedPattern['printed'] => (r.balance === null ? 'without_balance' : 'with_balance')

/** The rows a set of patterns decides, as forced count/skip flags. */
export function applyPatterns(rows: readonly IcaRow[], patterns: readonly LearnedPattern[]): Map<number, boolean> {
  const forced = new Map<number, boolean>()
  if (patterns.length === 0) return forced
  const index = new Map(patterns.map((p) => [`${p.printed}|${p.wording}`, p.count]))
  for (const r of rows) {
    const decided = index.get(`${printedOf(r)}|${wordingKey(r.description)}`)
    if (decided !== undefined) forced.set(r.id, decided)
  }
  return forced
}
