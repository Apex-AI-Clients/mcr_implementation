import { it } from 'vitest'
import {
  assemble,
  predictionDebt,
  compare,
  describeDifference,
  flatten,
  out,
  readJson,
  snapshotAliases,
  writeJson,
  type Figures,
  type Snapshot,
} from './figures'

/**
 * `npm run figures:check` — no database. For each snapshot in
 * verified-figures/, rebuilds the comparison with the CURRENT code (the
 * extraction-time line corrections replayed, then the comparison assembly)
 * and prints every difference from verified-figures/<alias>.expected.json.
 *
 * Without an expected file, writes <alias>.draft.json with every figure:
 * check it against the statements, keep only verified keys, and save it as
 * <alias>.expected.json.
 *
 * Prints aliases, schema keys and figures only — never a client's name, a
 * filename or a free-text label.
 */
it('compares a fresh comparison with the verified figures', () => {
  const aliases = snapshotAliases()
  if (aliases.length === 0) {
    out('No snapshots in verified-figures/. Run `npm run figures:snapshot` first.')
    return
  }
  let failing = 0
  for (const alias of aliases) {
    const snapshot = readJson<Snapshot>(`${alias}.snapshot.json`)!
    const comparison = assemble(snapshot, true)
    out('')
    out(`── ${alias} (snapshot ${snapshot.takenAt.slice(0, 10)}) ──`)
    if (!comparison) {
      out('  fewer than 2 annual statements: nothing to compare')
      failing++
      continue
    }
    const actual = flatten(comparison)

    // Checks by sort, without messages (they name files).
    const counts = new Map<string, number>()
    for (const c of comparison.checks ?? []) {
      const k = `${c.severity} ${c.group ?? c.kind}`
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    out(`  checks: ${[...counts.entries()].sort().map(([k, n]) => `${k} ×${n}`).join(', ') || 'none'}`)

    // Statements whose lines did not add up, and why (sections and figures only).
    for (const slot of snapshot.slots) {
      for (const half of [slot.incomeStatement, slot.balanceSheet]) {
        for (const w of half?.warnings ?? []) {
          if (w.kind === 'lines_incomplete') out(`  lines did not add up — FY${slot.financialYear} ${slot.sourceColumn}: ${w.message}`)
        }
      }
    }

    const expectedFile = readJson<Figures & { prediction?: { atoDebt?: number; asOf?: string } }>(`${alias}.expected.json`)
    const debt = predictionDebt(snapshot)
    if (!expectedFile) {
      writeJson(`${alias}.draft.json`, actual)
      out(`  no ${alias}.expected.json yet — wrote ${alias}.draft.json; verify it and save as ${alias}.expected.json`)
      continue
    }
    const { prediction, ...expected } = expectedFile
    const differences = compare(expected, actual)
    if (prediction) {
      const amountOk = prediction.atoDebt === undefined || (debt.amount !== null && Math.abs(debt.amount - prediction.atoDebt) < 0.5)
      const dateOk = prediction.asOf === undefined || debt.asOf === prediction.asOf
      out(`  prediction ATO debt: ${debt.amount ?? 'none'} (${debt.source ?? 'no source'}, as at ${debt.asOf ?? 'no date'})`)
      if (!amountOk || !dateOk) {
        differences.push({ period: 'prediction', key: `ATO debt (as at ${prediction.asOf ?? '?'}, now ${debt.asOf ?? 'none'})`, expected: prediction.atoDebt ?? null, actual: debt.amount })
      }
    }
    if (differences.length === 0) {
      out(`  all ${Object.values(expected).reduce((n, p) => n + Object.keys(p).length, 0) + (prediction ? 1 : 0)} verified figures match`)
    } else {
      failing++
      out(`  ${differences.length} difference(s):`)
      for (const d of differences) out(`    ${describeDifference(d)}`)
    }
  }
  out('')
  if (failing > 0) throw new Error(`${failing} client(s) differ from their verified figures (see above).`)
})
