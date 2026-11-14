import type { SbrRiskBand } from '@/lib/sbr/types'
import { bandForRejectedNeighbours } from '@/lib/sbr/riskBands'
import type { AtoAccountKind } from '@/lib/analysis/atoAccountKind'
import type { Readiness, ReadinessKey, ReadinessStatus } from '@/lib/sbr/readiness'
import { CVL_STATUSES, type CvlOrigin, type CvlStatus } from '@/lib/cvl/cases'
import type { CompletenessSummary } from '@/lib/clients/completeness'

/**
 * The SBR and CVL figures on the home dashboard, "as of today". Pure: the rows
 * come from loadDashboard.ts.
 *
 *   SBR file   clients.workflow = 'sbr', not archived (the Clients list)
 *   CVL file   a CVL case not removed from CVL (the CVL list)
 */

const DAY_MS = 86_400_000

// ── SBR ─────────────────────────────────────────────────────────────────────

export interface DashPrediction {
  clientId: string
  outcomePercent: number
  lowPercent: number
  highPercent: number
  creditorTotal: number | null
  /** The ATO's part of that total, as saved with the prediction; null when not saved. */
  creditorAto: number | null
  comparableCaseIds: string[]
}

export interface DashAtoAccount {
  clientId: string
  clientName: string
  analysisId: string
  kind: AtoAccountKind
  label: string
  /** Null: no balance, or the account could not be read. */
  balance: number | null
  needsReview: boolean
  reviewedAt: string | null
}

export interface DashLodgement {
  clientId: string
  lateLodgements: number
  daysLate: number
}

export interface DashNotice {
  clientId: string
  type: string | null
  status: string
}

/** One client's share of a total, for the "where it comes from" lists. */
export interface ClientAmount {
  clientId: string
  name: string
  amount: number
  /** Optional second line: "ATO $X + others $Y". */
  parts?: string
}

export interface SbrDashboard {
  activeFiles: number
  newInLast30Days: number
  archivedFiles: number
  documents: {
    total: number
    overallPct: number
    complete: number
    awaiting: number
    /** Required categories per file. */
    requiredTotal: number
    /** Least collected first, incomplete files only. */
    furthestBehind: { id: string; name: string; pct: number }[]
  }
  predictions: {
    count: number
    /** Means over files with a prediction, 1 decimal; null with none. */
    averageOutcome: number | null
    averageLow: number | null
    averageHigh: number | null
    creditorTotal: number
    /** The ATO debt inside creditorTotal, and everyone else. */
    creditorAto: number
    creditorOthers: number
    /** Active files with no prediction yet: not in creditorTotal. */
    filesWithout: number
    /** Each file's total, largest first: these add up to creditorTotal. */
    creditorsByClient: ClientAmount[]
    bands: Record<SbrRiskBand, number>
  }
  ato: {
    total: number
    byKind: Record<AtoAccountKind, number>
    filesWithBalance: number
    accountsToCheck: number
    /** ATO accounts whose balance is in the total, and those left out (dates unreadable, or no balance). */
    accountsCounted: number
    accountsLeftOut: number
    /** Each file's ATO balance, largest first: these add up to total. */
    byClient: ClientAmount[]
  }
  lodgement: { lateLodgements: number; daysLate: number; filesWithLate: number }
  dpn: { notices: number; files: number; byType: Record<string, number>; toCheck: number }
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
}

export function summariseSbr(input: {
  files: readonly { id: string; name: string; createdAt: string }[]
  archivedFiles: number
  completeness: CompletenessSummary
  predictions: readonly DashPrediction[]
  /** Historical case id → accepted. */
  historicalAccepted: ReadonlyMap<string, boolean>
  ato: readonly DashAtoAccount[]
  lodgements: readonly DashLodgement[]
  notices: readonly DashNotice[]
  now: Date
}): SbrDashboard {
  const { files, completeness, now } = input
  const round = (n: number) => Math.round(n * 100) / 100
  const active = new Set(files.map((f) => f.id))
  const mine = <T extends { clientId: string }>(rows: readonly T[]) => rows.filter((r) => active.has(r.clientId))

  const predictions = mine(input.predictions)
  const bands: Record<SbrRiskBand, number> = { likely_accepted: 0, borderline: 0, high_rejection_risk: 0 }
  for (const p of predictions) {
    // The band is not stored: it is the rule over the case's neighbours, as on the prediction page.
    const rejected = p.comparableCaseIds.filter((id) => input.historicalAccepted.get(id) === false).length
    bands[bandForRejectedNeighbours(rejected)]++
  }

  const ato = mine(input.ato)
  const byKind: Record<AtoAccountKind, number> = { activity_statement: 0, income_tax: 0, super_guarantee: 0 }
  const withBalance = new Set<string>()
  for (const a of ato) {
    if (a.balance === null) continue
    byKind[a.kind] = (byKind[a.kind] ?? 0) + a.balance
    if (a.balance > 0) withBalance.add(a.clientId)
  }

  const nameOf = new Map(files.map((f) => [f.id, f.name]))
  const largestFirst = (a: ClientAmount, b: ClientAmount) => b.amount - a.amount || a.name.localeCompare(b.name)
  const money = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`

  const creditorsByClient: ClientAmount[] = predictions
    .filter((p) => p.creditorTotal !== null)
    .map((p) => {
      const atoPart = p.creditorAto ?? 0
      return {
        clientId: p.clientId,
        name: nameOf.get(p.clientId) ?? '',
        amount: round(p.creditorTotal!),
        parts: `ATO ${money(atoPart)} + others ${money(p.creditorTotal! - atoPart)}`,
      }
    })
    .sort(largestFirst)

  const atoTotals = new Map<string, number>()
  for (const a of ato) if (a.balance !== null) atoTotals.set(a.clientId, (atoTotals.get(a.clientId) ?? 0) + a.balance)
  const atoByClient: ClientAmount[] = [...atoTotals.entries()]
    .map(([clientId, amount]) => {
      const kinds = ato.filter((a) => a.clientId === clientId && a.balance !== null)
      return {
        clientId,
        name: nameOf.get(clientId) ?? '',
        amount: round(amount),
        parts: kinds.map((a) => `${a.label} ${money(a.balance!)}`).join(' + '),
      }
    })
    .sort(largestFirst)

  const lodgements = mine(input.lodgements)
  const notices = mine(input.notices)
  const byType: Record<string, number> = {}
  for (const n of notices) if (n.type) byType[n.type] = (byType[n.type] ?? 0) + 1

  return {
    activeFiles: files.length,
    newInLast30Days: files.filter((f) => now.getTime() - new Date(f.createdAt).getTime() <= 30 * DAY_MS).length,
    archivedFiles: input.archivedFiles,
    documents: {
      total: completeness.totalDocuments,
      overallPct: completeness.overallPct,
      complete: completeness.completeClients,
      awaiting: completeness.awaitingDocuments,
      requiredTotal: completeness.requiredTotal,
      furthestBehind: completeness.clients
        .filter((c) => !c.isComplete)
        .sort((a, b) => a.pct - b.pct || a.createdAt.localeCompare(b.createdAt))
        .slice(0, 3)
        .map((c) => ({ id: c.id, name: c.name, pct: c.pct })),
    },
    predictions: {
      count: predictions.length,
      averageOutcome: mean(predictions.map((p) => p.outcomePercent)),
      averageLow: mean(predictions.map((p) => p.lowPercent)),
      averageHigh: mean(predictions.map((p) => p.highPercent)),
      creditorTotal: round(predictions.reduce((s, p) => s + (p.creditorTotal ?? 0), 0)),
      creditorAto: round(predictions.reduce((s, p) => s + (p.creditorTotal === null ? 0 : (p.creditorAto ?? 0)), 0)),
      creditorOthers: round(predictions.reduce((s, p) => s + (p.creditorTotal === null ? 0 : p.creditorTotal - (p.creditorAto ?? 0)), 0)),
      filesWithout: files.filter((f) => !predictions.some((p) => p.clientId === f.id)).length,
      creditorsByClient,
      bands,
    },
    ato: {
      total: round(Object.values(byKind).reduce((a, b) => a + b, 0)),
      byKind: {
        activity_statement: round(byKind.activity_statement),
        income_tax: round(byKind.income_tax),
        super_guarantee: round(byKind.super_guarantee),
      },
      filesWithBalance: withBalance.size,
      accountsToCheck: ato.filter((a) => a.needsReview && !a.reviewedAt).length,
      accountsCounted: ato.filter((a) => a.balance !== null).length,
      accountsLeftOut: ato.filter((a) => a.balance === null).length,
      byClient: atoByClient,
    },
    lodgement: {
      lateLodgements: lodgements.reduce((s, l) => s + l.lateLodgements, 0),
      daysLate: lodgements.reduce((s, l) => s + l.daysLate, 0),
      filesWithLate: lodgements.filter((l) => l.lateLodgements > 0).length,
    },
    dpn: {
      notices: notices.length,
      files: new Set(notices.map((n) => n.clientId)).size,
      byType,
      toCheck: notices.filter((n) => n.status === 'needs_review' || n.status === 'needs_manual').length,
    },
  }
}

// ── Readiness and "needs attention" ─────────────────────────────────────────

export interface AttentionRow {
  clientId: string
  name: string
  detail: string
  status: 'needs_review' | 'failed'
  href: string
}

export interface ReadinessDashboard {
  files: number
  /** Every item finished, or optional and not wanted: Predict is open. */
  readyToPredict: number
  items: { key: ReadinessKey; label: string; counts: Record<ReadinessStatus, number> }[]
  attention: AttentionRow[]
}

const STATUSES: ReadinessStatus[] = ['ready', 'processing', 'needs_review', 'failed', 'not_started', 'not_uploaded']

export function summariseReadiness(
  files: readonly { clientId: string; name: string; readiness: Readiness }[],
  ato: readonly DashAtoAccount[],
): ReadinessDashboard {
  const keys: ReadinessKey[] = ['financials', 'lodgement', 'dpn']
  const items = keys.map((key) => {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<ReadinessStatus, number>
    let label = ''
    for (const f of files) {
      const item = f.readiness.items.find((i) => i.key === key)
      if (!item) continue
      label = item.label
      counts[item.status]++
    }
    return { key, label, counts }
  })

  const attention: AttentionRow[] = []
  for (const f of files) {
    for (const item of f.readiness.items) {
      if (item.status !== 'needs_review' && item.status !== 'failed') continue
      attention.push({
        clientId: f.clientId,
        name: f.name,
        detail: item.detail ? `${item.label} · ${item.detail}` : item.label,
        status: item.status,
        href: item.href,
      })
    }
  }
  const active = new Set(files.map((f) => f.clientId))
  for (const a of ato) {
    if (!active.has(a.clientId) || !a.needsReview || a.reviewedAt) continue
    attention.push({
      clientId: a.clientId,
      name: a.clientName,
      detail: `ATO account · ${a.label} · figures to check`,
      status: 'needs_review',
      href: `/clients/${a.clientId}/ato-accounts/${a.analysisId}`,
    })
  }
  // Failures first: nothing moves until someone acts.
  attention.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'failed' ? -1 : 1))

  return {
    files: files.length,
    readyToPredict: files.filter((f) => f.readiness.canPredict).length,
    items,
    attention,
  }
}

// ── CVL ─────────────────────────────────────────────────────────────────────

export interface DashCvlCase {
  clientId: string
  name: string
  status: CvlStatus
  origin: CvlOrigin
  createdAt: string
  appointmentDate: string | null
  reportDate: string | null
  reportReturnDate: string | null
  summaryDate: string | null
}

export type CvlDateKind = 'appointment' | 'report' | 'report_return' | 'summary'

export const CVL_DATE_LABELS: Record<CvlDateKind, string> = {
  appointment: 'Appointment',
  report: 'Report date',
  report_return: 'Report return',
  summary: 'Summary date',
}

export interface CvlDateRow {
  clientId: string
  name: string
  kind: CvlDateKind
  /** YYYY-MM-DD. */
  date: string
  daysAway: number
  origin: CvlOrigin
}

export interface CvlDashboard {
  activeFiles: number
  newInLast30Days: number
  byStatus: Record<CvlStatus, number>
  byOrigin: Record<CvlOrigin, number>
  formsGenerated: number
  upcoming: CvlDateRow[]
  /** Dates in the next 7 days, today included. */
  thisWeek: number
}

/** Whole days from one YYYY-MM-DD to another. */
function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS)
}

export function summariseCvl(input: {
  cases: readonly DashCvlCase[]
  formsGenerated: number
  /** Sydney date, YYYY-MM-DD. */
  todayIso: string
  now: Date
}): CvlDashboard {
  const { cases, todayIso, now } = input
  const byStatus = Object.fromEntries(CVL_STATUSES.map((s) => [s, 0])) as Record<CvlStatus, number>
  const byOrigin: Record<CvlOrigin, number> = { lead: 0, sbr_client: 0 }
  const dates: CvlDateRow[] = []
  for (const c of cases) {
    byStatus[c.status]++
    byOrigin[c.origin]++
    const all: [CvlDateKind, string | null][] = [
      ['appointment', c.appointmentDate],
      ['report', c.reportDate],
      ['report_return', c.reportReturnDate],
      ['summary', c.summaryDate],
    ]
    for (const [kind, raw] of all) {
      const date = raw?.slice(0, 10)
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      const daysAway = daysBetween(todayIso, date)
      if (daysAway >= 0) dates.push({ clientId: c.clientId, name: c.name, kind, date, daysAway, origin: c.origin })
    }
  }
  dates.sort((a, b) => a.daysAway - b.daysAway || a.name.localeCompare(b.name))
  return {
    activeFiles: cases.length,
    newInLast30Days: cases.filter((c) => now.getTime() - new Date(c.createdAt).getTime() <= 30 * DAY_MS).length,
    byStatus,
    byOrigin,
    formsGenerated: input.formsGenerated,
    upcoming: dates.slice(0, 5),
    thisWeek: dates.filter((d) => d.daysAway < 7).length,
  }
}

// ── Recent activity ─────────────────────────────────────────────────────────

export type ActivityTag = 'CRM' | 'SBR' | 'CVL'

export interface ActivityEvent {
  /** Who did it; null for something that arrived (an enquiry). */
  who: string | null
  what: string
  subject: string
  href: string
  tag: ActivityTag
  at: string
}

/** Newest first, at most `limit`, across every source. */
export function mergeActivity(groups: readonly (readonly ActivityEvent[])[], limit = 8): ActivityEvent[] {
  return groups
    .flat()
    .filter((e) => !Number.isNaN(Date.parse(e.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit)
}
