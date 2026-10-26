import { calendarDay, periodOf, type AccountRow, type AtoAccountCore } from './engine'
import { SGC_EVENT } from './classify'

/**
 * The superannuation guarantee account's own summary: each quarter's SG
 * charge (shortfall, nominal interest, administration fee), every event that
 * raised or changed it, Part 7 penalties, interest and payments. Pure.
 *
 * How the export prints a quarter: one "…SGC Statement (Liability) -
 * Superannuation Guarantee (Quarterly) for the period from …" row per event,
 * for $0, with the amounts that event added printed directly above it on the
 * same dates ("SG Shortfall", "SG Nominal Interest", "SG Administration Fee"
 * for the same period). An amendment's rows are what it added, not a new
 * total, so a quarter's charge is the sum over all its events.
 *
 * Every event is listed; the latest is the quarter's headline. How it was
 * raised is the statement row's own words, labelled neutrally: a plain
 * statement is an "SGC statement" (never "lodged by the company" — the export
 * does not say who lodged it).
 */

export type SgEventKind = 'statement' | 'ato_default' | 'ato_audit' | 'client_amendment' | 'ato_amendment'

export const SG_EVENT_LABEL: Record<SgEventKind, string> = {
  statement: 'SGC statement',
  ato_default: 'ATO default assessment',
  ato_audit: 'ATO audit',
  client_amendment: 'Client amendment',
  ato_amendment: 'ATO amendment',
}

/** Shown highlighted: raised by the ATO rather than from the company's own statement. */
export const SG_HIGHLIGHT: readonly SgEventKind[] = ['ato_default', 'ato_audit']

export interface SgAmounts {
  shortfall: number
  nominalInterest: number
  adminFee: number
  total: number
}

export interface SgEvent extends SgAmounts {
  rowIndex: number
  kind: SgEventKind
  label: string
  processed: string | null
  effective: string | null
}

export interface SgQuarter extends SgAmounts {
  period: { from: string; to: string }
  /** Newest first; the first is the headline. */
  events: SgEvent[]
  headline: SgEvent | null
}

export interface SuperGuaranteeSummary {
  quarters: SgQuarter[]
  totals: SgAmounts
  part7: { charged: number; remitted: number; net: number }
  gic: { charged: number; remitted: number; net: number }
  payments: AtoAccountCore['payments']
  /** Quarters with at least one event of each kind. */
  quartersRaisedBy: Record<SgEventKind, number>
  /** Component rows no event row could be found for (should be none). */
  unattributed: number
  note: string
}

export const SG_DPN_NOTE = 'Unpaid superannuation guarantee charge can be the subject of a director penalty notice.'

const round2 = (n: number) => Math.round(n * 100) / 100

export function sgEventKind(description: string): SgEventKind {
  const s = description.replace(/^'/, '').trim().toLowerCase()
  if (s.startsWith('default')) return 'ato_default'
  if (s.startsWith('tax office audit amended')) return 'ato_audit'
  if (s.startsWith('client initiated amended')) return 'client_amendment'
  if (s.startsWith('tax office initiated amended') || s.startsWith('ato initiated amended')) return 'ato_amendment'
  return 'statement'
}

const COMPONENT: Partial<Record<NonNullable<AccountRow['line']>, keyof Omit<SgAmounts, 'total'>>> = {
  sgShortfall: 'shortfall',
  sgNominalInterest: 'nominalInterest',
  sgAdminFee: 'adminFee',
}

const isEventRow = (r: AccountRow) => SGC_EVENT.test(r.description.toLowerCase())
const zero = (): SgAmounts => ({ shortfall: 0, nominalInterest: 0, adminFee: 0, total: 0 })
const periodKey = (p: { from: string; to: string }) => `${p.from}|${p.to}`

export function superGuaranteeSummary(core: AtoAccountCore): SuperGuaranteeSummary {
  const rows = core.rows
  const events = new Map<number, SgEvent>()
  const quarterOf = new Map<string, SgQuarter>()
  let unattributed = 0

  const quarterFor = (period: { from: string; to: string }) => {
    const key = periodKey(period)
    const q = quarterOf.get(key) ?? { period, events: [], headline: null, ...zero() }
    quarterOf.set(key, q)
    return q
  }

  for (const r of rows) {
    if (!isEventRow(r)) continue
    const period = periodOf(r.description)
    if (!period) continue
    const kind = sgEventKind(r.description)
    const event: SgEvent = {
      rowIndex: r.rowIndex,
      kind,
      label: SG_EVENT_LABEL[kind],
      processed: calendarDay(r.processedDate),
      effective: calendarDay(r.effectiveDate),
      ...zero(),
    }
    events.set(r.rowIndex, event)
    quarterFor(period).events.push(event)
  }

  // Each component row belongs to the first event row below it (the ATO
  // prints newest first) for the same period, processed the same day. Other
  // rows of that day in between (an interest charge, another quarter's
  // amounts) are passed over.
  rows.forEach((r, i) => {
    const field = r.line ? COMPONENT[r.line] : undefined
    if (!field || isEventRow(r)) return
    const period = periodOf(r.description)
    const amount = round2((r.debit ?? 0) - (r.credit ?? 0))
    let owner: SgEvent | undefined
    for (let j = i + 1; j < rows.length && period; j++) {
      const below = rows[j]
      if (below.rawProcessed.trim() !== r.rawProcessed.trim()) break
      const p = isEventRow(below) ? periodOf(below.description) : null
      if (p && periodKey(p) === periodKey(period)) {
        owner = events.get(below.rowIndex)
        break
      }
    }
    if (owner) {
      owner[field] = round2(owner[field] + amount)
      owner.total = round2(owner.total + amount)
    } else {
      unattributed += 1
    }
    if (period) {
      const q = quarterFor(period)
      q[field] = round2(q[field] + amount)
      q.total = round2(q.total + amount)
    }
  })

  const byTime = (e: SgEvent) => `${e.processed ?? ''}|${String(1e9 - e.rowIndex).padStart(10, '0')}`
  const quarters = [...quarterOf.values()]
    .map((q) => {
      const sorted = [...q.events].sort((a, b) => byTime(b).localeCompare(byTime(a)))
      return { ...q, events: sorted, headline: sorted[0] ?? null }
    })
    .sort((a, b) => a.period.from.localeCompare(b.period.from))

  const totals = quarters.reduce<SgAmounts>(
    (t, q) => ({
      shortfall: round2(t.shortfall + q.shortfall),
      nominalInterest: round2(t.nominalInterest + q.nominalInterest),
      adminFee: round2(t.adminFee + q.adminFee),
      total: round2(t.total + q.total),
    }),
    zero(),
  )

  const quartersRaisedBy = Object.fromEntries(
    (Object.keys(SG_EVENT_LABEL) as SgEventKind[]).map((kind) => [kind, quarters.filter((q) => q.events.some((e) => e.kind === kind)).length]),
  ) as Record<SgEventKind, number>

  const p7 = core.totals.part7 ?? { debits: 0, credits: 0, net: 0 }
  const gic = core.totals.interest ?? { debits: 0, credits: 0, net: 0 }
  return {
    quarters,
    totals,
    part7: { charged: p7.debits, remitted: p7.credits, net: p7.net },
    gic: { charged: gic.debits, remitted: gic.credits, net: gic.net },
    payments: core.payments,
    quartersRaisedBy,
    unattributed,
    note: SG_DPN_NOTE,
  }
}
