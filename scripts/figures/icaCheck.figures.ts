import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { analyseIca, readIcaFile, readStoredRows } from '@/lib/ica'

/**
 * The ICA engine (src/lib/ica) against its answer keys, all gitignored:
 * verified-figures/ica/keys.json (the RBA ICA spreadsheets' H3/H4, the ATO's
 * balance on each file's newest row, Yan-Trow's figures from Tom's sheet), and
 * every ATO account stored in the database (ica/stored, copied read-only).
 * Every file must be VERIFIED: every balance window matches and the whole
 * file reconciles to the ATO's own balance. Prints aliases and figures only.
 */

const DIR = path.resolve(__dirname, '../../verified-figures')
const KEYS = path.join(DIR, 'ica/keys.json')

interface Key {
  alias: string
  file: string
  sheet?: string
  expect: {
    rows?: number
    atoBalance?: number
    atoBalanceDate?: string
    opening?: number
    lateLodgements?: number
    cumulativeDaysLate?: number
    lines?: Record<string, { net: number; rows: number }>
    over90?: { statements: number; debit: number; byLine: Record<string, number> }
  }
}

const cents = (d: number) => Math.round(d * 100)

it.skipIf(!existsSync(KEYS))('ICA engine: every answer-key file verifies and gives its expected figures', () => {
  const keys = JSON.parse(readFileSync(KEYS, 'utf8')).files as Key[]
  const problems: string[] = []
  const table: string[] = []
  for (const k of keys) {
    const at = path.join(DIR, k.file)
    if (!existsSync(at)) {
      problems.push(`${k.alias}: file missing`)
      continue
    }
    const file = readIcaFile(new Uint8Array(readFileSync(at)))
    const sheet = k.sheet ? readIcaFile(new Uint8Array(readFileSync(path.join(DIR, k.sheet)))).spreadsheet : null
    const a = analyseIca(file, { spreadsheet: sheet })
    const r = a.reconciliation
    const diff = (what: string, got: unknown, want: unknown) => {
      if (got !== want) problems.push(`${k.alias}: ${what} ${String(got)} ≠ ${String(want)}`)
    }
    if (!a.verified) problems.push(`${k.alias}: NOT VERIFIED (${a.holdReasons.join('; ')})`)
    const e = k.expect
    if (e.rows !== undefined) diff('rows', file.rows.length, e.rows)
    if (e.atoBalance !== undefined) diff('ATO balance', r.atoBalance, cents(e.atoBalance))
    if (e.atoBalanceDate !== undefined) diff('balance date', r.atoBalanceDate, e.atoBalanceDate)
    if (e.opening !== undefined) diff('brought forward', r.opening, cents(e.opening))
    if (e.lateLodgements !== undefined) diff('late lodgements', a.lateLodgements.count, e.lateLodgements)
    if (e.cumulativeDaysLate !== undefined) diff('days late', a.lateLodgements.cumulativeDays, e.cumulativeDaysLate)
    for (const [key, want] of Object.entries(e.lines ?? {})) {
      const line = a.composition?.lines.find((l) => l.key === key)
      diff(`${key} net`, line?.net, cents(want.net))
      diff(`${key} rows`, line?.parts.length, want.rows)
    }
    if (e.over90) {
      const over = a.lodgedOver90DaysLate ?? []
      diff('>90 statements', over.length, e.over90.statements)
      diff('>90 debit', over.reduce((s, x) => s + x.debit, 0), cents(e.over90.debit))
      for (const [key, want] of Object.entries(e.over90.byLine)) {
        diff(`>90 ${key}`, over.flatMap((s) => s.amounts).filter((x) => x.key === key).reduce((s, x) => s + x.debit, 0), cents(want))
      }
    }
    if (a.spreadsheetCheck && !a.spreadsheetCheck.matches) problems.push(`${k.alias}: differs from its RBA ICA spreadsheet`)
    const by = (m: string) => r.matched.filter((w) => w.method === m).length
    table.push(`${k.alias.padEnd(16)} ${a.verified ? 'VERIFIED    ' : 'NOT VERIFIED'} days ${String(r.balanceDays - 1).padStart(3)}: day ${by('day')}, reading ${by('reading')}, learned ${by('learned')}, claude ${by('claude')}, widened ${by('widened')}, unmatched ${r.unmatched.length} · late ${a.lateLodgements.count}/${a.lateLodgements.cumulativeDays}`)
  }

  const stored = path.join(DIR, 'ica/stored')
  if (existsSync(stored)) {
    for (const f of readdirSync(stored).filter((x) => x.endsWith('.rows.json')).sort()) {
      const j = JSON.parse(readFileSync(path.join(stored, f), 'utf8'))
      const file = readStoredRows(j.rows, { label: j.label ?? (f.includes('.aaa-') ? 'Income tax' : 'Activity statement') })
      const alias = f.replace('.rows.json', '')
      if (!file) {
        problems.push(`${alias}: stored rows not readable`)
        continue
      }
      const a = analyseIca(file)
      const r = a.reconciliation
      if (!a.verified) problems.push(`${alias}: NOT VERIFIED (${a.holdReasons.join('; ')})`)
      table.push(`${alias.padEnd(28)} ${a.verified ? 'VERIFIED    ' : 'NOT VERIFIED'} days ${String(r.balanceDays - 1).padStart(3)}, unmatched ${r.unmatched.length}`)
    }
  }

  console.log(`\nICA engine answer keys\n${table.join('\n')}\n${problems.length ? `\n${problems.length} problem(s):\n${problems.join('\n')}` : '\nAll answer keys pass.'}`)
  expect(problems).toEqual([])
})
