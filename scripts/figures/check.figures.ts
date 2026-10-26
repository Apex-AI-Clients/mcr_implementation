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
  prediction?: { atoDebt?: number; asOf?: string }
  lodgement?: LodgementFigures
  dpnNotices?: Partial<Record<'paygw' | 'gst' | 'sgc', NoticeColumns>>
}

const OTHER_SCOPE: LateLodgementScope = LATE_LODGEMENT_SCOPE === 'originals_only' ? 'originals_and_amendments' : 'originals_only'

it('compares the lodgement, ATO debt and DPN figures with the verified figures', () => {
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
    const { prediction, lodgement: expectedLodgement, dpnNotices: expectedNotices } = expectedFile ?? {}
    const differences: string[] = []
    out('')
    out(`── ${alias} (${snapshot ? `snapshot ${snapshot.takenAt.slice(0, 10)}` : 'ATO account CSV only'}) ──`)

    // The ATO debt the prediction takes from the ATO account.
    if (snapshot && prediction) {
      const debt = predictionDebt(snapshot)
      const amountOk = prediction.atoDebt === undefined || (debt.amount !== null && Math.abs(debt.amount - prediction.atoDebt) < 0.5)
      const dateOk = prediction.asOf === undefined || debt.asOf === prediction.asOf
      out(`  prediction ATO debt: ${debt.amount ?? 'none'} (${debt.source ?? 'no source'}, as at ${debt.asOf ?? 'no date'})`)
      if (!amountOk || !dateOk) {
        differences.push(`prediction  ATO debt (as at ${prediction.asOf ?? '?'}, now ${debt.asOf ?? 'none'}): verified ${prediction.atoDebt ?? 'none'}, now ${debt.amount ?? 'missing'}`)
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
