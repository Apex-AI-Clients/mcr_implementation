import type { PeriodSources, StatementSource } from './compare'
import { STATEMENT_NAME } from './picker'

/**
 * Where a period's figures come from, in words (Gabby, 25 Nov 2026), for the page, the PDF and the
 * CSV exports alike. Pure.
 *
 *   Source: Multi-year export (2026–2022) — "Balance Sheet (2).pdf"
 *   Also in: Annual financial statements — "FY2026 accounts.pdf" — ✓ same figures
 *   Also in: … — ⚠ differs on 2 lines
 */

export const sourceName = (s: { label: string; filename: string }) => `${s.label} — “${s.filename}”`

export function alsoInText(a: StatementSource['alsoIn'][number]): string {
  return `${sourceName(a)} — ${a.differs.length === 0 ? '✓ same figures' : `⚠ differs on ${a.differs.length} line${a.differs.length === 1 ? '' : 's'}`}`
}

/** One line per statement, or one for both when the same file gives both. */
export function sourceLines(period: PeriodSources): { statement: string | null; source: string; chosen: string | null }[] {
  const shown = period.statements.filter((s) => s.source)
  const chosen = (s: StatementSource) => (s.chosen ? `chosen by ${s.chosen.by} on ${new Date(s.chosen.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}` : null)
  if (shown.length === 2 && shown[0].source!.documentId === shown[1].source!.documentId && (shown[0].chosen === null) === (shown[1].chosen === null)) {
    return [{ statement: null, source: sourceName(shown[0].source!), chosen: chosen(shown[0]) }]
  }
  return shown.map((s) => ({ statement: STATEMENT_NAME[s.statement], source: sourceName(s.source!), chosen: chosen(s) }))
}

/** For a CSV cell: "Source: …; Also in: …", every statement. */
export function periodSourceCsv(period: PeriodSources | undefined): string {
  if (!period) return ''
  const parts = sourceLines(period).map((l) => `${l.statement ? `${l.statement}: ` : ''}Source: ${l.source}${l.chosen ? ` (${l.chosen})` : ''}`)
  for (const s of period.statements) for (const a of s.alsoIn) parts.push(`${STATEMENT_NAME[s.statement]} also in: ${alsoInText(a)}`)
  if (period.endsDiffer) parts.push(period.endsDiffer)
  return parts.join('; ')
}
