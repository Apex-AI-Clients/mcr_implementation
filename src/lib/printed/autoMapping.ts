import type { ComparisonRow, PrintedComparison } from './compare'
import type { MappingEntry } from './mapping'
import { MEANING, SBR_MEANINGS, type Meaning } from './meanings'
import { namesDirector, namesParty, suggestMappingWithRules, type RelatedNames } from './dictionary'
import { PLAUSIBLE } from './picker'

/**
 * Auto-selection on "Confirm key figures" (Gabby's request, 4 Nov 2026).
 * Pure. Every SBR meaning staff have not confirmed is pre-selected, so staff
 * only change what is wrong:
 *
 *   the dictionary matched printed lines   those lines, "Auto-selected"
 *   no line matched, none looks like it    "Not printed", auto-selected
 *   no line matched, but a printed line    nothing selected: each such line is
 *   LOOKS like it (a loan, director,       a "Possible line — Use it?", and the
 *   related, beneficiary, trust, funds     meaning waits for a click
 *   loaned, ATO, tax, BAS, GST or PAYG
 *   label, or one naming the client or a
 *   director)
 *
 * Auto-selections count as confirmed for the prediction (they are in the
 * mapping), are kept with the rule used (`autoRule`), and are worked out
 * again whenever the figures change.
 *
 * Fresh evidence beats a stale answer: a staff "Not printed" given BEFORE the
 * current reader went live (`staleBefore`), where the dictionary now matches
 * lines, is switched to those lines with "Updated after a reading fix (was:
 * …)". A staff answer given since is never changed: when the dictionary
 * matches lines it leaves out, they are shown as possible lines instead.
 *
 * Nothing is auto-selected for a statement no file prints yet.
 */

export const AUTO_BY = 'auto'

export interface PossibleLine {
  rowKey: string
  label: string
  /** The newest printed amount, as printed. */
  value: number | null
  /** The column it is printed in ("FY2025", "current"). */
  column: string | null
  why: string
}

export interface AutoMapping {
  /** Auto entries for meanings staff have not confirmed (confirmedBy 'auto', autoRule set). */
  entries: MappingEntry[]
  possible: Partial<Record<Meaning, PossibleLine[]>>
  /** Staff answers switched after a reading fix: the entries they replace. */
  replaced: MappingEntry[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function day(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

const MAX_OTHER_POSSIBLE = 3
const LOAN_MEANINGS: Meaning[] = ['loan_receivable', 'loan_payable']
const TAX_MEANINGS: Meaning[] = ['ato_debt', 'income_tax_payable']

/** Loan, director, related, beneficiary, trust, funds-loaned labels (the safeguard's words). */
const LOAN_LOOKALIKE =
  /\b(loans?|lent|loaned|advances?|directors?|shareholders?|unitholders?|related|associates?|associated|beneficiar(y|ies)|trust|trustee|funds introduced|drawings|owner|proprietor|div(ision)? ?7a|distributions?|current account)\b/i
const TAX_LOOKALIKE = /\b(ato|tax(ation)?|bas|gst|payg|activity statement|integrated client account|ica)\b/i
/** Finance with interest or a financier on the line is bank finance (cash_loans), not a lookalike. */
const FINANCE_ONLY = /:\s*interest\b|\b(unexpired interest|chattel|hire purchase)\b/i

const pathText = (r: ComparisonRow) => r.path.join(' > ').toLowerCase()
const isLiability = (r: ComparisonRow) => /liabilit/.test(pathText(r)) && !/equity|capital|reserves/.test((r.path[r.path.length - 1] ?? '').toLowerCase())

function latestPrinted(r: ComparisonRow, columns: PrintedComparison['columns']): { value: number | null; column: string | null } {
  for (let i = r.cells.length - 1; i >= 0; i--) {
    const c = r.cells[i]
    if (c.printed && typeof c.value === 'number') return { value: c.value, column: columns[i]?.key ?? null }
  }
  return { value: null, column: null }
}

function lookalikeReason(meaning: Meaning, r: ComparisonRow, names: RelatedNames): string | null {
  const label = r.label
  if (LOAN_MEANINGS.includes(meaning)) {
    if (FINANCE_ONLY.test(label)) return null
    if (namesDirector(label, names.directors ?? []) || namesParty(label, names.parties ?? [])) return 'Names the client, a director, the trust or the trustee company.'
    if (LOAN_LOOKALIKE.test(label)) return 'Reads like a loan, director, related-party, beneficiary or trust account.'
    return null
  }
  if (TAX_MEANINGS.includes(meaning)) {
    if (!isLiability(r)) return null
    return TAX_LOOKALIKE.test(label) ? 'Reads like an ATO, tax, BAS, GST or PAYG account.' : null
  }
  return PLAUSIBLE[meaning](r) ? 'Could be this figure.' : null
}

export function autoMapping(
  comparison: PrintedComparison,
  staff: MappingEntry[],
  names: RelatedNames = {},
  { meanings = SBR_MEANINGS.map((m) => m.key), staleBefore = null }: { meanings?: Meaning[]; staleBefore?: string | null } = {},
): AutoMapping {
  const suggested = suggestMappingWithRules(comparison, names)
  const table = (m: Meaning) => comparison.tables.find((t) => t.kind === MEANING[m].statement)
  // Lines any meaning takes (suggested or confirmed) are spoken for: never a "possible line" elsewhere.
  const taken = new Set<string>([...Object.values(suggested).flatMap((lines) => lines.map((l) => l.rowKey)), ...staff.filter((e) => !e.nonePrinted).map((e) => e.rowKey)])
  const entries: MappingEntry[] = []
  const possible: AutoMapping['possible'] = {}
  const replaced: MappingEntry[] = []

  for (const m of meanings) {
    const rows = (table(m)?.rows ?? []).filter((r) => r.style !== 'heading' && r.style !== 'ratio' && r.cells.some((c) => c.printed && typeof c.value === 'number'))
    const confirmed = staff.filter((e) => e.meaning === m)
    const describe = (r: ComparisonRow, why: string): PossibleLine => ({ rowKey: r.key, label: r.label.trim() || '(line with no label)', ...latestPrinted(r, comparison.columns), why })

    if (confirmed.length > 0) {
      const disagreed = confirmed.every((e) => e.nonePrinted) && suggested[m].length > 0
      const stale = staleBefore !== null && confirmed.every((e) => e.confirmedAt !== '' && Date.parse(e.confirmedAt) < Date.parse(staleBefore))
      // Given under an older reader: switched to the lines matched now, with a note.
      if (disagreed && stale) {
        const was = confirmed[0]
        const note = `Updated after a reading fix (was: Not printed, by ${was.confirmedBy} on ${day(was.confirmedAt)})`
        for (const l of suggested[m]) {
          const r = rows.find((x) => x.key === l.rowKey)
          if (!r) continue
          entries.push({ meaning: m, rowKey: r.key, label: r.label || '(no label)', nonePrinted: false, confirmedBy: AUTO_BY, confirmedAt: '', autoRule: l.rule, updatedNote: note })
        }
        replaced.push(...confirmed)
        continue
      }
      // A staff "Not printed" given since: say so, change nothing.
      if (disagreed) {
        possible[m] = suggested[m].flatMap((l) => {
          const r = rows.find((x) => x.key === l.rowKey)
          return r ? [describe(r, `Confirmed as not printed, but now matched: ${l.rule}`)] : []
        })
      }
      continue
    }
    // No statement of that kind read yet: nothing to select from.
    if (rows.length === 0) continue

    if (suggested[m].length > 0) {
      for (const l of suggested[m]) {
        const r = rows.find((x) => x.key === l.rowKey)
        if (!r) continue
        entries.push({ meaning: m, rowKey: r.key, label: r.label || '(no label)', nonePrinted: false, confirmedBy: AUTO_BY, confirmedAt: '', autoRule: l.rule })
      }
      continue
    }

    const lookalikes = rows
      .filter((r) => r.style === 'line' || !LOAN_MEANINGS.includes(m))
      .filter((r) => !taken.has(r.key))
      .flatMap((r) => {
        const why = lookalikeReason(m, r, names)
        return why ? [describe(r, why)] : []
      })
    if (lookalikes.length > 0) {
      // Every loan- or tax-like line is shown; for the rest ("could be this figure") the first few.
      possible[m] = LOAN_MEANINGS.includes(m) || TAX_MEANINGS.includes(m) ? lookalikes : lookalikes.slice(0, MAX_OTHER_POSSIBLE)
      continue
    }
    entries.push({
      meaning: m,
      rowKey: '',
      label: null,
      nonePrinted: true,
      confirmedBy: AUTO_BY,
      confirmedAt: '',
      autoRule: 'No printed line matches, and no line looks like it.',
    })
  }
  return { entries, possible, replaced }
}

/** The same set of choices (meaning, line, not printed), whoever made them. */
export function sameChoices(a: MappingEntry[], b: MappingEntry[]): boolean {
  const id = (e: MappingEntry) => `${e.meaning}|${e.rowKey}|${e.nonePrinted}`
  const sa = new Set(a.map(id))
  const sb = new Set(b.map(id))
  return sa.size === sb.size && [...sa].every((x) => sb.has(x))
}
