import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { creditorDebt, daysSinceLastPayment, type IcaRow } from '@/lib/sbr/creditorDebt'
import { buildPrintedComparison, type ComparisonDocument } from '@/lib/printed/compare'
import { suggestMapping } from '@/lib/printed/dictionary'
import { predictionFinancials, type MappingEntry } from '@/lib/printed/mapping'
import { MEANINGS } from '@/lib/printed/meanings'
import { directorLoanInput } from '@/lib/sbr/directorLoan'
import { LATE_LODGEMENT_SCOPE } from '@/lib/analysis/config'
import { computeLateLodgement, reanalyseStoredRows } from '@/lib/analysis/computeLateLodgement'
import type { LateLodgementScope } from '@/lib/analysis/config'
import { reconciliationGap } from '@/lib/analysis/debtReconciliation'
import { parseActivityStatementCsv } from '@/lib/analysis/parseActivityStatement'
import type { LodgementAnalysisResult } from '@/lib/analysis/types'
import type { NoticeRow } from '@/lib/dpn/stored'
import { buildDpnPanel } from '@/lib/dpn/view'
import { summariseNotices } from '@/lib/dpn/summary'
import type { AtoAccountAnalysis } from '@/lib/analysis/atoAccount'

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
  /** What the SBR prediction's inputs are worked out from (printed/mapping.ts, sbr/directorLoan.ts). */
  prediction?: PredictionSnapshot
}

export interface PredictionSnapshot {
  /** The financial statement PDFs as read (the stored read, or read in memory by the snapshot). */
  documents: ComparisonDocument[]
  /** The line mapping staff confirmed; empty when none is. */
  mapping: MappingEntry[]
  directors: string[]
  /** The DPN answer from the client file: notices on file (Yes), "none issued" (No), else null. */
  dpnOnFile: boolean | null
  /** Staff's own answer, saved with the last prediction (used when nothing is on file). */
  savedDpn: boolean | null
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

// ── ATO income tax and superannuation guarantee accounts ─────────────────────

/** verified-figures/ato-accounts/accounts.json: `[{ "alias": "it-001", "file": "<export>.csv" }]`. */
export interface AtoAccountEntry {
  alias: string
  file: string
}

export const ATO_ACCOUNTS_DIR = path.join(DIR, 'ato-accounts')

export function readAtoAccounts(): AtoAccountEntry[] {
  const file = path.join(ATO_ACCOUNTS_DIR, 'accounts.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as AtoAccountEntry[]) : []
}

/** The figures of an income tax or super guarantee analysis, flat, for checking by hand and by `figures:check`. */
export function atoAccountFigures(a: AtoAccountAnalysis): LodgementFigures {
  const f: LodgementFigures = {
    atoBalance: a.balance,
    atoBalanceDate: a.balanceDate,
    balanceBroughtForward: a.openingBalance,
    unexplained: a.unexplainedDifference,
    payments: a.payments.count,
    paymentsTotal: a.payments.total,
    firstPayment: a.payments.first,
    lastPayment: a.payments.last,
    gicCharged: a.summary.gic.charged,
    gicRemittedOrAmended: a.summary.gic.remitted,
    gicNet: a.summary.gic.net,
  }
  if (a.kind === 'income_tax') {
    f.assessedTotal = a.summary.assessedTotal
    for (const x of a.summary.assessments) {
      const key = `assessment ${x.period ? `${x.period.from}..${x.period.to}` : x.rowIndex}`
      f[`${key} amount`] = x.amount
      f[`${key} assessedOn`] = x.assessedOn
      f[`${key} paymentDue`] = x.paymentDue
      f[`${key} unpaid`] = x.unpaid
      f[`${key} daysUnpaidPastDue`] = x.daysUnpaidPastDue
    }
  } else {
    const s = a.summary
    f.sgShortfall = s.totals.shortfall
    f.sgNominalInterest = s.totals.nominalInterest
    f.sgAdminFee = s.totals.adminFee
    f.sgTotal = s.totals.total
    f.part7Charged = s.part7.charged
    f.part7Remitted = s.part7.remitted
    f.part7Net = s.part7.net
    f.quarters = s.quarters.length
    for (const [kind, n] of Object.entries(s.quartersRaisedBy)) f[`quarters with ${kind}`] = n
    f.unattributedRows = s.unattributed
    for (const q of s.quarters) {
      const key = `quarter ${q.period.from}..${q.period.to}`
      f[`${key} shortfall`] = q.shortfall
      f[`${key} nominalInterest`] = q.nominalInterest
      f[`${key} adminFee`] = q.adminFee
      f[`${key} total`] = q.total
      f[`${key} headline`] = q.headline?.kind ?? null
      f[`${key} events`] = q.events.map((e) => e.kind).join(',')
    }
  }
  return f
}

// ── The SBR prediction's inputs ──────────────────────────────────────────────

/**
 * Every input the prediction route works out, from the snapshot with the
 * CURRENT code: the director loan (gross; or "not identified"), the tick it
 * implies, the ATO debt and its source, the lodgement counts, days since the
 * last payment and the DPN answer. With no confirmed mapping, the suggested
 * one is used and `mappingBasis` says so. Flat, for checking by hand and by
 * `figures:check` ("prediction" key).
 */
export function predictionInputs(alias: string, snapshot: Snapshot | null): LodgementFigures | null {
  const p = snapshot?.prediction ?? localPrediction(alias, snapshot)
  if (!p) return null
  const comparison = buildPrintedComparison(p.documents)
  const suggested = suggestMapping(comparison, { directors: p.directors })
  const mapping: MappingEntry[] = p.mapping.length
    ? p.mapping
    : MEANINGS.flatMap((m): MappingEntry[] =>
        suggested[m.key].length
          ? suggested[m.key].map((rowKey) => ({ meaning: m.key, rowKey, label: null, nonePrinted: false, confirmedBy: 'suggested', confirmedAt: '' }))
          : [{ meaning: m.key, rowKey: '', label: null, nonePrinted: true, confirmedBy: 'suggested', confirmedAt: '' }],
      )
  const f = predictionFinancials(comparison, mapping, { directors: p.directors })
  const loan = directorLoanInput(f)
  const debt = creditorDebt({
    icaRows: snapshot?.icaRows ?? null,
    mappedAto: f.atoDebt ? { amount: f.atoDebt.amount, lines: f.atoDebt.lines.map((l) => l.label) } : null,
    balanceSheetDate: f.balanceSheet?.column.periodEnd ?? null,
    balanceSheetLabel: f.balanceSheet?.label ?? null,
  })
  const lodgement = snapshot || existsSync(path.join(DIR, `${alias}.ica.csv`)) ? analyseLodgements(alias, snapshot, LATE_LODGEMENT_SCOPE) : null
  const dpn = p.dpnOnFile ?? p.savedDpn ?? false
  return {
    mappingBasis: p.mapping.length ? 'confirmed' : 'suggested',
    balanceSheet: f.balanceSheet?.label ?? null,
    directorLoanReceivableAmount: loan.notIdentified ? 'not identified' : loan.amount,
    directorLoanAtAppointment: loan.notIdentified ? 'not identified' : loan.amount > 0 ? 'yes' : 'no',
    directorLoanPayable: loan.notIdentified ? null : loan.payable,
    directorLoanNet: loan.notIdentified ? null : loan.net,
    atoDebt: debt.amount,
    atoDebtSource: debt.source,
    atoDebtAsOf: debt.asOf,
    numberOfLateLodgements: lodgement?.summary.numberOfLateLodgements ?? null,
    cumulativeDaysLate: lodgement?.summary.cumulativeDaysLate ?? null,
    daysSinceLastPayment: snapshot?.icaRows ? daysSinceLastPayment(snapshot.icaRows) : null,
    dpn: dpn ? 'yes' : 'no',
  }
}

/** The verified statements of a client kept only locally (deleted from the database): verified-figures/printed/<alias>. */
export function printedAliases(): string[] {
  const dir = path.join(DIR, 'printed')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((a) => readdirSync(path.join(dir, a)).some((f) => f.endsWith('.expected.json')))
}

/**
 * A client with no database snapshot: its statements from the verified
 * printed files (as printed, checked by hand), no confirmed mapping (so the
 * suggested one), and the notices in its old snapshot, if any.
 */
function localPrediction(alias: string, snapshot: Snapshot | null): PredictionSnapshot | null {
  const dir = path.join(DIR, 'printed', alias)
  if (!existsSync(dir)) return null
  const documents: ComparisonDocument[] = readdirSync(dir)
    .filter((f) => f.endsWith('.expected.json'))
    .map((f) => {
      const e = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as { documentId: string; statements: unknown[] }
      return { documentId: e.documentId, filename: f, uploadedAt: '', read: { status: 'read' as const, pageCount: 1, issues: [], statements: e.statements as never } }
    })
  if (documents.length === 0) return null
  const notices = snapshot?.dpn?.noticeRows.length ?? 0
  return { documents, mapping: [], directors: [], dpnOnFile: notices > 0 ? true : null, savedDpn: null }
}

// ── Figures as printed, and what the mapping makes of them ─────────────────────

/**
 * `printedFigures` in an expected file: printed lines by their label in one
 * comparison column ("current", "FY2026"), and what the confirmed mapping
 * makes of that column — the loan accounts (with the sign rule) and the
 * ATO-related debt. Worked out with the CURRENT reader, comparison and mapping.
 */
export interface PrintedFiguresSpec {
  column: string
  lines: Record<string, number>
  derived?: Partial<Record<'loanReceivable' | 'loanPayable' | 'atoRelated', number>>
}

export function comparePrintedFigures(snapshot: Snapshot | null, alias: string, spec: PrintedFiguresSpec): string[] {
  const p = snapshot?.prediction ?? localPrediction(alias, snapshot)
  if (!p) return ['printed  no statements for this client']
  const comparison = buildPrintedComparison(p.documents)
  const index = comparison.columns.findIndex((c) => c.key === spec.column)
  if (index < 0) return [`printed  no "${spec.column}" column (columns: ${comparison.columns.map((c) => c.key).join(', ')})`]
  const rows = comparison.tables.flatMap((t) => t.rows)
  const differences: string[] = []
  const check = (key: string, want: number, got: number | null | undefined) => {
    if (typeof got !== 'number' || Math.abs(got - want) >= 0.005) differences.push(`printed  ${key}: verified ${want}, now ${got ?? 'missing'}`)
  }
  for (const [label, want] of Object.entries(spec.lines)) {
    // Rows merge across years: the label may carry another year's capitals.
    const matches = rows.filter((r) => r.label.trim().toLowerCase() === label.toLowerCase() && r.cells[index].printed)
    if (matches.length !== 1) differences.push(`printed  "${label}": ${matches.length} printed lines with that label in ${spec.column}`)
    else check(`"${label}"`, want, matches[0].cells[index].value as number | null)
  }
  if (spec.derived) {
    // The prediction reads the latest balance sheet: the derived figures are that column's.
    const f = predictionFinancials(comparison, p.mapping, { directors: p.directors })
    if (f.balanceSheet?.column.key !== spec.column) differences.push(`printed  derived figures are for ${f.balanceSheet?.column.key ?? 'no column'}, not ${spec.column}`)
    if (spec.derived.loanReceivable !== undefined) check('loan owed to the company', spec.derived.loanReceivable, f.loanReceivable?.amount)
    if (spec.derived.loanPayable !== undefined) check('loan owed by the company', spec.derived.loanPayable, f.loanPayable?.amount)
    if (spec.derived.atoRelated !== undefined) check('ATO-related debt (mapped lines)', spec.derived.atoRelated, f.atoDebt?.amount)
  }
  return differences
}
