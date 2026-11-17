/**
 * npm run ica:check -- <file.csv|file.xlsx> [more files] [--sheet <rba.xlsx>] [--no-claude] [--save-patterns] [--rows]
 *
 * Runs an ATO account file (CSV or RBA ICA spreadsheet) through the ICA
 * engine (src/lib/ica) and prints:
 *   - the reconciliation against the ATO's running balance, balance day by day;
 *   - the composition lines, in the ATO's words;
 *   - late lodgements (and the spreadsheet's H3/H4 when there is one);
 *   - every window that does not match, with its rows in the ATO's own words;
 *   - VERIFIED or NOT VERIFIED, and why.
 *
 * Windows no known rule matches go to Claude (anonymised rows only, via the
 * OpenRouter client) unless --no-claude or ICA_AI_PROPOSALS=off; an answer is
 * used only if the ATO's balance then matches to the cent. Learned patterns
 * are read from the database when .env has it (read only); --save-patterns
 * stores the patterns of accepted answers.
 *
 * Reads files locally; prints no entity name (the account label only).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { askClaude, icaProposalsEnabled } from '@/lib/ai/openrouterClient'
import { analyseIca, readIcaFile, type IcaAnalysis } from '@/lib/ica'
import { searchHelpers } from '@/lib/ica/compose'
import type { LearnedPattern } from '@/lib/ica/learned'
import { loadPatterns, savePatterns } from '@/lib/ica/patternStore'
import { proposeForUnmatched, type ProposalOutcome } from '@/lib/ica/propose'
import { READING_WORDS } from '@/lib/ica/structures'
import { aud, audBalance, type IcaFile } from '@/lib/ica/types'

try {
  process.loadEnvFile?.('.env')
} catch {
  // No .env: no database patterns and no Claude.
}

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const sheetAt = args.indexOf('--sheet')
const sheetPath = sheetAt >= 0 ? args[sheetAt + 1] : null
const files = args.filter((a, i) => !a.startsWith('--') && (sheetAt < 0 || i !== sheetAt + 1))
if (files.length === 0) {
  console.error('Usage: npm run ica:check -- <file.csv|file.xlsx> [--sheet <rba.xlsx>] [--no-claude] [--save-patterns] [--rows]')
  process.exit(2)
}

const db =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null

const row = (file: IcaFile, id: number) => {
  const r = file.rows[id]
  return `  ${r.rawProcessed.padEnd(12)} ${r.rawEffective.padEnd(12)} ${r.description.slice(0, 78).padEnd(78)} ${r.rawDebit.padStart(13)} ${r.rawCredit.padStart(13)} ${r.rawBalance.padStart(16)}`
}

async function checkOne(target: string, patterns: LearnedPattern[]): Promise<boolean> {
  const file = readIcaFile(new Uint8Array(readFileSync(target)))
  const sheet = sheetPath ? readIcaFile(new Uint8Array(readFileSync(sheetPath))).spreadsheet : null
  console.log(`\n══ ${path.basename(target)}`)
  console.log(`   ${file.label || '(no label)'} · ${file.kind} · ${file.source} · ${file.rows.length} rows · printed ${file.printOrder.replace('_', ' ')}`)

  let analysis: IcaAnalysis = analyseIca(file, { patterns, spreadsheet: sheet })
  let outcomes: ProposalOutcome[] = []
  if (analysis.reconciliation.unmatched.length > 0 && !flag('--no-claude')) {
    if (!icaProposalsEnabled()) console.log('   Claude proposals are off (no OPENROUTER_API_KEY, or ICA_AI_PROPOSALS=off).')
    else {
      const run = await proposeForUnmatched(file, async (prompt) => askClaude({ purpose: 'ica', prompt, maxTokens: 6000, label: 'ica-window', timeoutMs: 120_000 }), {
        patterns,
      })
      outcomes = run.outcomes
      analysis = analyseIca(file, { patterns, forced: run.forced, spreadsheet: sheet })
      for (const m of analysis.reconciliation.matched) {
        const claude = run.reconciliation.matched.find((x) => x.days.join() === m.days.join() && x.method === 'claude')
        if (claude) m.method = 'claude'
      }
      if (flag('--save-patterns') && db) {
        for (const o of outcomes.filter((x) => x.status === 'accepted' && x.patterns?.length)) {
          const saved = await savePatterns(db, o.patterns!, { model: o.model, generationId: o.generationId })
          console.log(`   Patterns saved: ${saved.saved}${saved.conflicts.length ? `; ${saved.conflicts.length} contradict a saved pattern (kept as saved)` : ''}`)
        }
      }
    }
  }

  const rec = analysis.reconciliation
  const count = (m: string) => rec.matched.filter((w) => w.method === m).length
  console.log('\n── Reconciliation against the ATO\'s running balance')
  console.log(
    `   ${rec.balanceDays} balance days (the first is the starting point) · matched day by day ${count('day')} · by another reading ${count('reading')} · by a learned pattern ${count('learned')} · by Claude ${count('claude')} · widened (≤ 7 days) ${count('widened')} · NOT matched ${rec.unmatched.length}`,
  )
  if (rec.unreadDateRows) console.log(`   ${rec.unreadDateRows} row(s) with a date that cannot be read.`)
  for (const m of rec.matched) {
    const changed = m.readingsChanged.length ? `  readings: ${m.readingsChanged.map((c) => READING_WORDS[c.reading as keyof typeof READING_WORDS] ?? c.reading).join('; ')}` : ''
    console.log(`   ${m.days.join(' + ').padEnd(24)} ${m.method.padEnd(8)} ${audBalance(m.from).padStart(16)} ${(m.movement >= 0 ? '+' : '') + aud(m.movement)}`.padEnd(72) + ` = ${audBalance(m.to)}${changed}`)
  }

  for (const u of rec.unmatched) {
    console.log(`\n   ✗ ATO entries ${u.days.length > 1 ? `from ${u.days[0]} to ${u.days[u.days.length - 1]}` : `on ${u.days[0]}`} that don't match the ATO's balance change`)
    console.log(`     from ${u.fromCandidates.map(audBalance).join(' / ')} to ${u.toCandidates.map(audBalance).join(' / ')}: the counted rows move ${aud(u.movement)}; the ATO's balance moved ${aud(u.needed)} (${u.reason.replace(/_/g, ' ')})`)
    for (const id of u.rowIds.slice(0, 60)) console.log(row(file, id))
    if (u.rowIds.length > 60) console.log(`  … ${u.rowIds.length - 60} more rows`)
  }
  for (const o of outcomes) {
    console.log(`\n   Claude, ${o.window.days[0]}…${o.window.days[o.window.days.length - 1]}: ${o.status.toUpperCase()} — ${o.note}`)
    if (o.explanation) console.log(`     "${o.explanation}"`)
    if (o.patterns?.length) for (const p of o.patterns) console.log(`     learned: ${p.printed.replace('_', ' ')} "${p.wording}" → ${p.count ? 'counts' : 'does not count'}`)
  }

  console.log('\n── Late lodgements (RBA ICA rule: "Activity Statement" rows, processed − effective, negative = 0)')
  const late = analysis.lateLodgements
  console.log(late.count === null ? '   Not given: some dates cannot be read.' : `   ${late.count} late lodgements, ${late.cumulativeDays} days`)
  if (analysis.spreadsheetCheck) {
    const s = analysis.spreadsheetCheck
    console.log(`   Spreadsheet H3/H4: ${s.spreadsheet.lateLodgements} / ${s.spreadsheet.cumulativeDaysLate} → ${s.matches ? 'MATCHES' : 'DIFFERS'}`)
  }

  if (analysis.composition) {
    const c = analysis.composition
    console.log('\n── Composition (every line in the ATO\'s words)')
    const line = (label: string, amount: number, extra = '') => console.log(`   ${label.slice(0, 58).padEnd(58)} ${aud(amount).padStart(16)}${extra}`)
    line('Balance brought forward', c.opening)
    let section = ''
    for (const l of c.lines) {
      if (section === 'penalties' || section === 'interest' || section === 'tax') {
        if (!['tax', 'interest', 'penalties'].includes(l.section)) line('= ATO debt', c.atoDebt)
      }
      section = l.section
      line(`${l.named ? '' : '"'}${l.label}${l.named ? '' : '"'}`, l.net, `   ${l.parts.length} rows · search: ${searchHelpers(l).slice(0, 2).join(' | ')}`)
    }
    if (['tax', 'interest', 'penalties'].includes(section)) line('= ATO debt', c.atoDebt)
    line(`= ATO balance${c.atoBalanceDate ? ` at ${c.atoBalanceDate}` : ''}`, c.total, c.atoBalance === c.total ? '   (matches the ATO\'s own balance)' : `   ATO prints ${aud(c.atoBalance ?? 0)}`)
    console.log(`   ${c.notCounted.length} rows not counted (each listed with its reason: a total or breakdown of a counted row)`)
    const over = analysis.lodgedOver90DaysLate ?? []
    const byLine = new Map<string, number>()
    for (const s of over) for (const a of s.amounts) byLine.set(a.label, (byLine.get(a.label) ?? 0) + a.debit)
    console.log(`   Lodged more than 90 days late: ${over.length} statements, ${aud(over.reduce((s, x) => s + x.debit, 0))}${byLine.size ? ` (${[...byLine].map(([k, v]) => `${k} ${aud(v)}`).join(', ')})` : ''}`)
    if (flag('--rows')) for (const l of c.lines) {
      console.log(`\n   ${l.label}`)
      for (const p of l.parts) console.log(row(file, p.rowId))
    }
  }

  console.log(`\n${analysis.verified ? '✓ VERIFIED' : '✗ NOT VERIFIED'}${analysis.verified ? ` — matches the ATO's own balance: ${audBalance(rec.atoBalance!)} at ${rec.atoBalanceDate}` : ` — ${analysis.holdReasons.join('; ')}`}`)
  return analysis.verified
}

;(async () => {
  const patterns = db ? await loadPatterns(db) : []
  if (patterns.length) console.log(`${patterns.length} learned pattern(s) loaded.`)
  let all = true
  for (const f of files) {
    try {
      all = (await checkOne(f, patterns)) && all
    } catch (e) {
      all = false
      console.log(`\n══ ${path.basename(f)}\n✗ NOT READ — ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  process.exit(all ? 0 : 1)
})()
