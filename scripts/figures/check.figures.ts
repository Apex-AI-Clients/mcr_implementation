import { it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { LATE_LODGEMENT_SCOPE, type LateLodgementScope } from '@/lib/analysis/config'
import { analyseAtoAccount } from '@/lib/analysis/atoAccount'
import {
  ATO_ACCOUNTS_DIR,
  analyseLodgements,
  atoAccountFigures,
  compareLodgement,
  readAtoAccounts,
  predictionDebt,
  icaCsvAliases,
  lodgementFigures,
  out,
  readJson,
  snapshotAliases,
  noticeTotals,
  comparePrintedFigures,
  predictionInputs,
  printedAliases,
  type PrintedFiguresSpec,
  type LodgementFigures,
  type Snapshot,
} from './figures'

/**
 * `npm run figures:check` — no database. For each client in
 * verified-figures/ (a snapshot, an `<alias>.ica.csv`, or both), rebuilds
 * with the CURRENT code:
 *   - the lodgement analysis (late lodgements, DPN, payments, balance), from
 *     `<alias>.ica.csv` or the rows stored with the snapshot;
 *   - the ATO debt the prediction takes from the ATO account;
 *   - the stored director penalty notices' totals;
 * and prints every difference from verified-figures/<alias>.expected.json
 * ("lodgement", "prediction" and "dpnNotices" keys). Lodgement figures are
 * checked under the active late-lodgement setting; the other setting is
 * printed alongside for comparison. The financial statements are checked by
 * `npm run printed:check`; the old per-period keys are not read.
 *
 * Prints aliases, schema keys and figures only — never a client's name, a
 * filename or a free-text label.
 */

/** A notice type's company totals, columns 2–5 in dollars (dpn/summary.ts, current notices, de-duplicated). */
type NoticeColumns = [number, number, number, number]

interface Expected {
  notes?: string[]
  /** Every prediction input (predictionInputs); older files carry only atoDebt and asOf. */
  prediction?: LodgementFigures & { atoDebt?: number; asOf?: string }
  lodgement?: LodgementFigures
  dpnNotices?: Partial<Record<'paygw' | 'gst' | 'sgc', NoticeColumns>>
  /** Printed lines in one column, and the loan and ATO figures the mapping makes of them. */
  printedFigures?: PrintedFiguresSpec
}

const OTHER_SCOPE: LateLodgementScope = LATE_LODGEMENT_SCOPE === 'originals_only' ? 'originals_and_amendments' : 'originals_only'

it('compares the lodgement, ATO debt and DPN figures with the verified figures', () => {
  // Every client: a snapshot, an ATO account CSV, or (deleted from the database) verified printed statements.
  const aliases = [...new Set([...snapshotAliases(), ...icaCsvAliases(), ...printedAliases()])].sort()
  if (aliases.length === 0) {
    out('No snapshots in verified-figures/. Run `npm run figures:snapshot` first.')
    return
  }
  out(`late-lodgement setting: ${LATE_LODGEMENT_SCOPE}`)
  let failing = 0
  for (const alias of aliases) {
    const snapshot = readJson<Snapshot>(`${alias}.snapshot.json`)
    const expectedFile = readJson<Expected>(`${alias}.expected.json`)
    const { prediction, lodgement: expectedLodgement, dpnNotices: expectedNotices } = expectedFile ?? {}
    const differences: string[] = []
    out('')
    out(`── ${alias} (${snapshot ? `snapshot ${snapshot.takenAt.slice(0, 10)}` : icaCsvAliases().includes(alias) ? 'ATO account CSV only' : 'verified statements only'}) ──`)

    // Every input the prediction route works out (figures.ts predictionInputs): a change fails.
    const inputs = predictionInputs(alias, snapshot)
    if (inputs) {
      out(`  prediction inputs: ${Object.entries(inputs).map(([k, v]) => `${k} ${v}`).join(' | ')}`)
      if (prediction && Object.keys(prediction).some((k) => k !== 'atoDebt' && k !== 'asOf')) {
        differences.push(...compareLodgement(prediction as LodgementFigures, inputs).map((d) => d.replace(/^lodgement /, 'prediction')))
      } else {
        out('  prediction: not verified yet (add the inputs above to the "prediction" key of the expected file)')
      }
    } else if (snapshot && prediction) {
      // A snapshot from before the inputs were captured: the ATO debt the prediction takes from the ATO account.
      const debt = predictionDebt(snapshot)
      const amountOk = prediction.atoDebt === undefined || (debt.amount !== null && Math.abs(debt.amount - prediction.atoDebt) < 0.5)
      const dateOk = prediction.asOf === undefined || debt.asOf === prediction.asOf
      out(`  prediction ATO debt: ${debt.amount ?? 'none'} (${debt.source ?? 'no source'}, as at ${debt.asOf ?? 'no date'})`)
      if (!amountOk || !dateOk) {
        differences.push(`prediction  ATO debt (as at ${prediction.asOf ?? '?'}, now ${debt.asOf ?? 'none'}): verified ${prediction.atoDebt ?? 'none'}, now ${debt.amount ?? 'missing'}`)
      }
    }

    // Figures as printed in one column, and what the confirmed mapping makes of them.
    if (expectedFile?.printedFigures) {
      const printed = comparePrintedFigures(snapshot, alias, expectedFile.printedFigures)
      out(`  printed figures (${expectedFile.printedFigures.column}): ${printed.length === 0 ? 'all match' : `${printed.length} difference(s)`}`)
      differences.push(...printed)
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

    // Director penalty notices: the stored notices' company totals by type.
    if (snapshot?.dpn && snapshot.dpn.noticeRows.length > 0) {
      const totals = noticeTotals(snapshot)
      out(`  dpn notices: ${Object.entries(totals).map(([type, cols]) => `${type} ${cols.join(' / ')}`).join(' | ') || 'none with figures'}`)
      for (const [type, want] of Object.entries(expectedNotices ?? {})) {
        const got = totals[type]
        const same = got && want.every((v, i) => Math.abs(v - got[i]) < 0.005)
        if (!same) differences.push(`dpn notices  ${type}: verified ${want.join(' / ')}, now ${got ? got.join(' / ') : 'missing'}`)
      }
    } else if (expectedNotices) {
      differences.push('dpn notices  none in the snapshot (re-run figures:snapshot)')
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

/**
 * The income tax and superannuation guarantee accounts kept in
 * verified-figures/ato-accounts/ (accounts.json maps an alias to each export):
 * analysed with the CURRENT code and compared with `<alias>.expected.json`
 * there. Prints aliases, keys and figures only.
 */
it('compares the ATO income tax and super guarantee accounts with the verified figures', () => {
  const accounts = readAtoAccounts()
  if (accounts.length === 0) {
    out('No ATO accounts in verified-figures/ato-accounts/accounts.json.')
    return
  }
  let failing = 0
  for (const { alias, file } of accounts) {
    out('')
    out(`${alias}:`)
    const figures = atoAccountFigures(analyseAtoAccount(readFileSync(path.join(ATO_ACCOUNTS_DIR, file), 'utf8')))
    const expectedFile = path.join(ATO_ACCOUNTS_DIR, `${alias}.expected.json`)
    if (!existsSync(expectedFile)) {
      out('  not verified yet: the figures now are')
      for (const [key, value] of Object.entries(figures)) out(`    ${key}: ${value}`)
      continue
    }
    const differences = compareLodgement(JSON.parse(readFileSync(expectedFile, 'utf8')) as LodgementFigures, figures)
    if (differences.length === 0) out('  all verified figures match')
    else {
      failing++
      out(`  ${differences.length} difference(s):`)
      for (const d of differences) out(`    ${d.replace(/^lodgement {2}/, '')}`)
    }
  }
  out('')
  if (failing > 0) throw new Error(`${failing} ATO account(s) differ from their verified figures (see above).`)
})
