import { buildPrintedComparison, type ComparisonDocument, type PrintedComparison } from '@/lib/printed/compare'
import { comparisonProof } from '@/lib/printed/proof'
import type { StoredNotice } from '@/lib/dpn/stored'
import type { DpnAmounts, DpnRow } from '@/lib/dpn/types'

/**
 * The test bank (Gabby, 18 Nov 2026): every proven notice and statement keeps the
 * figures it was proven with, by document id (migration 0060, proof_bank). No copy
 * of a file is kept: the check reads the file again from our storage with the
 * current code, and any change to a proven figure fails it (`npm run proof:check`,
 * and `npm run figures:check`). Pure.
 *
 * A notice's entry holds its type, issue date and rows (periods and amounts in
 * cents): no name, reference, ACN or address. A statement's entry holds, for each
 * year it proved, every figure it prints for that year, keyed by statement and line.
 */

export interface NoticeBankFigures {
  type: string | null
  issuedOn: string | null
  rows: DpnRow[]
  totals: DpnAmounts | null
}

export interface StatementBankFigures {
  /** Comparison column ("FY2024", "current") → `${statement}|${line key}` → the figure as printed. */
  years: Record<string, Record<string, unknown>>
}

export function noticeBankFigures(notice: Pick<StoredNotice, 'type' | 'issuedOn' | 'rows' | 'totals'>): NoticeBankFigures {
  return {
    type: notice.type,
    issuedOn: notice.issuedOn,
    rows: notice.rows.map((r) => ({ periodFrom: r.periodFrom, periodTo: r.periodTo, column2: r.column2, column3: r.column3, column4: r.column4, column5: r.column5 })),
    totals: notice.totals ? { column2: notice.totals.column2, column3: notice.totals.column3, column4: notice.totals.column4, column5: notice.totals.column5 } : null,
  }
}

/** One document's figures for the given years, from that document alone (so other files never move its keys). */
export function documentYearFigures(doc: ComparisonDocument, years: string[]): StatementBankFigures {
  const own = buildPrintedComparison([doc])
  const out: StatementBankFigures = { years: {} }
  for (const key of years) {
    const index = own.columns.findIndex((c) => c.key === key)
    if (index < 0) continue
    const figures: Record<string, unknown> = {}
    for (const table of own.tables) {
      for (const row of table.rows) {
        const cell = row.cells[index]
        if (cell?.printed) figures[`${table.kind}|${row.key}`] = cell.value
      }
    }
    out.years[key] = figures
  }
  return out
}

/** The years each statement document proved in the client's comparison: those whose figures come from it alone. */
export function provenYearsByDocument(comparison: PrintedComparison): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const year of comparisonProof(comparison)) {
    if (year.status !== 'proven' || year.documentIds.length !== 1) continue
    const id = year.documentIds[0]
    out.set(id, [...(out.get(id) ?? []), year.column])
  }
  return out
}

/** Every difference between the banked figures and the figures now, in words with keys and figures only. */
export function bankDifferences(expected: unknown, actual: unknown, path = ''): string[] {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const out: string[] = []
    if (expected.length !== actual.length) out.push(`${path || 'rows'}: ${expected.length} banked, ${actual.length} now`)
    for (let i = 0; i < Math.min(expected.length, actual.length); i++) out.push(...bankDifferences(expected[i], actual[i], `${path}[${i}]`))
    return out
  }
  if (isObject(expected) && isObject(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()
    return keys.flatMap((k) => {
      const at = path ? `${path}.${k}` : k
      if (!(k in actual)) return [`${at}: banked ${show(expected[k])}, now missing`]
      if (!(k in expected)) return [`${at}: not banked, now ${show(actual[k])}`]
      return bankDifferences(expected[k], actual[k], at)
    })
  }
  return JSON.stringify(expected) === JSON.stringify(actual) ? [] : [`${path || 'value'}: banked ${show(expected)}, now ${show(actual)}`]
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const show = (v: unknown) => (v === undefined ? 'nothing' : JSON.stringify(v))
