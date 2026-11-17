import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { analyseIca, readIcaFile, readStoredRows } from '@/lib/ica'
import { atoAccountText } from '@/lib/ica/upload'
import { computeLateLodgement } from '@/lib/analysis/computeLateLodgement'
import { parseActivityStatementCsv } from '@/lib/analysis/parseActivityStatement'
import { lateSinceNil } from '@/lib/analysis/lateList'

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
    /** The DPN card: lodged more than 90 days late since the balance was last nil (computeDpnRisk). */
    dpnSinceNil?: { since: string | null; total: number; gst: number; paygw: number }
  }
}

const cents = (d: number) => Math.round(d * 100)

it.skipIf(!existsSync(KEYS))('ICA engine: every answer-key file verifies and gives its expected figures', async () => {
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
    if (e.dpnSinceNil) {
      const text = await atoAccountText(new Uint8Array(readFileSync(at)))
      const card = lateSinceNil(computeLateLodgement(parseActivityStatementCsv(text!)).dpnRisk)
      diff('since-nil date', card.since, e.dpnSinceNil.since)
      diff('since-nil total', Math.round(card.total * 100), cents(e.dpnSinceNil.total))
      diff('since-nil GST', Math.round(card.gst * 100), cents(e.dpnSinceNil.gst))
      diff('since-nil PAYG', Math.round(card.paygw * 100), cents(e.dpnSinceNil.paygw))
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

/**
 * Director penalty notices (dpn/proof.ts) against their answer keys: each real
 * notice (periods and amounts only, gitignored ica/notices) must add up, give
 * the expected totals (Columns 2–5), and match its client's verified ATO account
 * on every period.
 */
const NOTICES = path.join(DIR, 'ica/notices')
it.skipIf(!existsSync(NOTICES))('director penalty notices: each adds up, gives its totals, and matches the ATO account', async () => {
  const { proveNotice, noticeAccountFrom } = await import('@/lib/dpn/proof')
  const { reconcile } = await import('@/lib/ica/reconcile')
  const problems: string[] = []
  const table: string[] = []
  for (const f of readdirSync(NOTICES).filter((x) => x.endsWith('.json')).sort()) {
    const key = JSON.parse(readFileSync(path.join(NOTICES, f), 'utf8'))
    const file = readIcaFile(new Uint8Array(readFileSync(path.join(DIR, key.account))))
    const account = noticeAccountFrom([{ file, reconciliation: reconcile(file) }])
    for (const n of key.notices) {
      const proof = proveNotice({ type: n.type, issuedOn: n.issuedOn, acn: 'on file', rows: n.rows, totals: null }, account)
      const want = key.expect[n.type]
      const totals = (['column2', 'column3', 'column4', 'column5'] as const).map((c) => n.rows.reduce((s: number, r: Record<string, number>) => s + r[c], 0))
      const alias = `${f.replace('.json', '')} ${n.type}`
      if (want && n.rows.length !== want.periods) problems.push(`${alias}: ${n.rows.length} periods ≠ ${want.periods}`)
      if (want && totals.join() !== want.totals.join()) problems.push(`${alias}: totals ${totals.join(' / ')} ≠ ${want.totals.join(' / ')}`)
      if (proof.status !== 'verified' || !proof.badges.includes('Matches the ATO account')) problems.push(`${alias}: ${proof.badges.join(', ') || 'not proven'}`)
      table.push(`${alias.padEnd(16)} ${n.rows.length} periods · 3 = 4 + 5 on all: ${proof.addsUp} · Column 2 = ATO account on ${proof.account?.matched}/${proof.account?.periods} · ${proof.badges.join(' · ')}`)
    }
  }
  console.log(`\nDirector penalty notices\n${table.join('\n')}${problems.length ? `\n${problems.join('\n')}` : '\nAll notice keys pass.'}`)
  expect(problems).toEqual([])
})
