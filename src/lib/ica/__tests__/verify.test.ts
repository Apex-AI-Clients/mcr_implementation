import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'

vi.mock('@/lib/email/resend', () => ({ sendDeveloperAlert: vi.fn(async () => ({ id: 'e1' })) }))
vi.mock('@/lib/ai/openrouterClient', () => ({ askClaude: vi.fn(), icaProposalsEnabled: vi.fn(() => false) }))

import { sendDeveloperAlert } from '@/lib/email/resend'
import { parseActivityStatementCsv } from '@/lib/analysis/parseActivityStatement'
import { byTaxLine, computeLateLodgement } from '@/lib/analysis/computeLateLodgement'
import { classifyLodgement } from '@/lib/analysis/classifyLodgement'
import { readIcaCsv, readIcaXlsx } from '@/lib/ica'
import { icaFileToCsv } from '@/lib/ica/csv'
import { atoAccountText } from '@/lib/ica/upload'
import { icaViewOf } from '@/lib/ica/view'
import { verificationRecord, verifyAndStoreDocument, verifyIcaFile } from '@/lib/ica/verifyStore'

/** Stage 2: the check on upload, what is stored, and what the pages show. Synthetic rows only. */

type Cells = [string, string, string, string, string, string]
const csv = (rows: Cells[], label = 'Activity statement 002') =>
  [`"${label}"`, '"TEST ENTITY"', 'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance', ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\r\n')

// Yan-Trow's structure: the statement row has no amount, its sub-lines carry it.
const VERIFIES: Cells[] = [
  ['14 Sep 2026', '26 May 2026', "'Original Activity Statement for the period ending 31 Mar 26", '', '', '$1,000.00 DR'],
  ['14 Sep 2026', '26 May 2026', "'- PAYG Withholding", '$400.00', '', '$1,000.00 DR'],
  ['14 Sep 2026', '26 May 2026', "'- GST", '$600.00', '', '$600.00 DR'],
  ['01 Jun 2026', '01 Jun 2026', "'Payment received", '', '$0.00', '$0.00'],
]
// A balance the rows cannot reach (and beyond the 7-day window): not verified.
const DOES_NOT: Cells[] = [
  ['20 Mar 2026', '20 Mar 2026', "'Payment received", '', '$50.00', '$150.00 DR'],
  ['03 Mar 2026', '28 Feb 2026', "'Original Activity Statement for the period ending 31 Dec 25", '$200.00', '', '$150.00 DR'],
  ['01 Feb 2026', '01 Feb 2026', "'Payment received", '', '$10.00', '$0.00'],
]

const storedRows = (rows: Cells[]) => computeLateLodgement(parseActivityStatementCsv(csv(rows))).rows

function workbook(h3 = 1, h4 = 111): Uint8Array {
  const aoa: unknown[][] = [
    ['Activity statement 002'],
    [],
    ['TEST ENTITY', '', '', '', '', '', 'Number  Late Lodgements', h3],
    ['', '', '', '', '', '', 'Cumulative Days Late', h4],
    [],
    [],
    ['Processed date', 'Effective date', 'Description', 'Debit (DR)', 'Credit (CR)', 'Balance'],
    [],
    [46279, 46168, "'Original Activity Statement for the period ending 31 Mar 26", '', '', '$1,000.00 DR'],
    [46279, 46168, "'- PAYG Withholding", 400, '', '$1,000.00 DR'],
    [46279, 46168, "'- GST", 600, '', '$600.00 DR'],
    [46174, 46174, "'Payment received", '', 0, '$0.00'],
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'RBA ICA')
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
}

beforeEach(() => vi.clearAllMocks())

describe('an RBA ICA spreadsheet read as the ATO CSV', () => {
  it('gives the CSV analyses exactly the rows a CSV would', async () => {
    const text = (await atoAccountText(workbook()))!
    expect(readIcaCsv(text).rows).toEqual(readIcaXlsx(workbook()).rows)
    expect(readIcaCsv(text).rows.map((r) => r.rawProcessed)).toEqual(['14 Sep 2026', '14 Sep 2026', '14 Sep 2026', '01 Jun 2026'])
    // The lodgement analysis (and so the prediction's inputs) reads it as it reads a CSV.
    expect(computeLateLodgement(parseActivityStatementCsv(text)).summary).toEqual(computeLateLodgement(parseActivityStatementCsv(csv(VERIFIES))).summary)
    expect(icaFileToCsv(readIcaCsv(csv(VERIFIES)))).toContain('"\'- GST"')
  })

  it('leaves a CSV as it is', async () => {
    expect(await atoAccountText(new TextEncoder().encode(csv(VERIFIES)))).toBe(csv(VERIFIES))
  })
})

describe('the check, as stored', () => {
  it('verified: the balance it proved', async () => {
    const v = await verifyIcaFile(null, readIcaCsv(csv(VERIFIES)))
    expect(v.status).toBe('verified')
    expect(verificationRecord(v)).toMatchObject({ ica_status: 'verified', ica_balance: 1000, ica_balance_date: '2026-09-14' })
  })

  it('not verified: no balance, the window by dates and row positions, and why', async () => {
    const v = await verifyIcaFile(null, readIcaCsv(csv(DOES_NOT)))
    expect(v.status).toBe('unverified')
    expect(verificationRecord(v)).toMatchObject({ ica_status: 'unverified', ica_balance: null, ica_balance_date: null })
    expect(v.check.unmatched[0]).toMatchObject({ days: ['2026-03-03'] })
    expect(JSON.stringify(v.check)).not.toMatch(/Payment received|Activity Statement|TEST ENTITY/)
  })

  it("an RBA ICA spreadsheet whose H3/H4 differ makes it unverified (never both shown)", async () => {
    const v = await verifyIcaFile(null, readIcaCsv(csv(VERIFIES)), { spreadsheet: { lateLodgements: 2, cumulativeDaysLate: 111 } })
    expect(v.status).toBe('unverified')
    expect(v.check.spreadsheet).toEqual({ lateLodgements: 2, cumulativeDaysLate: 111, matches: false })
  })

  it('an export with no rows is empty, not unverified', async () => {
    expect((await verifyIcaFile(null, readIcaCsv(csv([]))) ).status).toBe('empty')
  })
})

describe('verifyAndStoreDocument', () => {
  function db(text: string) {
    const updates: { table: string; values: Record<string, unknown> }[] = []
    const inserts: { table: string; values: Record<string, unknown> }[] = []
    const from = (table: string) => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.in = async () => ({ data: [] })
      chain.is = async () => ({ data: [] })
      chain.maybeSingle = async () => ({ data: table === 'documents' ? { id: 'doc-1', file_path: 'p' } : null })
      chain.update = (values: Record<string, unknown>) => {
        updates.push({ table, values })
        return { eq: async () => ({ error: null }) }
      }
      chain.insert = (values: Record<string, unknown>) => {
        inserts.push({ table, values })
        return { select: () => ({ single: async () => ({ data: { id: 'alert-1' } }) }) }
      }
      return chain
    }
    const supabase = { from, storage: { from: () => ({ download: async () => ({ data: new Blob([text]), error: null }) }) } }
    return { supabase: supabase as never, updates, inserts }
  }

  it('stores a verified check on both analyses, and alerts nobody', async () => {
    const { supabase, updates, inserts } = db(csv(VERIFIES))
    expect(await verifyAndStoreDocument(supabase, 'client-1', 'doc-1')).toEqual({ ok: true, status: 'verified' })
    expect(updates.map((u) => u.table).sort()).toEqual(['ato_account_analyses', 'lodgement_analyses'])
    expect(updates[0].values).toMatchObject({ ica_status: 'verified', ica_balance: 1000 })
    expect(inserts).toEqual([])
    expect(sendDeveloperAlert).not.toHaveBeenCalled()
  })

  it('alerts the developer for a file that is not verified: ids, dates and counts only', async () => {
    const { supabase, inserts, updates } = db(csv(DOES_NOT))
    expect(await verifyAndStoreDocument(supabase, 'client-1', 'doc-1')).toEqual({ ok: true, status: 'unverified' })
    expect(inserts[0]).toMatchObject({ table: 'ica_alerts', values: { client_id: 'client-1', document_id: 'doc-1' } })
    const mail = vi.mocked(sendDeveloperAlert).mock.calls[0][0]
    expect(mail.text).toContain('client-1')
    expect(mail.text).toMatch(/Window 2026-03-03: \d+ rows/)
    expect(`${mail.subject} ${mail.text}`).not.toMatch(/TEST ENTITY|Payment received|Activity Statement|\$/)
    expect(updates.some((u) => u.table === 'ica_alerts' && u.values.emailed_at)).toBe(true)
  })
})

describe('what the pages show', () => {
  it('a verified file: the badge, the composition in the ATO words, the rows as printed', () => {
    const v = icaViewOf({ rows: storedRows(VERIFIES), label: 'Activity statement 002', ica_status: 'verified' })
    expect(v.verified).toBe(true)
    expect(v.badge).toBe("Matches the ATO's own balance: $1,000.00 DR at 14 Sep 2026")
    expect(v.composition?.lines.map((l) => [l.label, l.net])).toEqual([
      ['GST lodged', 600],
      ['PAYG withholding lodged', 400],
      // A row is never hidden, even at $0.00.
      ['Payments', 0],
    ])
    expect(v.lodgedOver90).toEqual({ statements: 1, debit: 1000, byLine: [{ label: 'PAYG withholding lodged', debit: 400 }, { label: 'GST lodged', debit: 600 }] })
    expect(v.asPrinted[1]).toMatchObject({ description: '- PAYG Withholding', debit: '$400.00' })
  })

  it('a statement row printing no amount of its own is never a $0.00 line: it is in the "not counted" note (item 12)', () => {
    const rows: Cells[] = [
      ['20 Sep 2026', '28 Jul 2026', "'Original Activity Statement for the period ending 30 Jun 26", '', '', '$1,000.00 DR'],
      ...VERIFIES,
    ]
    const v = icaViewOf({ rows: storedRows(rows), label: 'Activity statement 002', ica_status: 'verified' })
    expect(v.verified).toBe(true)
    expect(v.composition?.lines.some((l) => /statement/i.test(l.label) && l.net === 0 && l.debit === 0)).toBe(false)
    expect(v.composition?.lines.map((l) => l.label)).toContain('Payments')
    expect(v.composition!.notCounted).toBeGreaterThanOrEqual(v.composition!.noAmountRows)
  })

  it('any other file: no calculated figure at all — late lodgements (dates only) and the rows as printed', () => {
    for (const status of ['unverified', null, 'empty']) {
      const v = icaViewOf({ rows: storedRows(VERIFIES), label: 'Activity statement 002', ica_status: status })
      expect(v).toMatchObject({ verified: false, badge: null, balance: null, composition: null, lodgedOver90: null })
      expect(v.lateLodgements).toEqual({ count: 1, cumulativeDays: 111 })
      expect(v.asPrinted).toHaveLength(4)
    }
  })

  it('stored as verified but not verifying when read again: held back all the same', () => {
    const v = icaViewOf({ rows: storedRows(DOES_NOT), label: 'Activity statement 002', ica_status: 'verified' })
    expect(v.verified).toBe(false)
    expect(v.composition).toBeNull()
  })
})

describe('the DPN estimate: each tax line on its own (GST and PAYG never offset)', () => {
  it("splits a statement into its sub-lines, each with the statement's dates and days late", () => {
    const rows = storedRows(VERIFIES)
    const split = byTaxLine(rows)
    expect(split.map((r) => [r.description, r.debit, r.credit])).toEqual([
      ['Original Activity Statement for the period ending 31 Mar 26', null, null],
      ['Original Activity Statement for the period ending 31 Mar 26 — PAYG Withholding', 400, null],
      ['Original Activity Statement for the period ending 31 Mar 26 — GST', 600, null],
      ['Payment received', null, 0],
    ])
    expect(split[1].lateLodgementDays).toBe(rows[0].lateLodgementDays)
    // The stored rows stay as printed.
    expect(rows[1].description).toBe('- PAYG Withholding')
    expect(computeLateLodgement(parseActivityStatementCsv(csv(VERIFIES))).dpnRisk.window?.grossLateAllHistory).toBe(1000)
    expect(classifyLodgement('- GST')).toBe('SubLine')
  })

  it('a GST credit never reduces PAYG: not in the same statement, not by a later amendment of the period', () => {
    const lines: Cells[] = [
      // Amendment of the same period: GST down by $300 (reduces GST only).
      ['20 Dec 2026', '28 Jul 2026', "'Client initiated amended Activity Statement for the period ending 30 Jun 26", '', '$300.00', '$1,700.00 DR'],
      ['20 Dec 2026', '28 Jul 2026', "'- GST", '', '$300.00', ''],
      // Lodged 145 days late: PAYG $1,500 owed, GST $500 refundable (the statement nets $1,000).
      ['20 Dec 2026', '28 Jul 2026', "'Original Activity Statement for the period ending 30 Jun 26", '$1,000.00', '', '$2,000.00 DR'],
      ['20 Dec 2026', '28 Jul 2026', "'- PAYG Withholding", '$1,500.00', '', ''],
      ['20 Dec 2026', '28 Jul 2026', "'- GST", '', '$500.00', ''],
      ['01 Jul 2026', '01 Jul 2026', "'Original Activity Statement for the period ending 31 Mar 26", '$1,000.00', '', '$1,000.00 DR'],
    ]
    const dpn = computeLateLodgement(parseActivityStatementCsv(csv(lines))).dpnRisk
    expect(dpn.contributingDebits.map((d) => [d.taxLine, d.debit, d.reducedByAmendments])).toEqual([['PAYG Withholding', 1500, 0]])
    expect(dpn.window?.grossLateAllHistory).toBe(1500)
  })
})
