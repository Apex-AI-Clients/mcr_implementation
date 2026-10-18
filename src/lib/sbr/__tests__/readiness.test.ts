import { describe, it, expect } from 'vitest'
import { computeReadiness, type ReadinessInput } from '../readiness'
import type { FinancialFileRow } from '@/lib/financials/financialFiles'
import type { StatementCoverage } from '@/lib/financials/coverage'
import type { DpnNoticeView } from '@/lib/dpn/view'
import type { StoredNotice } from '@/lib/dpn/stored'

/** The readiness checklist's rules. Synthetic data only. */

const own = { status: 'own' as const, filename: 'f.pdf', documentId: 'd' }
const missing = { status: 'missing' as const, filename: null, documentId: null }

function coverage(withCurrent = true, gap = false): StatementCoverage {
  const years = [2023, 2024, 2025, 2026]
  const columns = [
    ...years.map((y) => ({ key: `fy${y}`, label: `FY${y}`, financialYear: y, kind: 'annual' as const, extra: false })),
    ...(withCurrent ? [{ key: 'current', label: 'Current period', financialYear: 2027, kind: 'current_period' as const, extra: false }] : []),
  ]
  const row = columns.map((_, i) => (gap && i === 0 ? missing : own))
  return { columns, rows: { income_statement: row, balance_sheet: columns.map(() => own) } }
}

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
  reviews?: ReadinessInput['reviews']
} = {}): ReadinessInput {
  return {
    clientId: 'c1',
    jobRunning: over.jobRunning ?? false,
    financials: {
      files: [file()],
      coverage: coverage(),
      comparison: { generatedAt: '2026-10-17T00:00:00Z', staleSince: null },
      outOfDate: false,
      ...over.financials,
    },
    lodgement: {
      csvCount: 1,
      analysis: { id: 'la-1', analysedAt: '2026-10-17T00:00:00Z', warnings: 0, late: 3, daysLate: 120 },
      outOfDate: false,
      noExportFound: false,
      ...over.lodgement,
    },
    dpn: { notices: [view(notice())], noneIssued: null, ...over.dpn },
    reviews: over.reviews ?? {},
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
  })

  it('lists a file whose read failed, with why, rather than waiting on it for ever', () => {
    const failed = file({
      documentId: 'scan',
      filename: 'scan.pdf',
      annualYears: [],
      comparativeYears: [],
      usage: 'nothing_read',
      note: 'Could not be read: extraction timed out after 200s Re-extract from the comparison page to try again.',
    })
    const item = statusOf(computeReadiness(input({ financials: { files: [file(), failed] } })), 'financials')
    expect(item.status).toBe('needs_review')
    expect(item.notes[0]).toMatch(/^scan\.pdf: Could not be read: extraction timed out/)
  })

  it('needs review for a gap, a missing current period, or a file that gave nothing', () => {
    const gap = statusOf(computeReadiness(input({ financials: { coverage: coverage(true, true) } })), 'financials')
    expect(gap.status).toBe('needs_review')
    expect(gap.notes).toContain('FY2023 Profit and Loss is missing.')

    const noCurrent = statusOf(computeReadiness(input({ financials: { coverage: coverage(false) } })), 'financials')
    expect(noCurrent.notes).toContain('No current-period statement is on file.')

    const deed = file({ documentId: 'x', filename: 'deed.pdf', usage: 'not_financial', note: 'Reads as a trust deed.' })
    const withDeed = statusOf(computeReadiness(input({ financials: { files: [file(), deed] } })), 'financials')
    expect(withDeed.notes).toContain('deed.pdf: Reads as a trust deed.')
  })

  it('needs review when the latest full year was never uploaded, with one note for it', () => {
    const base = coverage()
    const withGap: StatementCoverage = {
      columns: [
        ...base.columns.slice(0, 4),
        { key: 'fy2027', label: 'FY2027', financialYear: 2027, kind: 'annual', extra: false, notUploaded: true, note: 'Year ended 30 June 2027 not uploaded' },
        { key: 'current', label: 'FY2028 to date', financialYear: 2028, kind: 'current_period', extra: false },
      ],
      rows: {
        income_statement: [own, own, own, own, missing, own],
        balance_sheet: [own, own, own, own, missing, own],
      },
    }
    const item = statusOf(computeReadiness(input({ financials: { coverage: withGap } })), 'financials')
    expect(item.status).toBe('needs_review')
    expect(item.notes).toContain('Latest full year (FY2027) missing: year ended 30 June 2027 not uploaded.')
    expect(item.notes.some((n) => /FY2027 (Profit and Loss|Balance Sheet) is missing/.test(n))).toBe(false)
  })

  it('needs review when there is no comparison', () => {
    const item = statusOf(computeReadiness(input({ financials: { comparison: null } })), 'financials')
    expect(item.status).toBe('needs_review')
    expect(item.detail).toMatch(/Fewer than two annual statements/)
  })
})

describe('reviews', () => {
  const gapInput = (reviews: ReadinessInput['reviews'] = {}) =>
    input({ financials: { coverage: coverage(true, true) }, reviews })

  it('lets a reviewed item through while its data is unchanged', () => {
    const fingerprint = statusOf(computeReadiness(gapInput()), 'financials').fingerprint!
    const r = computeReadiness(gapInput({ financials: { fingerprint, by: 'Sam', at: '2026-10-17T01:00:00Z' } }))
    expect(statusOf(r, 'financials').review).toMatchObject({ by: 'Sam' })
    expect(r.canPredict).toBe(true)
  })

  it('needs a new review once the data changes', () => {
    const r = computeReadiness(gapInput({ financials: { fingerprint: 'an older comparison', by: 'Sam', at: '2026-10-01' } }))
    expect(statusOf(r, 'financials').review).toBeNull()
    expect(r.canPredict).toBe(false)
    expect(r.waitingFor).toEqual(['Financial statements: needs review'])
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

  it('says what it found, and needs review when the export raised warnings', () => {
    expect(statusOf(computeReadiness(input()), 'lodgement').detail).toBe('3 late lodgements, 120 days late in total.')
    const warned = input({ lodgement: { analysis: { id: 'la', analysedAt: 't', warnings: 2, late: 1, daysLate: 5 } } })
    expect(statusOf(computeReadiness(warned), 'lodgement').status).toBe('needs_review')
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

  it('is ready once one notice is read cleanly, listing the rest to check', () => {
    const r = computeReadiness(
      input({ dpn: { notices: [view(notice()), view(notice({ documentId: 'dpn-2', status: 'needs_manual' }))] } }),
    )
    expect(statusOf(r, 'dpn')).toMatchObject({ status: 'ready', detail: '1 notice read (PAYG withholding).' })
    expect(statusOf(r, 'dpn').notes).toEqual(['notice.pdf: needs entering manually.'])
    expect(r.dpn).toBe(true)
  })

  it('needs review when no notice reads cleanly, and the factor is still Yes', () => {
    const r = computeReadiness(input({ dpn: { notices: [view(notice(), ['This notice is for ACN 000 000 019, but the client file has ACN 123 456 780.'])] } }))
    expect(statusOf(r, 'dpn').status).toBe('needs_review')
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
