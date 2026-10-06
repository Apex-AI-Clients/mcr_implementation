import { digitsOnly } from '@/lib/asic/identifiers'
import { dictionaryKey, isPriorYearLossLabel, normaliseLabel } from './labels'
import type { StatementLine } from './types'
import type { MergedStatement } from './statementSelection'
import type {
  ExtractedFinancialStatement,
  ExtractionWarning,
  FinancialCheck,
  FinancialDocumentKind,
  HeadingEntity,
  StatementHalfKey,
  StoredStatementSlot,
} from './types'

/**
 * Checks over a client's stored statements, run when the comparison is built
 * and stored with it. Pure. They report; they never change a figure.
 *
 *   totals_reconciliation / balance_sheet_equation
 *       Each statement's own arithmetic, recomputed on the merged data so a
 *       statement assembled from two files is checked as it is used.
 *   retained_earnings_rollforward
 *       Opening retained earnings + the year's profit against closing.
 *       Dividends and drawings can only take retained earnings DOWN, so a
 *       closing figure above opening + profit is a warning, and one below it
 *       is information: it implies a distribution of the difference.
 *   restatement
 *       The same year and line read differently from the year's own file and
 *       from the next year's comparative column.
 *   entity_mismatch
 *       The heading's ABN or name against the client file: a company's own
 *       ABN, or for a trust the trust's ABN and name.
 *   not_statements / extraction_note
 *       What the pre-pass and extraction recorded about each document.
 */

export const ANNUAL_TOLERANCE = 50
/** Interim exports carry rounding and suspense lines. Balance sheet only. */
export const CURRENT_PERIOD_BS_TOLERANCE = 200
export const YEAR_WINDOW = 4

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-AU')}`

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// ─── Year window ──────────────────────────────────────────────────────────────

/** The latest YEAR_WINDOW annual years go into the comparison; older ones are extra. */
export function applyYearWindow(
  annual: MergedStatement[],
  size = YEAR_WINDOW,
): { used: MergedStatement[]; extraYears: number[] } {
  const sorted = [...annual].sort((a, b) => a.statement.financialYear - b.statement.financialYear)
  const used = sorted.slice(-size)
  const extraYears = sorted.slice(0, Math.max(0, sorted.length - size)).map((m) => m.statement.financialYear)
  return { used, extraYears }
}

// ─── Arithmetic ───────────────────────────────────────────────────────────────

export interface ArithmeticFinding {
  statement: StatementHalfKey
  kind: 'totals_reconciliation' | 'balance_sheet_equation'
  message: string
}

/**
 * A statement's own arithmetic. Each identity is checked only when every
 * figure in it is present.
 */
export function arithmeticFindings(
  s: Pick<ExtractedFinancialStatement, 'incomeStatement' | 'balanceSheet'>,
  { currentPeriod = false } = {},
): ArithmeticFinding[] {
  const out: ArithmeticFinding[] = []
  const bsTolerance = currentPeriod ? CURRENT_PERIOD_BS_TOLERANCE : ANNUAL_TOLERANCE
  const t = s.incomeStatement.totals ?? {}
  const b = s.balanceSheet.totals ?? {}

  const [income, cogs, expenses, pbt] = [t.totalIncome, t.totalCogs, t.totalExpenses, t.profitBeforeTax].map(num)
  if (income !== null && cogs !== null && expenses !== null && pbt !== null) {
    const calc = income - cogs - expenses
    // Templates that print "Other Income" after the first Total Income leave
    // it out of total income: the profit then includes it on top.
    const inc = (s.incomeStatement.income ?? {}) as Record<string, unknown>
    const otherIncome = (num(inc.interestIncome) ?? 0) + (num(inc.otherRevenue) ?? 0)
    if (Math.abs(calc - pbt) > ANNUAL_TOLERANCE && Math.abs(calc + otherIncome - pbt) > ANNUAL_TOLERANCE) {
      out.push({
        statement: 'income_statement',
        kind: 'totals_reconciliation',
        message: `Total income ${money(income)} − cost of sales ${money(cogs)} − expenses ${money(expenses)} = ${money(calc)}, but the profit before tax shown is ${money(pbt)}.`,
      })
    }
  }

  // Cost of sales with stock: opening + purchases + direct costs + other - closing.
  const c = (s.incomeStatement.cogs ?? {}) as Record<string, unknown>
  const opening = num(c.openingStock)
  const closing = num(c.closingStock)
  const totalCogs = num(t.totalCogs)
  if (totalCogs !== null && (opening !== null || closing !== null)) {
    const otherCogs = c.other && typeof c.other === 'object'
      ? Object.values(c.other as Record<string, unknown>).reduce<number>((sum, v) => sum + (num(v) ?? 0), 0)
      : num(c.other) ?? 0
    const calc = (opening ?? 0) + (num(c.purchases) ?? 0) + (num(c.directCosts) ?? 0) + otherCogs - Math.abs(closing ?? 0)
    if (Math.abs(calc - totalCogs) > ANNUAL_TOLERANCE) {
      out.push({
        statement: 'income_statement',
        kind: 'totals_reconciliation',
        message: `Cost of sales: opening stock ${money(opening ?? 0)} + purchases and direct costs − closing stock ${money(Math.abs(closing ?? 0))} = ${money(calc)}, but the total shown is ${money(totalCogs)}.`,
      })
    }
  }

  const [ca, nca, ta, cl, ncl, tl, na, te] = [
    b.totalCurrentAssets,
    b.totalNonCurrentAssets,
    b.totalAssets,
    b.totalCurrentLiabilities,
    b.totalNonCurrentLiabilities,
    b.totalLiabilities,
    b.netAssets,
    b.totalEquity,
  ].map(num)

  if (ca !== null && nca !== null && ta !== null && Math.abs(ca + nca - ta) > bsTolerance) {
    out.push({
      statement: 'balance_sheet',
      kind: 'totals_reconciliation',
      message: `Current assets ${money(ca)} + non-current assets ${money(nca)} = ${money(ca + nca)}, but total assets shown is ${money(ta)}.`,
    })
  }
  if (cl !== null && ncl !== null && tl !== null && Math.abs(cl + ncl - tl) > bsTolerance) {
    out.push({
      statement: 'balance_sheet',
      kind: 'totals_reconciliation',
      message: `Current liabilities ${money(cl)} + non-current liabilities ${money(ncl)} = ${money(cl + ncl)}, but total liabilities shown is ${money(tl)}.`,
    })
  }
  if (ta !== null && tl !== null && na !== null && Math.abs(ta - tl - na) > bsTolerance) {
    out.push({
      statement: 'balance_sheet',
      kind: 'balance_sheet_equation',
      message: `Total assets ${money(ta)} − total liabilities ${money(tl)} = ${money(ta - tl)}, but net assets shown is ${money(na)}.`,
    })
  }
  if (na !== null && te !== null && Math.abs(na - te) > bsTolerance) {
    out.push({
      statement: 'balance_sheet',
      kind: 'balance_sheet_equation',
      message: `Net assets ${money(na)} does not equal total equity ${money(te)}.`,
    })
  }
  return out
}

function documentIdsOf(m: MergedStatement, half?: StatementHalfKey): string[] {
  const halves: StatementHalfKey[] = half ? [half] : ['income_statement', 'balance_sheet']
  return [...new Set(halves.map((h) => m.sources[h]?.documentId).filter((id): id is string => !!id))]
}

export function arithmeticChecks(merged: MergedStatement[], current: MergedStatement | null): FinancialCheck[] {
  const out: FinancialCheck[] = []
  const run = (m: MergedStatement, currentPeriod: boolean) => {
    for (const f of arithmeticFindings(m.statement, { currentPeriod })) {
      out.push({
        kind: f.kind,
        severity: 'warning',
        financialYear: m.statement.financialYear,
        statement: f.statement,
        ...(currentPeriod ? { currentPeriod: true } : {}),
        message: f.message,
        documentIds: documentIdsOf(m, f.statement),
      })
    }
  }
  for (const m of merged) run(m, false)
  if (current) run(current, true)
  return out
}

// ─── Retained earnings roll-forward ──────────────────────────────────────────

/**
 * For each year checked, with the previous year's balance sheet available:
 * opening retained earnings + profit vs closing. Profit after tax when shown,
 * else before tax. Skipped when retained earnings are not on both balance
 * sheets (a trust usually has none — it distributes).
 */
export function rollForwardChecks(all: MergedStatement[], yearsToCheck: number[]): FinancialCheck[] {
  const byYear = new Map(all.map((m) => [m.statement.financialYear, m]))
  const out: FinancialCheck[] = []
  for (const year of yearsToCheck) {
    const thisYear = byYear.get(year)
    const lastYear = byYear.get(year - 1)
    if (!thisYear || !lastYear) continue
    if (!thisYear.sources.balance_sheet || !lastYear.sources.balance_sheet || !thisYear.sources.income_statement) continue

    const opening = num(lastYear.statement.balanceSheet.equity?.retainedEarnings)
    const closing = num(thisYear.statement.balanceSheet.equity?.retainedEarnings)
    const totals = thisYear.statement.incomeStatement.totals ?? {}
    const profit = num(totals.netProfitAfterTax) ?? num(totals.profitBeforeTax)
    if (opening === null || closing === null || profit === null) continue

    // Distributions and dividends printed below the profit line, when read.
    const ap = thisYear.statement.incomeStatement.appropriations
    const paidOut = [num(ap?.distributions), num(ap?.dividends)].filter((v): v is number => v !== null)
    const knownPaidOut = paidOut.length > 0 ? paidOut.reduce((a, b) => a + Math.abs(b), 0) : null

    const expected = opening + profit - (knownPaidOut ?? 0)
    const gap = closing - expected
    if (Math.abs(gap) <= ANNUAL_TOLERANCE) continue

    const documentIds = [...new Set([...documentIdsOf(thisYear), ...documentIdsOf(lastYear, 'balance_sheet')])]
    if (knownPaidOut !== null) {
      // Everything is known, so any gap is a figure that does not fit.
      out.push({
        kind: 'retained_earnings_rollforward',
        severity: 'warning',
        financialYear: year,
        statement: 'balance_sheet',
        message: `Retained earnings closed at ${money(closing)}, but opening ${money(opening)} plus the year's profit ${money(profit)} less distributions and dividends ${money(knownPaidOut)} comes to ${money(expected)} (a difference of ${money(gap)}).`,
        documentIds,
      })
      continue
    }
    out.push(
      gap > 0
        ? {
            kind: 'retained_earnings_rollforward',
            severity: 'warning',
            financialYear: year,
            statement: 'balance_sheet',
            message: `Retained earnings rose to ${money(closing)}, more than opening ${money(opening)} plus the year's profit ${money(profit)} (${money(expected)}). Dividends can only lower it, so a figure is likely wrong.`,
            documentIds,
          }
        : {
            kind: 'retained_earnings_rollforward',
            severity: 'info',
            financialYear: year,
            statement: 'balance_sheet',
            group: 'distributions_implied',
            message: `Retained earnings closed at ${money(closing)}: opening ${money(opening)} plus the year's profit ${money(profit)} less ${money(-gap)}, which implies dividends or other distributions of that amount.`,
            documentIds,
          },
    )
  }
  return out
}

// ─── Restatement ──────────────────────────────────────────────────────────────

export function restatementTolerance(a: number, b: number): number {
  return Math.max(ANNUAL_TOLERANCE, 0.005 * Math.max(Math.abs(a), Math.abs(b)))
}

/** Every numeric leaf of a statement, keyed "section.key" (including `other` entries). */
function leaves(value: unknown, prefix = ''): Map<string, number> {
  const out = new Map<string, number>()
  if (!value || typeof value !== 'object') return out
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'number' && Number.isFinite(child)) out.set(path, child)
    else if (child && typeof child === 'object') for (const [k, v] of leaves(child, path)) out.set(k, v)
  }
  return out
}

/** "currentLiabilities.atoLiability" -> "ato liability"; "other.Loan 2020" -> "Loan 2020". */
function lineLabel(path: string): string {
  const last = path.split('.').pop() ?? path
  if (path.includes('.other.')) return last
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
}

const MAX_LINES_LISTED = 5

type Comparable = Map<string, { value: number; display: string }>

/** Printed lines by normalised label (the first of any repeated label). */
/**
 * Lines that move retained earnings rather than report the year: appropriation
 * lines, prior-year losses, the profit-after-losses subtotal, distributions.
 * They are expected to differ between files, so restatement leaves them out.
 */
function isAppropriationLine(line: StatementLine): boolean {
  if (line.section === 'appropriation') return true
  const key = dictionaryKey(line.rawLabel, line.section)
  if (key && (key.startsWith('appropriations.') || key.startsWith('ignore.'))) return true
  return isPriorYearLossLabel(line.rawLabel) || /\b(distribution|distributions|beneficiar(y|ies)|retained (profits|earnings))\b/.test(normaliseLabel(line.rawLabel))
}

function byLabel(lines: StatementLine[]): Comparable {
  const out: Comparable = new Map()
  for (const line of lines) {
    if (line.value === null || isAppropriationLine(line)) continue
    const key = normaliseLabel(line.rawLabel)
    if (key && !out.has(key)) out.set(key, { value: line.value, display: line.rawLabel })
  }
  return out
}

/** The printed totals, for statements read before line lists existed. */
function totalsOf(data: { totals?: unknown }): Comparable {
  const out: Comparable = new Map()
  for (const [path, value] of leaves(data.totals ?? {})) out.set(path, { value, display: lineLabel(path) })
  return out
}

interface HeadlinePair {
  label: string
  own: number
  later: number
}

/** The year's headline figures from both readings, where both have them. */
function headlinePairs(
  primary: StoredStatementSlot,
  comparative: StoredStatementSlot,
): HeadlinePair[] {
  const pairs: HeadlinePair[] = []
  const add = (label: string, own: unknown, later: unknown) => {
    if (typeof own === 'number' && typeof later === 'number') pairs.push({ label, own, later })
  }
  const ownBs = primary.balanceSheet?.data.totals
  const laterBs = comparative.balanceSheet?.data.totals
  if (ownBs && laterBs) {
    add('net assets', ownBs.netAssets, laterBs.netAssets)
    add('total assets', ownBs.totalAssets, laterBs.totalAssets)
    add('total liabilities', ownBs.totalLiabilities, laterBs.totalLiabilities)
  }
  const ownIs = primary.incomeStatement?.data.totals
  const laterIs = comparative.incomeStatement?.data.totals
  if (ownIs && laterIs) {
    add('profit', ownIs.profitBeforeTax ?? ownIs.netProfitAfterTax, laterIs.profitBeforeTax ?? laterIs.netProfitAfterTax)
  }
  return pairs
}

/**
 * A year read from its own file (primary) and from the next year's file
 * (comparative). Accountants reclassify prior years — loans moved between
 * current and non-current, a loan moved from liabilities to assets, bank and
 * receivables restated — without changing what the year added up to.
 *
 *   - Net assets and profit match: the line differences are a
 *     reclassification — one NOTE per year, the lines in its details. Total
 *     assets and total liabilities moving by the same amount (a gross-up,
 *     e.g. a loan moved from liabilities to assets) is still a note.
 *   - Net assets or profit differ: a WARNING, naming them, the lines in details.
 *   - The same amount with the opposite sign: a note ("sign differs").
 *
 * The comparison always uses the year's own figures.
 */
export function restatementChecks(slots: StoredStatementSlot[]): FinancialCheck[] {
  const out: FinancialCheck[] = []
  const years = [...new Set(slots.map((s) => s.financialYear))].sort((a, b) => a - b)
  for (const year of years) {
    const primary = slots.find((s) => s.financialYear === year && s.sourceColumn === 'primary')
    const comparative = slots.find((s) => s.financialYear === year && s.sourceColumn === 'comparative')
    if (!primary || !comparative) continue

    const moved: string[] = []
    const signOnly: string[] = []
    const halvesMoved = new Set<'income_statement' | 'balance_sheet'>()
    const documentIds = new Set<string>()
    let ownFile: string | null = null
    let laterFile: string | null = null

    for (const half of ['income_statement', 'balance_sheet'] as const) {
      const own = half === 'income_statement' ? primary.incomeStatement : primary.balanceSheet
      const later = half === 'income_statement' ? comparative.incomeStatement : comparative.balanceSheet
      if (!own || !later) continue
      ownFile ??= own.sourceFilename
      laterFile ??= later.sourceFilename

      // The same printed line in both files, by its normalised label — so a
      // line mapped differently in the two files is never a restatement.
      // Without line lists (older extractions) only the printed totals are
      // compared: they do not depend on mapping.
      const ownLines = own.data.lines
      const laterLines = later.data.lines
      const a = ownLines?.length && laterLines?.length ? byLabel(ownLines) : totalsOf(own.data)
      const b = ownLines?.length && laterLines?.length ? byLabel(laterLines) : totalsOf(later.data)
      for (const [label, { value: ownValue, display }] of a) {
        const laterEntry = b.get(label)
        if (!laterEntry) continue
        const laterValue = laterEntry.value
        if (Math.abs(ownValue - laterValue) <= restatementTolerance(ownValue, laterValue)) continue
        if (Math.abs(Math.abs(ownValue) - Math.abs(laterValue)) <= restatementTolerance(ownValue, laterValue)) {
          signOnly.push(`${display} ${money(ownValue)} / ${money(laterValue)}`)
        } else {
          moved.push(`${display} ${money(ownValue)} → ${money(laterValue)}`)
          halvesMoved.add(half)
        }
        for (const id of [own.documentId, later.documentId]) if (id) documentIds.add(id)
      }
    }

    const files = `${ownFile ?? 'its own file'} and ${laterFile ?? 'a later file'}`
    if (signOnly.length > 0) {
      out.push({
        kind: 'restatement',
        severity: 'info',
        financialYear: year,
        statement: null,
        group: 'sign_differs',
        message: `FY${year}: sign differs between files for ${signOnly.join('; ')} (${files}). The comparison uses the year's own figures.`,
        documentIds: [...documentIds],
      })
    }
    if (moved.length === 0) continue

    const statement = halvesMoved.size === 1 ? [...halvesMoved][0] : null
    const pairs = headlinePairs(primary, comparative)
    const differing = pairs.filter((p) => Math.abs(p.own - p.later) > restatementTolerance(p.own, p.later))
    // Only net assets and profit make a restatement worth a warning.
    const material = differing.filter((p) => p.label === 'net assets' || p.label === 'profit')

    if (pairs.length > 0 && material.length === 0) {
      const grossedUp = differing.map((p) => `${p.label} ${p.later > p.own ? 'up' : 'down'} ${money(Math.abs(p.later - p.own))}`)
      const unchanged = [
        pairs.some((p) => p.label === 'net assets') ? 'net assets unchanged' : 'totals unchanged',
        ...(grossedUp.length ? [grossedUp.join(', ')] : []),
      ].join('; ')
      out.push({
        kind: 'restatement',
        severity: 'info',
        financialYear: year,
        statement,
        group: 'reclassified',
        message: `FY${year} figures were reclassified in the FY${year + 1} accounts (${unchanged}).`,
        details: moved,
        documentIds: [...documentIds],
      })
      continue
    }

    const what = material.length
      ? material.map((p) => `${p.label} ${money(p.own)} → ${money(p.later)}`).join('; ')
      : moved.slice(0, MAX_LINES_LISTED).join('; ')
    out.push({
      kind: 'restatement',
      severity: 'warning',
      financialYear: year,
      statement,
      message: `FY${year} differs between its own file and the comparative column of ${laterFile ?? 'a later file'}: ${what}. The comparison uses the year's own figures.`,
      details: moved,
      documentIds: [...documentIds],
    })
  }
  return out
}

// ─── Entity ───────────────────────────────────────────────────────────────────

export interface CompanyDetailsForCheck {
  entityType: string | null
  companyName: string | null
  abnNumber: string | null
  trustName: string | null
  trustAbnNumber: string | null
  /** Directors' names, for the loan rule. */
  directors?: string[]
}

export interface DocumentRecordForCheck {
  documentId: string
  filename: string
  kind: FinancialDocumentKind
  headingEntity: HeadingEntity | null
  warnings: ExtractionWarning[]
}

/** For comparing names: no punctuation, no legal-form or trustee words. */
export function comparableName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(pty|ltd|limited|proprietary|the|trustee|trustees|for|atf|as|a t f)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function entityChecks(
  records: DocumentRecordForCheck[],
  company: CompanyDetailsForCheck | null,
): FinancialCheck[] {
  if (!company) return []
  const isTrust = company.entityType === 'trust'
  const expectedAbn = digitsOnly((isTrust ? company.trustAbnNumber : company.abnNumber) ?? '')
  const companyAbn = digitsOnly(company.abnNumber ?? '')
  const expectedName = (isTrust ? company.trustName : company.companyName) ?? null
  const mismatches: Array<{ record: DocumentRecordForCheck; problems: string[] }> = []

  for (const record of records) {
    const heading = record.headingEntity
    if (!heading) continue
    const problems: string[] = []

    if (expectedAbn && heading.abns.length > 0 && !heading.abns.includes(expectedAbn)) {
      const printed = heading.abns.join(', ')
      problems.push(
        isTrust && companyAbn && heading.abns.includes(companyAbn)
          ? `it prints the trustee company's ABN (${printed}), not the trust's ABN (${expectedAbn})`
          : `it prints ABN ${printed}, but the client file has ${expectedAbn}`,
      )
    }

    if (expectedName && heading.name) {
      const want = comparableName(expectedName)
      if (want && !comparableName(heading.name).includes(want)) {
        problems.push(`its heading names "${heading.name}", but the client file has "${expectedName}"`)
      }
    }

    if (problems.length > 0) mismatches.push({ record, problems })
  }
  if (mismatches.length === 0) return []

  // One warning for every document whose heading differs, each listed.
  const listed = mismatches
    .map(({ record, problems }) => `${record.filename}: ${problems.join('; ')}`)
    .sort((a, b) => a.localeCompare(b))
  return [
    {
      kind: 'entity_mismatch',
      severity: 'warning',
      financialYear: null,
      statement: null,
      message:
        mismatches.length === 1
          ? `${listed[0]}. Check it belongs to this client.`
          : `${mismatches.length} documents' headings differ from the client file. Check they belong to this client.`,
      details: mismatches.length === 1 ? undefined : listed,
      documentIds: mismatches.map(({ record }) => record.documentId).sort(),
    },
  ]
}

// ─── Documents and extraction notes ──────────────────────────────────────────

/**
 * Only what needs staff action is a warning: a column that could not be read,
 * a file that is not statements, a loan whose holder must be confirmed.
 * Everything we corrected or explained ourselves is a note.
 */
const WARNING_KINDS = new Set<ExtractionWarning['kind']>(['column_not_extracted', 'document_kind', 'loan_unconfirmed'])

/** Note kinds made fresh from the lines' final mapping when the comparison is built. */
const REGENERATED_KINDS = new Set<ExtractionWarning['kind']>(['unmapped_line_item', 'loan_unconfirmed'])

/** What was recorded about each document: not statements at all, and its notes. */
export function documentChecks(records: DocumentRecordForCheck[]): FinancialCheck[] {
  const out: FinancialCheck[] = []
  for (const record of records) {
    if (record.kind === 'not_financial' || record.kind === 'tax_return_only') {
      out.push({
        kind: 'not_statements',
        severity: 'warning',
        financialYear: null,
        statement: null,
        message: `${record.filename}: ${
          record.kind === 'tax_return_only'
            ? 'holds a tax return but no Income Statement or Balance Sheet'
            : 'does not look like financial statements'
        }. Nothing was taken from it.`,
        documentIds: [record.documentId],
      })
      continue
    }
    for (const w of record.warnings) {
      if (w.kind === 'document_kind') continue
      out.push({
        kind: 'extraction_note',
        severity: WARNING_KINDS.has(w.kind) ? 'warning' : 'info',
        financialYear: null,
        statement: null,
        message: `${record.filename}: ${w.message}`,
        documentIds: [record.documentId],
        group: w.group ?? w.kind,
      })
    }
  }
  return out
}

/**
 * The warnings stored with each half the comparison uses. Reconciliation
 * warnings are left out: arithmeticChecks() recomputes them on the merged data.
 */
export function extractionNotes(
  merged: MergedStatement[],
  current: MergedStatement | null,
  singleStatementDocuments: Set<string> = new Set(),
): FinancialCheck[] {
  const out: FinancialCheck[] = []
  const seen = new Set<string>()
  for (const [m, currentPeriod] of [...merged.map((m) => [m, false] as const), ...(current ? [[current, true] as const] : [])]) {
    // "No balance sheet — combined PDF expected", stored before separate files
    // were accepted: not a problem for a P&L-only or BS-only file.
    const fromSingleStatementFile = documentIdsOf(m).some((id) => singleStatementDocuments.has(id))
    const hasLines = Boolean(m.statement.incomeStatement.lines?.length || m.statement.balanceSheet.lines?.length)
    for (const w of m.statement.warnings) {
      if (w.kind === 'totals_reconciliation') continue
      // Made again from the final mapping (assembleComparison), so a stored
      // copy from extraction time can never contradict it.
      if (hasLines && REGENERATED_KINDS.has(w.kind)) continue
      if (w.kind === 'incomplete_current_period' && fromSingleStatementFile) continue
      const key = `${m.statement.financialYear}|${currentPeriod}|${w.kind}|${w.message}`
      if (seen.has(key)) continue
      seen.add(key)
      const half: StatementHalfKey | null =
        w.section === 'incomeStatement' ? 'income_statement' : w.section === 'balanceSheet' ? 'balance_sheet' : null
      out.push({
        kind: 'extraction_note',
        severity: WARNING_KINDS.has(w.kind) ? 'warning' : 'info',
        financialYear: m.statement.financialYear,
        statement: half,
        ...(currentPeriod ? { currentPeriod: true } : {}),
        message: w.message,
        documentIds: documentIdsOf(m, half ?? undefined),
        group: w.group ?? w.kind,
      })
    }
  }
  return out
}

/** Every check, warnings first, then by year. */
export function runChecks(input: {
  slots: StoredStatementSlot[]
  allAnnual: MergedStatement[]
  used: MergedStatement[]
  current: MergedStatement | null
  records: DocumentRecordForCheck[]
  company: CompanyDetailsForCheck | null
  /** Checks made while assembling: mapping consistency, profit corrections. */
  extra?: FinancialCheck[]
}): FinancialCheck[] {
  const { slots, allAnnual, used, current, records, company, extra = [] } = input
  const usedYears = new Set(used.map((m) => m.statement.financialYear))
  const singleStatementDocuments = new Set(
    records.filter((r) => r.kind === 'pnl_only' || r.kind === 'bs_only').map((r) => r.documentId),
  )
  const checks = [
    ...arithmeticChecks(used, current),
    ...rollForwardChecks(allAnnual, [...usedYears]),
    ...restatementChecks(slots).filter((c) => c.financialYear === null || usedYears.has(c.financialYear)),
    ...entityChecks(records, company),
    ...documentChecks(records),
    ...extractionNotes(used, current, singleStatementDocuments),
    ...extra,
  ]
  const rank = (c: FinancialCheck) => (c.severity === 'warning' ? 0 : 1)
  return checks.sort(
    (a, b) => rank(a) - rank(b) || (a.financialYear ?? 0) - (b.financialYear ?? 0),
  )
}
