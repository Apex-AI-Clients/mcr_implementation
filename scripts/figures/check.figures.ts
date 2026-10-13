import { it } from 'vitest'
import { LATE_LODGEMENT_SCOPE, type LateLodgementScope } from '@/lib/analysis/config'
import {
  analyseLodgements,
  assemble,
  compareLodgement,
  predictionDebt,
  compare,
  describeDifference,
  flatten,
  icaCsvAliases,
  lodgementFigures,
  out,
  readJson,
  snapshotAliases,
  writeJson,
  type Figures,
  type LodgementFigures,
  type Snapshot,
} from './figures'

/**
 * `npm run figures:check` — no database. For each client in
 * verified-figures/ (a snapshot, an `<alias>.ica.csv`, or both), rebuilds
 * with the CURRENT code:
 *   - the financials comparison (the extraction-time line corrections
 *     replayed, then the comparison assembly), when there are statements;
 *   - the lodgement analysis (late lodgements, DPN, payments, balance), from
 *     `<alias>.ica.csv` or the rows stored with the snapshot;
 * and prints every difference from verified-figures/<alias>.expected.json.
 *
 * Without an expected file, writes <alias>.draft.json with every figure:
 * check it against the statements, keep only verified keys, and save it as
 * <alias>.expected.json. Lodgement figures are checked against its
 * "lodgement" key, under the active late-lodgement setting; the other setting
 * is printed alongside for comparison.
 *
 * Prints aliases, schema keys and figures only — never a client's name, a
 * filename or a free-text label.
 */

type Expected = Figures & { prediction?: { atoDebt?: number; asOf?: string }; lodgement?: LodgementFigures }

const OTHER_SCOPE: LateLodgementScope = LATE_LODGEMENT_SCOPE === 'originals_only' ? 'originals_and_amendments' : 'originals_only'

it('compares a fresh comparison with the verified figures', () => {
  const aliases = [...new Set([...snapshotAliases(), ...icaCsvAliases()])].sort()
  if (aliases.length === 0) {
    out('No snapshots in verified-figures/. Run `npm run figures:snapshot` first.')
    return
  }
  out(`late-lodgement setting: ${LATE_LODGEMENT_SCOPE}`)
  let failing = 0
  for (const alias of aliases) {
    const snapshot = readJson<Snapshot>(`${alias}.snapshot.json`)
    const expectedFile = readJson<Expected>(`${alias}.expected.json`)
    const { prediction, lodgement: expectedLodgement, ...expected } = expectedFile ?? {}
    const differences: string[] = []
    out('')
    out(`── ${alias} (${snapshot ? `snapshot ${snapshot.takenAt.slice(0, 10)}` : 'ATO account CSV only'}) ──`)

    // Financials: only for a client with statements.
    if (snapshot && snapshot.slots.length > 0) {
      const comparison = assemble(snapshot, true)
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

      if (!expectedFile) {
        writeJson(`${alias}.draft.json`, actual)
        out(`  no ${alias}.expected.json yet — wrote ${alias}.draft.json; verify it and save as ${alias}.expected.json`)
        continue
      }
      for (const d of compare(expected as Figures, actual)) differences.push(describeDifference(d))
      out(`  financials: ${Object.values(expected as Figures).reduce((n, p) => n + Object.keys(p).length, 0)} verified figures checked`)

      const debt = predictionDebt(snapshot)
      if (prediction) {
        const amountOk = prediction.atoDebt === undefined || (debt.amount !== null && Math.abs(debt.amount - prediction.atoDebt) < 0.5)
        const dateOk = prediction.asOf === undefined || debt.asOf === prediction.asOf
        out(`  prediction ATO debt: ${debt.amount ?? 'none'} (${debt.source ?? 'no source'}, as at ${debt.asOf ?? 'no date'})`)
        if (!amountOk || !dateOk) {
          differences.push(
            describeDifference({ period: 'prediction', key: `ATO debt (as at ${prediction.asOf ?? '?'}, now ${debt.asOf ?? 'none'})`, expected: prediction.atoDebt ?? null, actual: debt.amount }),
          )
        }
      }
    }

    // Lodgement analysis, under the active setting; the other setting for comparison.
    const lodgement = analyseLodgements(alias, snapshot, LATE_LODGEMENT_SCOPE)
    const other = analyseLodgements(alias, snapshot, OTHER_SCOPE)
    if (lodgement) {
      const figures = lodgementFigures(lodgement)
      out(`  lodgement: ${Object.entries(figures).map(([k, v]) => `${k} ${v}`).join(' | ')}`)
      if (other) {
        out(`  lodgement if ${OTHER_SCOPE}: lateLodgements ${other.summary.numberOfLateLodgements} | cumulativeDaysLate ${other.summary.cumulativeDaysLate} | dpnGrossOver90 ${other.dpnRisk.totalGrossLate}`)
      }
      if (expectedLodgement) differences.push(...compareLodgement(expectedLodgement, figures))
      else out('  lodgement: not verified yet (add a "lodgement" key to the expected file)')
    } else if (expectedLodgement) {
      differences.push('lodgement  no ATO account rows for this client')
    }

    if (differences.length === 0) {
      out(`  all verified figures match`)
    } else {
      failing++
      out(`  ${differences.length} difference(s):`)
      for (const d of differences) out(`    ${d}`)
    }
  }
  out('')
  if (failing > 0) throw new Error(`${failing} client(s) differ from their verified figures (see above).`)
})
