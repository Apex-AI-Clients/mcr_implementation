import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { assembleComparison } from '@/lib/financials/assembleComparison'
import type { CompanyDetailsForCheck, DocumentRecordForCheck } from '@/lib/financials/checks'
import { correctFile, type FileColumn } from '@/lib/financials/lineCorrections'
import type { FinancialsComparison, StatementLine, StoredStatementSlot } from '@/lib/financials/types'
import { creditorDebt, type IcaRow } from '@/lib/sbr/creditorDebt'
import { latestBalanceSheet } from '@/lib/financials/statementSelection'

/**
 * Shared by the snapshot and check scripts. Nothing here prints a client's
 * name: clients are known by the alias given in verified-figures/clients.json,
 * and only schema keys and figures are printed.
 */

export const DIR = path.resolve(process.cwd(), 'verified-figures')

export interface ClientEntry {
  /** A neutral name, never the client's ("client-a", "trust-test"). */
  alias: string
  clientId: string
}

export interface Snapshot {
  takenAt: string
  slots: StoredStatementSlot[]
  records: DocumentRecordForCheck[]
  company: CompanyDetailsForCheck | null
  /** The ATO account rows the prediction reads (re-read from the CSV when the stored analysis has no balance). */
  icaRows?: IcaRow[] | null
}

/** What the prediction page would use as the ATO debt, from the snapshot. */
export function predictionDebt(snapshot: Snapshot): { amount: number | null; asOf: string | null; source: string | null } {
  const statement = latestBalanceSheet(snapshot.slots)
  const debt = creditorDebt({
    icaRows: snapshot.icaRows ?? null,
    balanceSheet: statement?.balanceSheet ?? null,
    balanceSheetDate: statement?.slot.periodEndDate ?? null,
  })
  return { amount: debt.amount, asOf: debt.asOf, source: debt.source }
}

/** Figures by period ("FY2025", "current") and key ("Non-Current Assets.directorRelatedLoansReceivable"). */
export type Figures = Record<string, Record<string, number | null>>

export function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR)
}

export function readClients(): ClientEntry[] {
  const file = path.join(DIR, 'clients.json')
  if (!existsSync(file)) {
    throw new Error(
      'verified-figures/clients.json is missing. Create it as [{ "alias": "client-a", "clientId": "<uuid>" }, …] — aliases, never client names.',
    )
  }
  return JSON.parse(readFileSync(file, 'utf8')) as ClientEntry[]
}

export function readJson<T>(name: string): T | null {
  const file = path.join(DIR, name)
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null
}

export function writeJson(name: string, value: unknown) {
  ensureDir()
  writeFileSync(path.join(DIR, name), `${JSON.stringify(value, null, 2)}\n`)
}

export function snapshotAliases(): string[] {
  if (!existsSync(DIR)) return []
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.snapshot.json'))
    .map((f) => f.slice(0, -'.snapshot.json'.length))
    .sort()
}

/**
 * The extraction-time line corrections replayed over stored statements, per
 * document, as correctFile runs them at extraction — without the AI read and
 * without the text layer. So a change to the deterministic rules shows here
 * before anything is re-extracted.
 */
export function replayCorrections(slots: StoredStatementSlot[], company: CompanyDetailsForCheck | null, isTrust: boolean) {
  // Each half belongs to the document it was read from: a separate P&L and
  // Balance Sheet of one year are two files, each with its own columns.
  type Halves = { is?: StoredStatementSlot['incomeStatement']; bs?: StoredStatementSlot['balanceSheet'] }
  const byDocument = new Map<string, Map<number, Halves>>()
  for (const slot of slots) {
    const index = slot.sourceColumn === 'comparative' ? 1 : 0
    for (const [half, stored] of [['is', slot.incomeStatement], ['bs', slot.balanceSheet]] as const) {
      if (!stored?.documentId) continue
      const columnsOfDoc = byDocument.get(stored.documentId) ?? new Map<number, Halves>()
      const column = columnsOfDoc.get(index) ?? {}
      if (half === 'is') column.is = stored as Halves['is']
      else column.bs = stored as Halves['bs']
      columnsOfDoc.set(index, column)
      byDocument.set(stored.documentId, columnsOfDoc)
    }
  }
  for (const columnsOfDoc of byDocument.values()) {
    const columns: FileColumn[] = []
    for (const [index, { is: isHalf, bs: bsHalf }] of [...columnsOfDoc.entries()].sort((a, b) => a[0] - b[0])) {
      const is = isHalf?.data
      const bs = bsHalf?.data
      const lines: StatementLine[] = [...(is?.lines ?? []), ...(bs?.lines ?? [])]
      if (lines.length === 0) continue
      columns.push({
        index,
        lines,
        incomeStatement: is ?? { income: {}, cogs: {}, expenses: {}, totals: {} },
        balanceSheet: bs ?? { currentAssets: {}, nonCurrentAssets: {}, currentLiabilities: {}, nonCurrentLiabilities: {}, equity: {}, totals: {} },
      })
    }
    if (columns.length === 0 || columns.length > 2) continue
    correctFile(columns, { isTrust, directors: company?.directors ?? [] }, null)
  }
}

export function assemble(snapshot: Snapshot, replay: boolean): FinancialsComparison | null {
  const slots = JSON.parse(JSON.stringify(snapshot.slots)) as StoredStatementSlot[]
  if (replay) {
    const isTrust = snapshot.company?.entityType === 'trust'
    replayCorrections(slots, snapshot.company, isTrust)
  }
  const result = assembleComparison({ slots, records: snapshot.records, company: snapshot.company })
  return result.ok ? result.comparison : null
}

export function flatten(c: FinancialsComparison): Figures {
  const out: Figures = {}
  const put = (period: string, key: string, value: number | null) => {
    out[period] = out[period] ?? {}
    out[period][key] = value
  }
  for (const section of [...c.incomeStatementDiffs, ...c.balanceSheetDiffs]) {
    for (const row of section.rows) {
      for (const year of c.years) put(`FY${year}`, `${section.category}.${row.canonicalKey}`, row.valuesByYear[year] ?? null)
      if (c.currentPeriod) put('current', `${section.category}.${row.canonicalKey}`, row.currentPeriodValue ?? null)
    }
  }
  for (const year of c.years) {
    const ato = c.atoLiabilityByYear[year]
    if (ato) put(`FY${year}`, 'ATO-related.total', ato.total)
    const equity = c.equityByYear?.[year]
    if (equity) put(`FY${year}`, 'Appropriations.distributions', equity.distributions)
  }
  return out
}

export interface Difference {
  period: string
  key: string
  expected: number | null
  actual: number | null | undefined
}

export function compare(expected: Figures, actual: Figures): Difference[] {
  const out: Difference[] = []
  for (const period of Object.keys(expected).sort()) {
    for (const key of Object.keys(expected[period]).sort()) {
      const want = expected[period][key]
      const got = actual[period]?.[key]
      const same = want === null ? got === null || got === undefined : typeof got === 'number' && Math.abs(got - want) < 0.5
      if (!same) out.push({ period, key, expected: want, actual: got })
    }
  }
  return out
}

const fmt = (v: number | null | undefined) =>
  v === undefined ? 'missing' : v === null ? '—' : `${v < 0 ? '-' : ''}$${Math.abs(Math.round(v)).toLocaleString('en-AU')}`

export function describeDifference(d: Difference): string {
  return `${d.period}  ${d.key}: verified ${fmt(d.expected)}, now ${fmt(d.actual)}`
}

/** A short, stable stand-in for anything that might carry a name. */
export function tag(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 6)
}

export function out(line = '') {
  process.stdout.write(`${line}\n`)
}
