import { describe, expect, it } from 'vitest'
import { buckets, readRange, windows } from '../range'
import { summariseLeads, type DashLead } from '../leads'
import { mergeActivity, summariseCvl, summariseReadiness, summariseSbr, type DashCvlCase } from '../portfolio'
import type { CompletenessSummary } from '@/lib/clients/completeness'
import type { Readiness, ReadinessItem, ReadinessStatus } from '@/lib/sbr/readiness'

const NOW = new Date('2026-11-14T02:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

function lead(over: Partial<DashLead> = {}): DashLead {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    name: 'Sample Person',
    company: 'Sample Trading Pty Ltd',
    source: 'facebook',
    stage: 'lead',
    createdAt: daysAgo(5),
    lastActionAt: daysAgo(1),
    state: 'NSW',
    entityType: 'company',
    debtText: '$50k–$150k',
    campaign: null,
    convertedClientId: null,
    ...over,
  }
}

describe('range', () => {
  it('reads unknown values as 30 days', () => {
    expect(readRange(undefined)).toBe('d30')
    expect(readRange('nope')).toBe('d30')
    expect(readRange(['d90'])).toBe('d90')
  })

  it('covers the whole window with equal buckets, now included', () => {
    for (const key of ['d30', 'd90', 'm6', 'm12', 'all'] as const) {
      const list = buckets(key, NOW)
      const { current } = windows(key, NOW)
      expect(list[0].start).toBe(current.start)
      expect(list.at(-1)!.end).toBeGreaterThan(NOW.getTime())
      for (let i = 1; i < list.length; i++) expect(list[i].start).toBe(list[i - 1].end)
    }
    expect(buckets('m12', NOW)).toHaveLength(12)
  })

  it('starts all time at the first record, with nothing before it to compare', () => {
    const since = daysAgo(400)
    const { current, previous } = windows('all', NOW, since)
    expect(current.start).toBe(Date.parse(since))
    expect(previous.end - previous.start).toBe(0)
    expect(buckets('all', NOW, since)[0].start).toBe(Date.parse(since))
  })
})

describe('summariseLeads', () => {
  const base = { submissions: [], clients: [], stages: [], range: 'd30' as const, now: NOW }

  it('counts new leads in the range against the one before', () => {
    const d = summariseLeads({
      ...base,
      leads: [lead(), lead({ source: 'website' }), lead({ createdAt: daysAgo(45) }), lead({ createdAt: daysAgo(100) })],
    })
    expect(d.newLeads).toBe(2)
    expect(d.previousNewLeads).toBe(1)
    expect(d.newLeadsChange).toBe(100)
    // The chart adds up to the headline.
    expect(d.series.totals.reduce((a, b) => a + b, 0)).toBe(2)
    expect(d.bySource.find((s) => s.source === 'website')!.count).toBe(1)
  })

  it('builds the funnel from how far each lead got; converted counts at every step', () => {
    const d = summariseLeads({
      ...base,
      leads: [
        lead({ stage: 'lead' }),
        lead({ stage: 'prospect' }),
        lead({ stage: 'client' }),
        lead({ stage: 'converted' }),
        lead({ stage: 'unresponsive', convertedClientId: 'c1' }),
        lead({ stage: 'non_proceeding' }),
      ],
    })
    expect(d.funnel.map((f) => f.count)).toEqual([6, 4, 3, 2])
    expect(d.closed).toBe(1)
  })

  it('flags open leads quiet for more than 30 days, whenever they came in, quietest first', () => {
    const d = summariseLeads({
      ...base,
      leads: [
        lead({ id: 'a', lastActionAt: daysAgo(31), createdAt: daysAgo(200) }),
        lead({ id: 'b', lastActionAt: daysAgo(60) }),
        lead({ id: 'c', lastActionAt: daysAgo(29) }),
        lead({ id: 'd', lastActionAt: daysAgo(90), stage: 'do_not_contact' }),
        lead({ id: 'e', lastActionAt: daysAgo(90), stage: 'custom_x' }),
      ],
    })
    expect(d.openLeads).toBe(3)
    expect(d.followUpsDue).toBe(2)
    expect(d.followUps.map((f) => f.id)).toEqual(['b', 'a'])
    expect(d.followUps[0].meta).toBe('Company · NSW · $50k–$150k · Facebook')
    expect(d.followUpsByStage.find((s) => s.stage === 'lead')).toMatchObject({ count: 2, href: '/leads?tab=leads&followup=1' })
    expect(d.followUpsByStage.find((s) => s.stage === 'contact_in_30_days')!.href).toBe('/leads?tab=contact-in-30-days&followup=1')
  })

  it('dates conversions by the file they became, split by workspace', () => {
    const d = summariseLeads({
      ...base,
      leads: [lead({ id: 'l1' })],
      submissions: [
        { leadId: 'l1', receivedAt: daysAgo(40), convertedClientId: 'c1' },
        { leadId: 'l1', receivedAt: daysAgo(3), convertedClientId: 'c2' },
        { leadId: 'l1', receivedAt: daysAgo(2), convertedClientId: null },
      ],
      clients: [
        { id: 'c1', createdAt: daysAgo(35), workflow: 'sbr' },
        { id: 'c2', createdAt: daysAgo(1), workflow: 'cvl' },
      ],
    })
    expect(d.conversions).toMatchObject({ total: 1, sbr: 0, cvl: 1, previous: 1 })
    expect(d.enquiries).toBe(2)
    expect(d.repeatEnquiries).toBe(2)
  })

  it('counts every lead for all time, with no change figure', () => {
    const d = summariseLeads({ ...base, range: 'all', leads: [lead(), lead({ createdAt: daysAgo(500) }), lead({ createdAt: daysAgo(900) })] })
    expect(d.newLeads).toBe(3)
    expect(d.newLeadsChange).toBeNull()
    expect(d.series.totals.reduce((a, b) => a + b, 0)).toBe(3)
  })

  it('ranks Facebook campaigns among the new leads', () => {
    const d = summariseLeads({
      ...base,
      leads: [
        lead({ campaign: 'B' }),
        lead({ campaign: 'A' }),
        lead({ campaign: 'A' }),
        lead({ campaign: 'Z', source: 'website' }),
        lead({ campaign: 'C', createdAt: daysAgo(60) }),
      ],
    })
    expect(d.campaigns).toEqual([
      { name: 'A', count: 2 },
      { name: 'B', count: 1 },
    ])
  })
})

const completeness: CompletenessSummary = {
  clients: [
    { id: 'c1', name: 'One', createdAt: daysAgo(10), requiredMet: 2, isComplete: true, pct: 100 },
    { id: 'c2', name: 'Two', createdAt: daysAgo(10), requiredMet: 1, isComplete: false, pct: 50 },
    { id: 'c3', name: 'Three', createdAt: daysAgo(90), requiredMet: 0, isComplete: false, pct: 0 },
  ],
  requiredTotal: 2,
  totalClients: 3,
  totalDocuments: 7,
  completeClients: 1,
  awaitingDocuments: 2,
  requiredCollected: 3,
  requiredPossible: 6,
  overallPct: 50,
}

describe('summariseSbr', () => {
  const files = [
    { id: 'c1', name: 'One', createdAt: daysAgo(10) },
    { id: 'c2', name: 'Two', createdAt: daysAgo(10) },
    { id: 'c3', name: 'Three', createdAt: daysAgo(90) },
  ]

  it('bands predictions by rejected neighbours and leaves out files no longer active', () => {
    const d = summariseSbr({
      files,
      archivedFiles: 4,
      completeness,
      predictions: [
        { clientId: 'c1', outcomePercent: 20, lowPercent: 10, highPercent: 30, creditorTotal: 1_000_000, creditorAto: 400_000, comparableCaseIds: ['h1', 'h2'] },
        { clientId: 'c2', outcomePercent: 30, lowPercent: 20, highPercent: 40, creditorTotal: 500_000, creditorAto: null, comparableCaseIds: ['h1', 'h3', 'h4'] },
        { clientId: 'gone', outcomePercent: 90, lowPercent: 90, highPercent: 90, creditorTotal: 9_000_000, creditorAto: 1, comparableCaseIds: [] },
      ],
      historicalAccepted: new Map([
        ['h1', true],
        ['h2', false],
        ['h3', false],
        ['h4', false],
      ]),
      ato: [],
      lodgements: [],
      notices: [],
      now: NOW,
    })
    expect(d.activeFiles).toBe(3)
    expect(d.newInLast30Days).toBe(2)
    expect(d.predictions).toMatchObject({ count: 2, averageOutcome: 25, creditorTotal: 1_500_000, creditorAto: 400_000, creditorOthers: 1_100_000, filesWithout: 1 })
    expect(d.predictions.bands).toEqual({ likely_accepted: 1, borderline: 1, high_rejection_risk: 0 })
    expect(d.documents.furthestBehind.map((f) => f.id)).toEqual(['c3', 'c2'])
    // Each file's total, largest first, adding up to the card's figure; the inactive file is left out.
    expect(d.predictions.creditorsByClient.map((c) => [c.name, c.amount])).toEqual([
      ['One', 1_000_000],
      ['Two', 500_000],
    ])
    expect(d.predictions.creditorsByClient[0].parts).toBe('ATO $400,000 + others $600,000')
  })

  it('totals ATO balances by kind, skipping unreadable accounts', () => {
    const acc = (clientId: string, kind: 'activity_statement' | 'income_tax' | 'super_guarantee', balance: number | null) => ({
      clientId,
      clientName: clientId,
      analysisId: `${clientId}-${kind}`,
      kind,
      label: kind,
      balance,
      needsReview: false,
      reviewedAt: null,
    })
    const d = summariseSbr({
      files,
      archivedFiles: 0,
      completeness,
      predictions: [],
      historicalAccepted: new Map(),
      ato: [acc('c1', 'activity_statement', 1000), acc('c2', 'activity_statement', 500.5), acc('c2', 'income_tax', null), acc('x', 'income_tax', 99)],
      lodgements: [{ clientId: 'c1', lateLodgements: 3, daysLate: 120 }],
      notices: [
        { clientId: 'c1', type: 'paygw', status: 'read' },
        { clientId: 'c1', type: 'gst', status: 'needs_review' },
      ],
      now: NOW,
    })
    expect(d.ato.total).toBe(1500.5)
    expect(d.ato.byKind.income_tax).toBe(0)
    expect(d.ato.filesWithBalance).toBe(2)
    expect(d.ato).toMatchObject({ accountsCounted: 2, accountsLeftOut: 1 })
    expect(d.ato.byClient.map((c) => [c.name, c.amount])).toEqual([
      ['One', 1000],
      ['Two', 500.5],
    ])
    expect(d.ato.byClient.reduce((s, c) => s + c.amount, 0)).toBe(d.ato.total)
    expect(d.lodgement).toEqual({ lateLodgements: 3, daysLate: 120, filesWithLate: 1 })
    expect(d.dpn).toMatchObject({ notices: 2, files: 1, toCheck: 1 })
  })
})

describe('summariseReadiness', () => {
  const item = (key: ReadinessItem['key'], status: ReadinessStatus): ReadinessItem => ({
    key,
    label: key,
    status,
    detail: `${key} detail`,
    canRunNow: false,
    href: `/clients/x/${key}`,
  })
  const readiness = (f: ReadinessStatus, l: ReadinessStatus, d: ReadinessStatus, canPredict: boolean): Readiness =>
    ({ items: [item('financials', f), item('lodgement', l), item('dpn', d)], canPredict, waitingFor: [], dpn: null }) as Readiness

  it('counts each item by status and lists failures before reviews', () => {
    const r = summariseReadiness(
      [
        { clientId: 'a', name: 'Alpha', readiness: readiness('ready', 'ready', 'not_uploaded', true) },
        { clientId: 'b', name: 'Bravo', readiness: readiness('needs_review', 'failed', 'ready', false) },
      ],
      [
        { clientId: 'a', clientName: 'Alpha', analysisId: 'an1', kind: 'income_tax', label: 'Income tax', balance: 1, needsReview: true, reviewedAt: null },
        { clientId: 'a', clientName: 'Alpha', analysisId: 'an2', kind: 'income_tax', label: 'Done', balance: 1, needsReview: true, reviewedAt: daysAgo(1) },
      ],
    )
    expect(r.readyToPredict).toBe(1)
    expect(r.items[0].counts).toMatchObject({ ready: 1, needs_review: 1 })
    expect(r.attention.map((a) => [a.name, a.status])).toEqual([
      ['Bravo', 'failed'],
      ['Alpha', 'needs_review'],
      ['Bravo', 'needs_review'],
    ])
    expect(r.attention[1].href).toBe('/clients/a/ato-accounts/an1')
  })
})

describe('summariseCvl', () => {
  const c = (over: Partial<DashCvlCase>): DashCvlCase => ({
    clientId: 'x',
    name: 'X',
    status: 'draft',
    origin: 'lead',
    createdAt: daysAgo(3),
    appointmentDate: null,
    reportDate: null,
    reportReturnDate: null,
    summaryDate: null,
    ...over,
  })

  it('lists dates from today on, soonest first, and counts the next 7 days', () => {
    const d = summariseCvl({
      cases: [
        c({ clientId: 'a', name: 'A', status: 'printed', appointmentDate: '2026-11-13', reportDate: '2026-11-20' }),
        c({ clientId: 'b', name: 'B', origin: 'sbr_client', status: 'forms_prepared', appointmentDate: '2026-11-14', summaryDate: '2026-12-30' }),
      ],
      formsGenerated: 5,
      todayIso: '2026-11-14',
      now: NOW,
    })
    expect(d.upcoming.map((u) => [u.clientId, u.kind, u.daysAway])).toEqual([
      ['b', 'appointment', 0],
      ['a', 'report', 6],
      ['b', 'summary', 46],
    ])
    expect(d.thisWeek).toBe(2)
    expect(d.byStatus).toEqual({ draft: 0, forms_prepared: 1, printed: 1 })
    expect(d.byOrigin).toEqual({ lead: 1, sbr_client: 1 })
  })
})

describe('mergeActivity', () => {
  it('interleaves sources newest first and keeps the limit', () => {
    const e = (at: string, subject: string) => ({ who: null, what: 'x', subject, href: '/', tag: 'CRM' as const, at })
    const merged = mergeActivity([[e(daysAgo(3), 'old'), e(daysAgo(1), 'new')], [e(daysAgo(2), 'mid'), e('not a date', 'bad')]], 2)
    expect(merged.map((m) => m.subject)).toEqual(['new', 'mid'])
  })
})
