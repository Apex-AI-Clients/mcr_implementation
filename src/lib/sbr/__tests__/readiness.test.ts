import { describe, it, expect } from 'vitest'
import { computeReadiness, type ReadinessInput } from '../readiness'
import type { DpnNoticeView } from '@/lib/dpn/view'
import type { StoredNotice } from '@/lib/dpn/stored'
import { proveNotice } from '@/lib/dpn/proof'

/** The readiness checklist's rules. Synthetic data only. */

function notice(over: Partial<StoredNotice> = {}): StoredNotice {
  return {
    id: 'n1',
    documentId: 'dpn-1',
    source: 'parsed',
    status: 'read',
    manualReason: null,
    reviewReasons: [],
    reference: '1',
    issuedOn: '2026-09-30',
    type: 'paygw',
    companyName: 'EXAMPLE TRADING PTY LTD',
    acn: '000000019',
    directorName: 'Jane Sample',
    // One period that adds up (Column 3 = 4 + 5), so the notice is proven (dpn/proof.ts).
    rows: [{ periodFrom: '2025-07-01', periodTo: '2025-09-30', column2: 1_000_00, column3: 1_000_00, column4: 800_00, column5: 200_00 }],
    totals: null,
    tableLayout: 'five_column',
    enteredBy: null,
    enteredAt: null,
    ...over,
  }
}

const view = (n: StoredNotice | null, issues: string[] = []): DpnNoticeView => ({
  documentId: n?.documentId ?? 'dpn-x',
  filename: 'notice.pdf',
  notice: n,
  issues,
  deadline: '2026-10-21',
  proof: n ? proveNotice(n, null) : null,
})

function input(over: {
  jobRunning?: boolean
  financials?: Partial<ReadinessInput['financials']>
  lodgement?: Partial<ReadinessInput['lodgement']>
  dpn?: Partial<ReadinessInput['dpn']>
} = {}): ReadinessInput {
  return {
    clientId: 'c1',
    jobRunning: over.jobRunning ?? false,
    financials: {
      fileCount: 1,
      comparison: { generatedAt: '2026-10-17T00:00:00Z', staleSince: null },
      outOfDate: false,
      unreviewedFailures: 0,
      mappingConfirmed: true,
      ...over.financials,
    },
    lodgement: {
      csvCount: 1,
      analysis: { id: 'la-1', analysedAt: '2026-10-17T00:00:00Z', icaStatus: 'verified' },
      outOfDate: false,
      noExportFound: false,
      ...over.lodgement,
    },
    dpn: { notices: [view(notice())], noneIssued: null, ...over.dpn },
  }
}

const statusOf = (r: ReturnType<typeof computeReadiness>, key: string) => r.items.find((i) => i.key === key)!

describe('computeReadiness — all in', () => {
  it('opens the prediction when every item is ready', () => {
    const r = computeReadiness(input())
    expect(r.items.map((i) => i.status)).toEqual(['ready', 'ready', 'ready'])
    expect(r).toMatchObject({ canPredict: true, waitingFor: [], dpn: true })
  })
})

describe('financial statements', () => {
  it('is not uploaded with no files', () => {
    const r = computeReadiness(input({ financials: { fileCount: 0 } }))
    expect(statusOf(r, 'financials').status).toBe('not_uploaded')
    expect(r.canPredict).toBe(false)
    expect(r.waitingFor).toEqual(['Financial statements: not uploaded'])
  })

  it('is "not run yet", with Run now, when there is work and nothing running', () => {
    expect(statusOf(computeReadiness(input({ financials: { outOfDate: true } })), 'financials')).toMatchObject({
      status: 'not_started',
      canRunNow: true,
    })
  })

  it('is processing only while a run is going, and never offers Run now then', () => {
    const r = computeReadiness(input({ jobRunning: true, financials: { outOfDate: true } }))
    expect(statusOf(r, 'financials')).toMatchObject({ status: 'processing', canRunNow: false })
    expect(r.items.every((i) => !i.canRunNow)).toBe(true)
    expect(r.waitingFor).toEqual(['Financial statements: processing'])
  })

  it('stays ready while a run reads only other files (a notice, the ATO export)', () => {
    const r = computeReadiness(input({ jobRunning: true }))
    expect(statusOf(r, 'financials').status).toBe('ready')
  })

  it('is ready once compared, whatever gaps the comparison has', () => {
    const item = statusOf(computeReadiness(input({ financials: { fileCount: 2 } })), 'financials')
    expect(item.status).toBe('ready')
  })

  it('is failed when nothing could be read, says so, and does not hold the prediction up', () => {
    const r = computeReadiness(input({ financials: { comparison: null } }))
    expect(statusOf(r, 'financials')).toMatchObject({ status: 'failed', canRunNow: false, detail: 'No profit and loss or balance sheet could be read from the uploaded files.' })
    expect(r.canPredict).toBe(true)
    const none = computeReadiness(input({ financials: { comparison: null, read: { annualYears: [], currentPeriod: false, balanceSheet: false } } }))
    expect(statusOf(none, 'financials').status).toBe('failed')
  })

  it('one financial year on file is ready, with a note saying which and to upload an earlier one (25 Nov 2026)', () => {
    const r = computeReadiness(input({ financials: { comparison: null, read: { annualYears: ['FY2026'], currentPeriod: false, balanceSheet: true } } }))
    expect(statusOf(r, 'financials')).toMatchObject({ status: 'ready', detail: 'Only one financial year is on file (FY2026): upload an earlier year to compare.' })
    expect(r.canPredict).toBe(true)
  })

  it('a profit and loss alone also says the prediction has no balance sheet figures', () => {
    const r = computeReadiness(input({ financials: { comparison: null, read: { annualYears: ['FY2025'], currentPeriod: false, balanceSheet: false } } }))
    expect(statusOf(r, 'financials').detail).toBe(
      'Only one financial year is on file (FY2025): upload an earlier year to compare. No balance sheet is on file, so the prediction has no balance sheet figures.',
    )
  })

  it('only a current period on file is ready with its note; one year still needs its key figures confirmed', () => {
    const current = computeReadiness(input({ financials: { comparison: null, read: { annualYears: [], currentPeriod: true, balanceSheet: true } } }))
    expect(statusOf(current, 'financials')).toMatchObject({
      status: 'ready',
      detail: 'No full financial year is on file yet, only the current period: upload the latest annual statements to compare.',
    })
    const unconfirmed = computeReadiness(input({ financials: { comparison: null, mappingConfirmed: false, read: { annualYears: ['FY2026'], currentPeriod: false, balanceSheet: true } } }))
    expect(statusOf(unconfirmed, 'financials').status).toBe('needs_review')
  })

  it('never holds the prediction up for printed totals that do not add up: a note pointing to the comparison page', () => {
    const r = computeReadiness(input({ financials: { unreviewedFailures: 2 } }))
    expect(statusOf(r, 'financials')).toMatchObject({ status: 'ready' })
    expect(statusOf(r, 'financials').detail).toBe('2 printed totals do not add up: they are named under the year badges on the comparison page.')
    expect(r.canPredict).toBe(true)
  })

  it('waits, without Run now, while the year the prediction uses is held (an uncertain scan reading)', () => {
    const r = computeReadiness(input({ financials: { heldReasons: ['1 scanned figure the two readings disagree on: choose each'] } }))
    expect(statusOf(r, 'financials')).toMatchObject({ status: 'needs_review', canRunNow: false })
    expect(statusOf(r, 'financials').detail).toBe('Being prepared: 1 scanned figure the two readings disagree on: choose each.')
    expect(r.canPredict).toBe(false)
  })

  it('is Needs review, pointing at the comparison page, until staff confirm the key figures', () => {
    const r = computeReadiness(input({ financials: { mappingConfirmed: false } }))
    expect(statusOf(r, 'financials')).toMatchObject({ status: 'needs_review', href: '/clients/c1/financials-comparison' })
    expect(r.canPredict).toBe(false)
  })

  it('never has a line under the heading, in any state but Needs review, Failed, or a note (totals to look at, fewer than two years)', () => {
    for (const over of [{ fileCount: 0 }, { outOfDate: true }, {}]) {
      expect(statusOf(computeReadiness(input({ financials: over })), 'financials').detail).toBeNull()
    }
    expect(statusOf(computeReadiness(input({ jobRunning: true })), 'financials').detail).toBeNull()
  })
})

describe('ATO activity statement', () => {
  it('is Failed, saying why, when the dates in the export could not be read', () => {
    const failed = statusOf(
      computeReadiness(input({ lodgement: { analysis: { id: 'la-1', analysedAt: '2026-10-17T00:00:00Z', unparsedDateRows: 630 } } })),
      'lodgement',
    )
    expect(failed).toMatchObject({
      status: 'failed',
      detail: "We couldn't read the dates on 630 rows of this file — was it edited in Excel? Upload the original ATO download.",
    })
    const ok = statusOf(computeReadiness(input({ lodgement: { analysis: { id: 'la-1', analysedAt: '2026-10-17T00:00:00Z', unparsedDateRows: 0, icaStatus: 'verified' } } })), 'lodgement')
    expect(ok.status).toBe('ready')
  })

  it('is not uploaded without a CSV, or when none of them is an activity statement', () => {
    expect(statusOf(computeReadiness(input({ lodgement: { csvCount: 0, analysis: null } })), 'lodgement').status).toBe('not_uploaded')
    const none = statusOf(computeReadiness(input({ lodgement: { analysis: null, noExportFound: true } })), 'lodgement')
    expect(none).toMatchObject({ status: 'not_uploaded', detail: 'None of the uploaded CSVs is an activity statement account export.' })
  })

  it('is "not run yet" while a new export waits, and processing while it is analysed', () => {
    expect(statusOf(computeReadiness(input({ lodgement: { outOfDate: true } })), 'lodgement')).toMatchObject({
      status: 'not_started',
      canRunNow: true,
    })
    expect(statusOf(computeReadiness(input({ jobRunning: true, lodgement: { outOfDate: true } })), 'lodgement')).toMatchObject({
      status: 'processing',
      canRunNow: false,
    })
  })

  it('waits, saying "Totals being prepared", while the export is not verified against the ATO balance', () => {
    for (const icaStatus of ['unverified', null, undefined]) {
      const held = statusOf(computeReadiness(input({ lodgement: { analysis: { id: 'la-1', analysedAt: '2026-10-17T00:00:00Z', unparsedDateRows: 0, icaStatus } } })), 'lodgement')
      expect(held.status).toBe('not_started')
      expect(held.detail).toBe('Totals being prepared.')
      expect(held.canRunNow).toBe(false)
    }
  })

  it('is ready once analysed, with no summary under the heading', () => {
    expect(statusOf(computeReadiness(input()), 'lodgement')).toMatchObject({ status: 'ready', detail: null })
  })
})

describe('director penalty notices and the DPN factor', () => {
  it('waits, "Totals being prepared.", while a read notice is not proven; names the badges once it is', () => {
    const bad = notice({ rows: [{ periodFrom: '2025-07-01', periodTo: '2025-09-30', column2: 100, column3: 100, column4: 50, column5: 49 }] })
    const held = statusOf(computeReadiness(input({ dpn: { notices: [view(bad)], noneIssued: null } })), 'dpn')
    expect(held).toMatchObject({ status: 'not_started', detail: 'Totals being prepared.', canRunNow: false })
    const good = notice({ rows: [{ periodFrom: '2025-07-01', periodTo: '2025-09-30', column2: 100, column3: 100, column4: 50, column5: 50 }] })
    const ready = statusOf(computeReadiness(input({ dpn: { notices: [view(good)], noneIssued: null } })), 'dpn')
    expect(ready.status).toBe('ready')
    expect(ready.detail).toMatch(/: Notice adds up\.$/)
  })

  it('is ready, with No, when staff ticked "none issued"', () => {
    const r = computeReadiness(input({ dpn: { notices: [], noneIssued: { by: 'Sam', at: '2026-10-10T00:00:00Z' } } }))
    expect(statusOf(r, 'dpn').status).toBe('ready')
    expect(statusOf(r, 'dpn').detail).toMatch(/ticked by Sam, 10 Oct 2026/)
    expect(r.dpn).toBe(false)
  })

  it('is optional: with neither notices nor the tick, Predict still runs and staff answer on the prediction page', () => {
    const r = computeReadiness(input({ dpn: { notices: [], noneIssued: null } }))
    expect(statusOf(r, 'dpn').status).toBe('not_uploaded')
    expect(statusOf(r, 'dpn').detail).toMatch(/^Optional\./)
    expect(r.dpn).toBeNull()
    expect(r.canPredict).toBe(true)
    expect(r.waitingFor.some((w) => w.startsWith('Director penalty notices'))).toBe(false)
  })

  it('still waits for notices that are uploaded but not read yet', () => {
    const r = computeReadiness(input({ dpn: { notices: [view(null)] } }))
    expect(statusOf(r, 'dpn').status).toBe('not_started')
    expect(r.canPredict).toBe(false)
  })

  it('is ready once one notice is read', () => {
    const r = computeReadiness(
      input({ dpn: { notices: [view(notice()), view(notice({ documentId: 'dpn-2', status: 'needs_manual' }))] } }),
    )
    expect(statusOf(r, 'dpn')).toMatchObject({ status: 'ready', detail: '1 notice read (PAYG withholding): Notice adds up.' })
    expect(r.dpn).toBe(true)
  })

  it('is ready when a notice is read with something flagged: the notices page shows that', () => {
    const r = computeReadiness(input({ dpn: { notices: [view(notice(), ['This notice is for ACN 000 000 019, but the client file has ACN 123 456 780.'])] } }))
    expect(statusOf(r, 'dpn').status).toBe('ready')
    expect(r.dpn).toBe(true)
  })

  it('is failed when no notice could be read, without holding the prediction up', () => {
    const r = computeReadiness(input({ dpn: { notices: [view(notice({ status: 'needs_manual' }))] } }))
    expect(statusOf(r, 'dpn').status).toBe('failed')
    expect(r.canPredict).toBe(true)
    expect(r.dpn).toBe(true)
  })

  it('is "not run yet" while a notice waits to be read, and processing while it is read', () => {
    expect(statusOf(computeReadiness(input({ dpn: { notices: [view(null)] } })), 'dpn')).toMatchObject({
      status: 'not_started',
      canRunNow: true,
    })
    expect(statusOf(computeReadiness(input({ jobRunning: true, dpn: { notices: [view(null)] } })), 'dpn').status).toBe('processing')
  })
})

describe('computeReadiness — scanned statements', () => {
  it('shows the financial statements as processing while scans are read, never as compared', () => {
    const r = computeReadiness(input({ financials: { scanning: 2 } }))
    expect(statusOf(r, 'financials')).toMatchObject({ status: 'processing', detail: 'Reading 2 scanned documents — this usually takes a few minutes. It keeps going in the background, so you can leave this page.', startScan: true })
    expect(r.canPredict).toBe(false)
  })
})
