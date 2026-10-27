import type { CellSource } from '@/lib/printed/compare'
import type { MappedLine } from '@/lib/printed/mapping'

/**
 * Where an amount on the SBR pages comes from, in plain English: the
 * document, statement, period, page and printed line; the reading rule
 * applied; the sum with the actual numbers for a calculated amount; and a way
 * to see it for yourself. Shown by the ⓘ beside every amount
 * (components/ui/SourcedAmount.tsx). Pure and serialisable.
 */
export interface AmountSource {
  /** What it is and where it is printed, one fact per line. */
  from: string[]
  /** The reading rule applied, when one was ("A negative figure under liabilities means …"). */
  rule?: string | null
  /** For a calculated amount: the sum with the actual numbers. */
  calculation?: string | null
  link?: SourceLink | null
}

export type SourceLink =
  /** "Open PDF at this page": a signed link, made when clicked. */
  | { kind: 'pdf'; documentId: string; page: number | null; label?: string }
  | { kind: 'href'; href: string; label: string }

export const aud = (n: number, { cents = true }: { cents?: boolean } = {}) =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`

/** A printed figure as it appears on the page: brackets for a negative. */
const asPrinted = (n: number) => (n < 0 ? `(${Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2 })})` : n.toLocaleString('en-AU', { minimumFractionDigits: 2 }))

/** One printed line: "“Loan - Director” printed (130,167.87) — page 2 of statements.pdf, column “15 OCT 2026”". */
export function printedLineText(label: string, printed: number, source: CellSource | null): string {
  const where = source ? ` — page ${source.page} of ${source.filename}${source.header ? `, column “${source.header}”` : ''}` : ''
  return `“${label.trim() || '(no label)'}” printed ${asPrinted(printed)}${where}`
}

/**
 * The source of an amount made of mapped printed lines (printed/mapping.ts):
 * each line where it is printed, the rule applied to any of them, the sum
 * when there are several, and the PDF page of the first.
 */
export function printedLinesSource(
  what: string,
  statement: string,
  lines: readonly MappedLine[],
  total: number,
  { confirmUrl }: { confirmUrl?: string } = {},
): AmountSource {
  if (lines.length === 0) {
    return {
      from: [what, `${statement}: no printed line (confirmed as not printed, or printed as “-”).`],
      link: confirmUrl ? { kind: 'href', href: confirmUrl, label: 'Confirm key figures' } : null,
    }
  }
  const rules = [...new Set(lines.map((l) => l.rule).filter((r): r is string => !!r))]
  const first = lines.find((l) => l.source)?.source ?? null
  return {
    from: [what, statement, ...lines.map((l) => printedLineText(l.label, l.printed, l.source))],
    rule: rules.length ? rules.join(' ') : null,
    calculation: lines.length > 1 ? `${lines.map((l) => aud(l.value)).join(' + ').replace(/\+ −/g, '− ')} = ${aud(total)}` : null,
    link: first ? { kind: 'pdf', documentId: first.documentId, page: first.page } : confirmUrl ? { kind: 'href', href: confirmUrl, label: 'Confirm key figures' } : null,
  }
}

/** An amount from the ATO account rows: what it adds up, and where to see the rows. */
export function atoRowsSource(what: string, account: string, rowCount: number, href?: string, extra: Partial<AmountSource> = {}): AmountSource {
  return {
    from: [what, `${account}: ${rowCount === 1 ? '1 row' : `${rowCount} rows`} of the ATO account, as printed in its CSV.`],
    link: href ? { kind: 'href', href, label: 'Show the ATO rows' } : null,
    ...extra,
  }
}

/** A calculated amount: the sum with its actual numbers. */
export function calculated(what: string, calculation: string, extra: Partial<AmountSource> = {}): AmountSource {
  return { from: [what], calculation, ...extra }
}

/** An amount staff typed. */
export function enteredByStaff(what: string, note?: string): AmountSource {
  return { from: [what, note ?? 'Entered by staff on this page.'] }
}
