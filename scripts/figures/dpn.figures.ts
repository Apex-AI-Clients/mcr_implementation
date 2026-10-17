import { it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'fs'
import path from 'path'
import { readDirectorPenaltyNotice } from '@/lib/dpn/extractText'
import { checkDirectorPenaltyNotice, dpnDeadline } from '@/lib/dpn/checks'
import type { DpnAmounts, DpnType } from '@/lib/dpn/types'
import { out, readJson } from './figures'

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

  for (const [index, file] of files.entries()) {
    const label = `sample ${index + 1}`
    const result = await readDirectorPenaltyNotice(new Uint8Array(readFileSync(path.join(SAMPLES, file))))
    if (result.kind !== 'parsed') {
      out(`${label}: ${result.kind}${result.kind === 'needs_manual' ? ` (${result.reason}; missing: ${result.missing.join(', ') || 'none'})` : ''}`)
      failures++
      continue
    }

    const { notice } = result
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

  expect(failures).toBe(0)
})
