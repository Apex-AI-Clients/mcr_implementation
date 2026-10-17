// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { columnLabels, describeDaysLeft, summariseNotices } from '../summary'
import { buildDpnCsv } from '../exportCsv'
import { buildDpnPdf, pdfSafe } from '../exportPdf'
import { readPdfPageLines } from '@/lib/pdf/pageLines'
import { dpnDeadline } from '../checks'
import type { DpnNoticeView } from '../view'
import type { StoredNotice } from '../stored'
import type { DpnRow, DpnType } from '../types'
import { SYNTHETIC } from './fixtures/notice'

/**
 * The DPN summary rules and its exports. Synthetic names and figures only.
 */

function row(from: string, to: string, c2: number, c3: number, c4: number, c5: number): DpnRow {
  return { periodFrom: from, periodTo: to, column2: c2, column3: c3, column4: c4, column5: c5 }
}

const Q1 = (c3: number, c4: number) => row('2025-01-01', '2025-03-31', c3, c3, c4, c3 - c4)
const Q2 = (c3: number, c4: number) => row('2025-04-01', '2025-06-30', c3, c3, c4, c3 - c4)

let nextId = 1
function view(options: {
  type?: DpnType
  director?: string
  issuedOn?: string
  rows?: DpnRow[]
  source?: 'parsed' | 'manual'
  status?: StoredNotice['status']
  issues?: string[]
  read?: boolean
}): DpnNoticeView {
  const id = `doc-${nextId++}`
  const issuedOn = options.issuedOn ?? '2026-09-30'
  const notice: StoredNotice = {
    id: `n-${id}`,
    documentId: id,
    source: options.source ?? 'parsed',
    status: options.status ?? 'read',
    manualReason: options.status === 'needs_manual' ? 'table_unreadable' : null,
    reviewReasons: [],
    reference: `REF-${id}`,
    issuedOn,
    type: options.type ?? 'paygw',
    companyName: 'EXAMPLE TRADING PTY LTD',
    acn: '000000019',
    directorName: options.director ?? 'MR JANE Q SAMPLE',
    rows: options.rows ?? [Q1(1_000_00, 600_00)],
    totals: null,
    enteredBy: null,
    enteredAt: null,
  }
  return {
    documentId: id,
    filename: `${id}.pdf`,
    notice: options.read === false ? null : notice,
    issues: options.issues ?? [],
    deadline: options.read === false ? null : dpnDeadline(issuedOn),
  }
}

const TODAY = '2026-10-17'

describe('summariseNotices — current and history', () => {
  it('makes the newest notice per director and type current, and totals only that', () => {
    const older = view({ issuedOn: '2026-03-01', rows: [Q1(5_000_00, 5_000_00)] })
    const newer = view({ issuedOn: '2026-09-30', rows: [Q1(1_000_00, 600_00)] })
    const summary = summariseNotices([older, newer], TODAY)

    expect(summary.notices.map((n) => [n.documentId, n.standing])).toEqual([
      [newer.documentId, 'current'],
      [older.documentId, 'history'],
    ])
    expect(summary.companyByType[0].totals.column3).toBe(1_000_00)
    expect(summary.directors[0].overall.column3).toBe(1_000_00)
  })

  it('treats differently printed names of one director as one person', () => {
    const summary = summariseNotices(
      [
        view({ director: 'MR JANE Q SAMPLE', issuedOn: '2026-09-30' }),
        view({ director: 'MS J SAMPLE', issuedOn: '2026-03-01' }),
      ],
      TODAY,
    )
    expect(summary.directors).toHaveLength(1)
    expect(summary.notices.map((n) => n.standing)).toEqual(['current', 'history'])
  })

  it('keeps PAYG withholding and GST apart, each with its own current notice', () => {
    const summary = summariseNotices([view({ type: 'paygw' }), view({ type: 'gst' })], TODAY)
    expect(summary.notices.every((n) => n.standing === 'current')).toBe(true)
    expect(summary.companyByType.map((t) => t.type)).toEqual(['paygw', 'gst'])
  })
})

describe('summariseNotices — directors and the company', () => {
  it('counts a period shared by two directors once for the company, from the newer notice', () => {
    const jane = view({ director: 'Jane Sample', issuedOn: '2026-09-30', rows: [Q1(1_000_00, 600_00), Q2(2_000_00, 0)] })
    // Raj's notice is older and shows Q1 before a payment.
    const raj = view({ director: 'Raj Example', issuedOn: '2026-08-01', rows: [Q1(1_500_00, 900_00)] })
    const summary = summariseNotices([jane, raj], TODAY)

    expect(summary.directors.map((d) => [d.directorName, d.overall.column3])).toEqual([
      ['Jane Sample', 3_000_00],
      ['Raj Example', 1_500_00],
    ])
    // Q1 from Jane's newer notice (1,000) + Q2 (2,000), not 4,500.
    expect(summary.companyByType[0]).toMatchObject({ periods: 2, totals: { column3: 3_000_00, column4: 600_00 } })
    expect(summary.company.column3).toBe(3_000_00)
  })

  it('gives each type its earliest current deadline', () => {
    const summary = summariseNotices(
      [
        view({ director: 'Jane Sample', issuedOn: '2026-09-30' }),
        view({ director: 'Raj Example', issuedOn: '2026-09-20' }),
      ],
      TODAY,
    )
    expect(summary.companyByType[0].earliestDeadline).toBe('2026-10-11')
  })

  it('leaves out notices that are unread or waiting for manual entry', () => {
    const waiting = [view({ read: false }), view({ status: 'needs_manual' })]
    const summary = summariseNotices([view({}), ...waiting], TODAY)
    expect(summary.waiting.map((w) => w.documentId)).toEqual(waiting.map((w) => w.documentId))
    expect(summary.notices).toHaveLength(1)
  })

  it('counts days left from today', () => {
    const [notice] = summariseNotices([view({ issuedOn: '2026-09-30' })], TODAY).notices
    expect(notice.daysLeft).toBe(4)
  })
})

describe('labels', () => {
  it('follows the notice wording, with the deadline in Column 4', () => {
    expect(columnLabels('paygw', '2026-10-21')).toEqual({
      column2: 'Amount withheld',
      column3: 'Unpaid',
      column4:
        'Removed if the company appoints an SBR practitioner, administrator or liquidator, or pays, by 21 Oct 2026',
      column5: 'Stays with the director unless paid',
    })
    expect(columnLabels('gst', null).column2).toBe('Net amount from the latest activity statement')
  })

  it.each([
    [4, '4 days left'],
    [1, '1 day left'],
    [0, 'Due today'],
    [-1, 'Passed 1 day ago'],
    [-3, 'Passed 3 days ago'],
  ])('says %i days as "%s"', (days, text) => {
    expect(describeDaysLeft(days)).toBe(text)
  })
})

const META = { clientName: 'Example Trading', asAtIso: TODAY }

function sampleSummary() {
  return summariseNotices(
    [
      view({ type: 'paygw', director: SYNTHETIC.director, rows: [Q1(1_000_00, 600_00)], issues: ['Check, this "row"'] }),
      view({ type: 'gst', director: SYNTHETIC.director, source: 'manual', rows: [Q2(2_000_00, 500_00)] }),
      view({ read: false }),
    ],
    TODAY,
  )
}

describe('buildDpnCsv', () => {
  const csv = buildDpnCsv(sampleSummary(), META)

  it('carries the company totals with their plain-English labels', () => {
    expect(csv).toContain('PAYG withholding,Column 3,Unpaid,1000.00')
    expect(csv).toContain(
      'PAYG withholding,Column 4,"Removed if the company appoints an SBR practitioner, administrator or liquidator, or pays, by 21 Oct 2026",600.00',
    )
  })

  it('marks how each notice was read, and escapes free text', () => {
    expect(csv).toContain('Read automatically,"Check, this ""row"""')
    expect(csv).toContain('Entered manually')
  })

  it('lists files not in the totals, and says where the figures come from', () => {
    expect(csv).toMatch(/Not in the totals/)
    expect(csv.trim().split('\r\n').pop()).toBe(
      '"Figures come from ATO director penalty notices supplied by the client, read automatically or entered manually as marked."',
    )
  })

  it('holds no address', () => {
    expect(csv).not.toContain(SYNTHETIC.street)
    expect(csv).not.toContain(SYNTHETIC.suburb)
  })
})

describe('buildDpnPdf', () => {
  it('is real text, with the source note and page number on every page', async () => {
    const bytes = await buildDpnPdf(sampleSummary(), META)
    const { pages } = await readPdfPageLines(bytes, 20)
    const text = pages.map((p) => p.join('\n'))

    expect(text[0]).toContain('Director penalty notices')
    expect(text[0]).toContain('What the company owes, by type')
    expect(text.join('\n')).toContain('$1,000.00')
    expect(text.join('\n')).toMatch(/or pays, by 21 Oct 2026/)
    text.forEach((page, i) => {
      expect(page).toContain(
        'Figures come from ATO director penalty notices supplied by the client, read automatically or entered manually as marked.',
      )
      expect(page).toContain(`Page ${i + 1} of ${text.length}`)
    })
    expect(text.join('\n')).not.toContain(SYNTHETIC.street)
  })

  it('runs onto more pages when there are many notices', async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      view({ director: `Director ${String.fromCharCode(65 + (i % 26))}${i} Example`, issuedOn: '2026-09-30' }),
    )
    const { pages } = await readPdfPageLines(await buildDpnPdf(summariseNotices(many, TODAY), META), 20)
    expect(pages.length).toBeGreaterThan(1)
  })

  it('folds characters the PDF font cannot draw rather than failing', () => {
    expect(pdfSafe('Zoë Ngụyễn — “Ltd”')).toBe('Zoe Nguyen - "Ltd"')
    expect(pdfSafe('李')).toBe('?')
  })
})
