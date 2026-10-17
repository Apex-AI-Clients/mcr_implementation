import { it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { readDirectorPenaltyNotice } from '@/lib/dpn/extractText'
import { checkDirectorPenaltyNotice, dpnDeadline } from '@/lib/dpn/checks'
import { summariseNotices } from '@/lib/dpn/summary'
import { buildDpnCsv } from '@/lib/dpn/exportCsv'
import { buildDpnPdf } from '@/lib/dpn/exportPdf'
import type { DpnNoticeView } from '@/lib/dpn/view'
import type { DirectorPenaltyNotice, DpnAmounts, DpnType } from '@/lib/dpn/types'
import { readPdfPageCells, readPdfPageLines } from '@/lib/pdf/pageLines'
import { DIR, out, readJson } from './figures'

/**
 * `npm run figures:dpn` — no database. Parses every PDF in /dpn-samples/
 * (gitignored) with the CURRENT parser and compares each notice with
 * verified-figures/dpn.expected.json, keyed by notice type.
 *
 * Prints notice types, dates, counts and totals only — never a name, a
 * reference, an ACN, a filename or an address. Field presence is printed as
 * found / MISSING, not as the value.
 */

const SAMPLES = path.resolve(process.cwd(), 'dpn-samples')

type Expected = {
  notices: Partial<Record<DpnType, { issuedOn: string; rows: number; totals: DpnAmounts }>>
}

const dollars = (cents: number) =>
  (cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

it('reads the DPN samples and matches the verified figures', async () => {
  if (!existsSync(SAMPLES)) {
    out('No /dpn-samples/ folder. Nothing to check.')
    return
  }
  const expected = readJson<Expected>('dpn.expected.json')
  const files = readdirSync(SAMPLES).filter((name) => name.toLowerCase().endsWith('.pdf'))
  let failures = 0
  const parsedNotices: DirectorPenaltyNotice[] = []
  /** The lines under each notice's "TO:" line: its address. In memory only, never printed. */
  const addressLines: string[] = []

  for (const [index, file] of files.entries()) {
    const label = `sample ${index + 1}`
    const bytes = new Uint8Array(readFileSync(path.join(SAMPLES, file)))
    const { pages } = await readPdfPageCells(bytes, 12)
    for (const page of pages) {
      const to = page.findIndex((line) => /^TO:/.test(line.cells[0]?.text ?? ''))
      if (to >= 0) addressLines.push(...page.slice(to + 1, to + 3).map((line) => line.text))
    }
    const result = await readDirectorPenaltyNotice(bytes)
    if (result.kind !== 'parsed') {
      out(`${label}: ${result.kind}${result.kind === 'needs_manual' ? ` (${result.reason}; missing: ${result.missing.join(', ') || 'none'})` : ''}`)
      failures++
      continue
    }

    const { notice } = result
    parsedNotices.push(notice)
    const fields = (['reference', 'companyName', 'acn', 'directorName'] as const)
      .map((key) => `${key} ${notice[key] ? 'found' : 'MISSING'}`)
      .join(', ')
    // Compared with itself only: the client's file is not in this check.
    const rowChecks = checkDirectorPenaltyNotice(notice, { acn: notice.acn, directors: [{ name: notice.directorName }] })
    out(`${label}: ${notice.type}, issued ${notice.issuedOn}, deadline ${dpnDeadline(notice.issuedOn)}, ${notice.rows.length} rows`)
    out(`  ${fields}`)
    out(`  checks: ${rowChecks.length === 0 ? 'none' : rowChecks.map((c) => c.code).join(', ')}`)
    out(
      `  totals: col2 ${dollars(notice.totals.column2)} | col3 ${dollars(notice.totals.column3)} | col4 ${dollars(notice.totals.column4)} | col5 ${dollars(notice.totals.column5)}`,
    )

    const want = expected?.notices[notice.type]
    if (!want) {
      out('  no expected figures for this type')
      continue
    }
    const differences: string[] = []
    if (want.issuedOn !== notice.issuedOn) differences.push(`issuedOn ${notice.issuedOn} ≠ ${want.issuedOn}`)
    if (want.rows !== notice.rows.length) differences.push(`rows ${notice.rows.length} ≠ ${want.rows}`)
    for (const key of ['column2', 'column3', 'column4', 'column5'] as const) {
      if (want.totals[key] !== notice.totals[key]) {
        differences.push(`${key} ${dollars(notice.totals[key])} ≠ ${dollars(want.totals[key])}`)
      }
    }
    out(differences.length === 0 ? '  matches expected' : `  DIFFERS: ${differences.join('; ')}`)
    failures += differences.length > 0 || rowChecks.length > 0 ? 1 : 0
  }

  // ── The summary and its exports, from the real notices ──────────────────
  const asAtIso = new Date().toISOString().slice(0, 10)
  const views: DpnNoticeView[] = parsedNotices.map((notice, i) => ({
    documentId: `sample-${i + 1}`,
    filename: `sample-${i + 1}.pdf`,
    notice: {
      id: `n${i}`,
      documentId: `sample-${i + 1}`,
      source: 'parsed',
      status: 'read',
      manualReason: null,
      reviewReasons: [],
      ...notice,
      enteredBy: null,
      enteredAt: null,
    },
    issues: [],
    deadline: dpnDeadline(notice.issuedOn),
  }))
  const summary = summariseNotices(views, asAtIso)
  out('')
  out(`summary: ${summary.notices.length} notices, ${summary.directors.length} director(s), ${summary.waiting.length} waiting`)
  for (const t of summary.companyByType) {
    const own = parsedNotices.find((n) => n.type === t.type)!.totals
    const same = (['column2', 'column3', 'column4', 'column5'] as const).every((k) => own[k] === t.totals[k])
    out(`  company ${t.type}: col3 ${dollars(t.totals.column3)} | col4 ${dollars(t.totals.column4)} | col5 ${dollars(t.totals.column5)} — ${same ? 'equals the notice' : 'DIFFERS from the notice'}`)
    if (!same) failures++
  }

  const meta = { clientName: 'Sample client', asAtIso }
  const csv = buildDpnCsv(summary, meta)
  const pdf = await buildDpnPdf(summary, meta)
  const pdfText = (await readPdfPageLines(pdf, 20)).pages.flat().join('\n')
  const leaks = addressLines.filter((line) => line && (csv.includes(line) || pdfText.includes(line)))
  out(`  address lines checked: ${addressLines.length}; found in CSV or PDF: ${leaks.length === 0 ? 'none' : leaks.length}`)
  if (addressLines.length === 0 || leaks.length > 0) failures++

  // For a look by eye. verified-figures/ is gitignored.
  writeFileSync(path.join(DIR, 'dpn-summary.sample.csv'), '\uFEFF' + csv)
  writeFileSync(path.join(DIR, 'dpn-summary.sample.pdf'), pdf)
  out('  wrote verified-figures/dpn-summary.sample.csv and .pdf')

  expect(failures).toBe(0)
})
