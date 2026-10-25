import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { creditorDebt, type IcaRow } from '@/lib/sbr/creditorDebt'
import { computeLateLodgement, reanalyseStoredRows } from '@/lib/analysis/computeLateLodgement'
import type { LateLodgementScope } from '@/lib/analysis/config'
import { reconciliationGap } from '@/lib/analysis/debtReconciliation'
import { parseActivityStatementCsv } from '@/lib/analysis/parseActivityStatement'
import type { LodgementAnalysisResult } from '@/lib/analysis/types'
import type { NoticeRow } from '@/lib/dpn/stored'
import { buildDpnPanel } from '@/lib/dpn/view'
import { summariseNotices } from '@/lib/dpn/summary'

/**
 * Shared by the snapshot and check scripts. Nothing here prints a client's
 * name: clients are known by the alias given in verified-figures/clients.json,
 * and only keys and figures are printed.
 *
 * The financial statements are checked by `npm run printed:check`
 * (scripts/printed), from the PDFs as printed; these scripts check the
 * lodgement analysis, the ATO debt the prediction uses, and the DPN totals.
 */

export const DIR = path.resolve(process.cwd(), 'verified-figures')

export interface ClientEntry {
  /** A neutral name, never the client's ("client-a", "trust-test"). */
  alias: string
  /** Null for a client deleted from the database whose PDFs are kept locally (scripts/printed). */
  clientId: string | null
}

export interface Snapshot {
  takenAt: string
  /** The ATO account rows the prediction reads (re-read from the CSV when the stored analysis has no balance). */
  icaRows?: IcaRow[] | null
  /** Director penalty notices: the documents and the stored notices. */
  dpn?: { documents: { id: string; originalFilename: string }[]; noticeRows: NoticeRow[] }
}

/** What the prediction page would use as the ATO debt from the ATO account (the balance sheet lines need the confirmed mapping). */
export function predictionDebt(snapshot: Snapshot): { amount: number | null; asOf: string | null; source: string | null } {
  const debt = creditorDebt({ icaRows: snapshot.icaRows ?? null, mappedAto: null })
  return { amount: debt.amount, asOf: debt.asOf, source: debt.source }
}

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
  writeFileSync(path.join(DIR, name), `${JSON.stringify(value, null, 2)}
`)
}

export function snapshotAliases(): string[] {
  if (!existsSync(DIR)) return []
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.snapshot.json'))
    .map((f) => f.slice(0, -'.snapshot.json'.length))
    .sort()
}

export function out(line = '') {
  process.stdout.write(`${line}
`)
}

// ── Lodgement analysis ──────────────────────────────────────────────────────

/** Lodgement figures, compared to the cent (amounts) or exactly (counts, dates). */
export type LodgementFigures = Record<string, number | string | null>

/** Clients whose ATO account comes from a CSV kept here: `<alias>.ica.csv`. */
export function icaCsvAliases(): string[] {
  if (!existsSync(DIR)) return []
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.ica.csv'))
    .map((f) => f.slice(0, -'.ica.csv'.length))
    .sort()
}

/**
 * The lodgement analysis with the CURRENT code: from `<alias>.ica.csv` when
 * there is one, else from the rows stored with the snapshot's analysis.
 */
export function analyseLodgements(alias: string, snapshot: Snapshot | null, scope: LateLodgementScope): LodgementAnalysisResult | null {
  const csv = path.join(DIR, `${alias}.ica.csv`)
  if (existsSync(csv)) return computeLateLodgement(parseActivityStatementCsv(readFileSync(csv, 'utf8')), scope)
  return snapshot?.icaRows ? reanalyseStoredRows(snapshot.icaRows, scope) : null
}

export function lodgementFigures(r: LodgementAnalysisResult): LodgementFigures {
  const db = r.debtBreakdown
  return {
    lateLodgements: r.summary.numberOfLateLodgements,
    cumulativeDaysLate: r.summary.cumulativeDaysLate,
    dpnGrossOver90: r.dpnRisk.totalGrossLate,
    payments: db.paymentsCount,
    paymentsTotal: db.paymentsReceived,
    firstPayment: db.firstPaymentDate,
    lastPayment: db.lastPaymentDate,
    refundsPaid: db.refundsPaid,
    balanceBroughtForward: db.openingBalance,
    atoBalance: db.atoBalance,
    atoBalanceDate: db.atoBalanceDate,
    unexplained: reconciliationGap(db) ?? 0,
  }
}

export function compareLodgement(expected: LodgementFigures, actual: LodgementFigures): string[] {
  const out: string[] = []
  for (const key of Object.keys(expected)) {
    const want = expected[key]
    const got = actual[key]
    const same = typeof want === 'number' ? typeof got === 'number' && Math.abs(got - want) < 0.005 : got === want
    if (!same) out.push(`lodgement  ${key}: verified ${want}, now ${got ?? 'missing'}`)
  }
  return out
}

// ── Director penalty notices ─────────────────────────────────────────────────

/** The stored notices' company totals by type, columns 2–5 in dollars (current notices, each period once). */
export function noticeTotals(snapshot: Snapshot): Record<string, [number, number, number, number]> {
  if (!snapshot.dpn) return {}
  const today = snapshot.takenAt.slice(0, 10)
  const panel = buildDpnPanel({
    documents: snapshot.dpn.documents,
    noticeRows: snapshot.dpn.noticeRows,
    client: { no_dpn_confirmed_at: null, no_dpn_confirmed_by: null, no_dpn_cleared_note: null },
    file: { acn: null, directors: [] },
    todayIso: today,
  })
  const out: Record<string, [number, number, number, number]> = {}
  for (const t of summariseNotices(panel.notices, today).companyByType) {
    out[t.type] = [t.totals.column2, t.totals.column3, t.totals.column4, t.totals.column5].map((c) => c / 100) as [number, number, number, number]
  }
  return out
}
