import { describe, it, expect } from 'vitest'
import { computeReadiness, type ReadinessInput } from '../readiness'
import type { FinancialFileRow } from '@/lib/financials/financialFiles'
import type { DpnNoticeView } from '@/lib/dpn/view'
import type { StoredNotice } from '@/lib/dpn/stored'

/** The readiness checklist's rules. Synthetic data only. */

function file(over: Partial<FinancialFileRow> = {}): FinancialFileRow {
  return {
    documentId: 'fs-1',
    filename: 'fy2026.pdf',
    annualYears: [2026],
    comparativeYears: [2025],
    currentPeriodYear: null,
    currentPeriodLabel: null,
    usage: 'used',
    note: 'Annual, compared for FY2026.',
    override: null,
    overridePending: false,
    ...over,
  }
}

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
    rows: [],
    totals: null,
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
      files: [file()],
      comparison: { generatedAt: '2026-10-17T00:00:00Z', staleSince: null },
      outOfDate: false,
      unreviewedFailures: 0,
      mappingConfirmed: true,
      ...over.financials,
    },
    lodgement: {
      csvCount: 1,
      analysis: { id: 'la-1', analysedAt: '2026-10-17T00:00:00Z' },
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
    const r = computeReadiness(input({ financials: { files: [] } }))
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

  it('is ready once compared, whatever gaps the comparison has', () => {
    const failed = file({ documentId: 'scan', filename: 'scan.pdf', annualYears: [], comparativeYears: [], usage: 'nothing_read' })
    const item = statusOf(computeReadiness(input({ financials: { files: [file(), failed] } })), 'financials')
    expect(item.status).toBe('ready')
  })

  it('is failed when there is nothing to compare, and does not hold the prediction up', () => {
    const r = computeReadiness(input({ financials: { comparison: null } }))
    expect(statusOf(r, 'financials')).toMatchObject({ status: 'failed', canRunNow: false })
    expect(r.canPredict).toBe(true)
  })

  it('is Needs review, holding the prediction up, while a failed hard check is not ticked', () => {
    const r = computeReadiness(input({ financials: { unreviewedFailures: 2 } }))
    expect(statusOf(r, 'financials')).toMatchObject({ status: 'needs_review', canRunNow: false })
    expect(statusOf(r, 'financials').detail).toMatch(/2 figures do not reconcile/)
    expect(r.canPredict).toBe(false)
    expect(r.waitingFor).toContain('Financial statements: needs review')
  })

  it('is Needs review, pointing at the comparison page, until staff confirm the key figures', () => {
    const r = computeReadiness(input({ financials: { mappingConfirmed: false } }))
    expect(statusOf(r, 'financials')).toMatchObject({ status: 'needs_review', href: '/clients/c1/financials-comparison' })
    expect(r.canPredict).toBe(false)
  })

  it('never has a line under the heading, in any state but Needs review', () => {
    for (const over of [{ files: [] }, { outOfDate: true }, { comparison: null }, {}]) {
      expect(statusOf(computeReadiness(input({ financials: over })), 'financials').detail).toBeNull()
    }
    expect(statusOf(computeReadiness(input({ jobRunning: true })), 'financials').detail).toBeNull()
  })
})

describe('ATO activity statement', () => {
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

  it('is ready once analysed, with no summary under the heading', () => {
    expect(statusOf(computeReadiness(input()), 'lodgement')).toMatchObject({ status: 'ready', detail: null })
  })
})

describe('director penalty notices and the DPN factor', () => {
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
    expect(statusOf(r, 'dpn')).toMatchObject({ status: 'ready', detail: '1 notice read (PAYG withholding).' })
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
