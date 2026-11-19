import { analyseIca } from '@/lib/ica'
import { readStoredRows } from '@/lib/ica/read'
import { forcedFrom } from '@/lib/ica/status'
import type { Composition } from '@/lib/ica/compose'
import type { IcaFile } from '@/lib/ica/types'
import { classifyAccountRow, type AccountLineKey } from './classify'
import type { AccountRow, AtoAccountCore } from './engine'
import { incomeTaxSummary, type IncomeTaxSummary } from './incomeTax'
import { superGuaranteeSummary, type SuperGuaranteeSummary } from './superGuarantee'

/**
 * The income tax and superannuation guarantee accounts' own summaries (each
 * assessment; each quarter's SG charge; interest, Part 7 penalties, payments),
 * built on the ICA engine (src/lib/ica, Stage 3, 18 Nov 2026) instead of the
 * earlier account engine. Pure.
 *
 * Only from a file verified against the ATO's own balance, and only from the
 * rows that balance proved: each row counts with the amount the verified
 * composition counts it at (a statement row split by its sub-lines counts as
 * its sub-lines; a total printed over the rows it sums is not counted twice).
 * Which summary line a counted row is (an assessment, an SG shortfall) is its
 * ATO wording (classify.ts); interest, penalties, payments and credits follow
 * the composition's own sections. The balance is the verified ATO balance.
 * Unpaid amounts are that balance spread over the newest charges first, as before.
 *
 * Null when the file is not verified: the page then shows the rows as printed.
 */
export type VerifiedAccountSummary = { kind: 'income_tax'; summary: IncomeTaxSummary } | { kind: 'super_guarantee'; summary: SuperGuaranteeSummary }

export function verifiedAccountSummary(stored: {
  kind: string
  rows: unknown
  label?: string | null
  ica_status?: string | null
  ica_forced?: unknown
}): VerifiedAccountSummary | null {
  if ((stored.kind !== 'income_tax' && stored.kind !== 'super_guarantee') || stored.ica_status !== 'verified') return null
  const file = readStoredRows(stored.rows, { label: stored.label })
  if (!file) return null
  const analysis = verifiedAccountAnalysis(stored.kind, file, forcedFrom(stored.ica_forced))
  return analysis && ({ kind: analysis.kind, summary: analysis.summary } as VerifiedAccountSummary)
}

/**
 * The whole analysis from an ATO file on the ICA engine: the rows the ATO's balance proved, and the
 * account's summary. Null when the file does not verify. Also what `figures:check` compares with the
 * answer keys of the real income tax and super guarantee accounts.
 */
export function verifiedAccountAnalysis(kind: 'income_tax' | 'super_guarantee', file: IcaFile, forced?: Map<number, boolean>) {
  const a = analyseIca(file, { forced })
  if (!a.verified || !a.composition || a.reconciliation.atoBalance === null) return null
  const rows = file.rows.map((r) => ({ processedDate: r.processed, effectiveDate: r.effective, rawProcessed: r.rawProcessed, description: r.description }))
  const core = coreFromComposition(kind, rows, a.composition)
  return kind === 'income_tax'
    ? { ...core, kind: 'income_tax' as const, summary: incomeTaxSummary(core) }
    : { ...core, kind: 'super_guarantee' as const, summary: superGuaranteeSummary(core) }
}

interface StoredRow {
  processedDate?: string | null
  effectiveDate?: string | null
  rawProcessed?: string
  description: string
}

const round2 = (n: number) => Math.round(n * 100) / 100
const localDay = (iso: string | null | undefined) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** The rows as the summaries read them: printed order, each with its counted amount and its line. */
export function coreFromComposition(kind: 'income_tax' | 'super_guarantee', stored: StoredRow[], c: Composition): AtoAccountCore {
  const counted = new Map<number, { debit: number; credit: number; section: string; key: string }>()
  for (const line of c.lines) {
    for (const p of line.parts) {
      const was = counted.get(p.rowId)
      counted.set(p.rowId, { debit: (was?.debit ?? 0) + p.debit, credit: (was?.credit ?? 0) + p.credit, section: line.section, key: line.key })
    }
  }

  const lineOf = (description: string, part: { section: string; key: string }): AccountLineKey | null => {
    if (part.section === 'interest') return 'interest'
    if (part.section === 'penalties') return kind === 'super_guarantee' && /part \d+ penalty/i.test(description) ? 'part7' : 'penalties'
    if (part.key === 'payments') return 'payments'
    if (part.section === 'refunds') return 'refunds'
    if (part.section === 'credits') return 'otherCredits'
    const own = classifyAccountRow(kind, description).line
    return own === 'assessments' || own === 'sgShortfall' || own === 'sgNominalInterest' || own === 'sgAdminFee' ? own : null
  }

  const rows: AccountRow[] = stored.map((r, i) => {
    const part = counted.get(i)
    const line = part ? lineOf(r.description, part) : null
    return {
      rowIndex: i,
      rawProcessed: r.rawProcessed ?? r.processedDate ?? '',
      rawEffective: r.effectiveDate ?? '',
      processedDate: localDay(r.processedDate ?? r.rawProcessed),
      effectiveDate: localDay(r.effectiveDate),
      description: r.description,
      // Not counted (or not a summary line): no amount, so it adds to nothing.
      debit: part && line ? round2(part.debit / 100) : null,
      credit: part && line ? round2(part.credit / 100) : null,
      balance: null,
      periodEnding: null,
      line,
      lodgementType: 'Other',
      lateLodgementDays: 0,
      lateLodgeDaysCleaned: 0,
    }
  })

  const totals: AtoAccountCore['totals'] = {}
  const payments = { count: 0, total: 0, first: null as string | null, last: null as string | null }
  for (const r of rows) {
    if (!r.line) continue
    const t = totals[r.line] ?? { debits: 0, credits: 0, net: 0 }
    t.debits = round2(t.debits + (r.debit ?? 0))
    t.credits = round2(t.credits + (r.credit ?? 0))
    t.net = round2(t.debits - t.credits)
    totals[r.line] = t
    if (r.line === 'payments' && (r.credit ?? 0) > 0) {
      payments.count += 1
      payments.total = round2(payments.total + (r.credit ?? 0))
      // The day the payment took effect (as the earlier engine and the answer keys).
      const d = stored[r.rowIndex].effectiveDate ?? stored[r.rowIndex].processedDate ?? null
      if (d && (!payments.first || d < payments.first)) payments.first = d
      if (d && (!payments.last || d > payments.last)) payments.last = d
    }
  }

  return {
    kind,
    label: '',
    entityName: '',
    rows,
    balance: c.atoBalance === null ? null : c.atoBalance / 100,
    balanceDate: c.atoBalanceDate,
    statementDate: c.atoBalanceDate,
    openingBalance: c.opening / 100,
    totals,
    composedBalance: c.total / 100,
    unexplainedDifference: 0,
    needsReview: false,
    composition: { lines: [], uncounted: [] },
    payments,
    unparsedDateRows: 0,
  }
}
