import { verifyStatement, type TotalCheck } from './verify'
import type { PrintedAmount, PrintedColumn, PrintedRead, PrintedRow, PrintedRowStyle, PrintedStatement, PrintedStatementKind, ScanCell, ScanSummary } from './types'

/**
 * The as-printed comparison: a client's financial statement PDFs, read by
 * readStatements.ts, side by side. Pure. Nothing is calculated, renamed or
 * invented: every figure is a printed figure, with the file, page and line it
 * came from.
 *
 *   Columns   every financial year with annual statements of its own or a
 *             column in a software export (Xero, MYOB), oldest first, then the
 *             current period (when it ends after the latest year). Years
 *             printed only as the prior-year column of later annual statements
 *             on request (comparativeYears).
 *   Sources   per year and statement (Gabby, 25 Nov 2026), never silently:
 *               1 that year's own annual financial statements (main column)
 *               2 an export's column (the export whose latest period it is
 *                 first), then
 *               3 the prior-year column of later annual statements (the
 *                 nearest later first);
 *             the same rank: the latest upload. Current period: the latest
 *             period end, then the latest upload; a profit and loss and
 *             balance sheet ending on different dates are flagged. A staff
 *             choice ("Use this source instead") overrides, per year and
 *             statement. `periodSources` says where each came from and where
 *             else it is printed, with the lines that differ.
 *   Rows      the latest report's printed order. A line only an earlier year
 *             prints goes under the same heading, after the line it follows
 *             there. Nothing is dropped; a line a year does not print is blank.
 *   Restated  another report printing a different figure for the same period
 *             and line: the source's figure stays, with a note.
 *   Checks    every printed total of every report used, against its lines
 *             (verify.ts). A failure is a hard check: Needs review.
 *   Scans     a figure read from a scanned page (by Claude, src/lib/scan)
 *             carries that reading and where the line is on the page; its
 *             totals are checked like any other.
 */

export interface ComparisonDocument {
  documentId: string
  filename: string
  uploadedAt: string
  /** Null: never read (or the read could not be kept). */
  read: PrintedRead | null
}

export interface ComparisonColumn {
  /** "FY2024" or "current". */
  key: string
  kind: 'annual' | 'current_period'
  financialYear: number
  periodStart: string | null
  periodEnd: string
  /**
   * Current period only: the date each statement ends on, when they differ (a profit and loss to
   * 16 Nov beside a balance sheet as at 31 Oct). `periodEnd` is the later.
   */
  ends?: Partial<Record<PrintedStatementKind, string>>
}

/**
 * annual_statements  the year's own annual financial statements (main column)
 * export             a column of a software export (Xero, MYOB)
 * comparative        the prior-year column of later annual statements
 * current_period     a current-period report (annual statements or export)
 */
export type SourceKind = 'annual_statements' | 'export' | 'comparative' | 'current_period'

export interface PeriodSource {
  documentId: string
  filename: string
  uploadedAt: string
  kind: SourceKind
  /** "Annual financial statements", "Multi-year export (2026–2022)", "Prior-year column of the FY2027 financial statements". */
  label: string
  /** The column header it is printed under. */
  header: string
}

export interface AlsoIn extends PeriodSource {
  /** Lines printed with a different figure (or by one of the two only); empty: the same figures. */
  differs: { key: string; label: string; path: string[]; source: PrintedAmount; other: PrintedAmount }[]
}

export interface StatementSource {
  statement: PrintedStatementKind
  /** Null: no report prints this statement for the period. */
  source: PeriodSource | null
  /** Staff chose this source ("Use this source instead"); null: chosen by the rules. */
  chosen: { by: string; at: string } | null
  /** Every other report printing this statement for the period, in rank order. */
  alsoIn: AlsoIn[]
}

export interface PeriodSources {
  column: string
  statements: StatementSource[]
  /** Current period: the profit and loss and balance sheet end on different dates (the message to show). */
  endsDiffer: string | null
}

/** A staff choice of source for one period and statement (comparison_source_choices; null: back to the rules). */
export interface SourceChoice {
  column: string
  statement: PrintedStatementKind
  documentId: string | null
  chosenBy: string
  chosenAt: string
}

export interface CellSource {
  documentId: string
  filename: string
  page: number
  /** The printed line, verbatim. */
  text: string
  /** The column header it sits under, as printed. */
  header: string
}

export interface Restatement {
  value: PrintedAmount
  /** "the FY2025 report". */
  report: string
  source: CellSource
}

export interface ComparisonCell {
  /** False: this year's report does not print the line (a blank cell). */
  printed: boolean
  value: PrintedAmount
  source: CellSource | null
  restated: Restatement[]
  /** A printed total that does not add up (verify.ts), or adds up only to rounding. */
  check: TotalCheck['status'] | null
  /** Read from a scanned page: the reading (or a staff correction), and where the line is on the page (for its crop). */
  scan?: ScanCell & { key: string; documentId: string; page: number; band: [number, number] | null; column: number }
}

export interface ComparisonRow {
  key: string
  path: string[]
  label: string
  style: PrintedRowStyle
  cells: ComparisonCell[]
}

export interface ComparisonTable {
  kind: PrintedStatementKind
  /** As printed by the report the order comes from. */
  title: string
  rows: ComparisonRow[]
}

export interface ComparisonFailure {
  kind: 'totals_reconciliation' | 'balance_sheet_equation'
  statement: PrintedStatementKind
  column: string
  financialYear: number
  currentPeriod: boolean
  documentId: string
  message: string
  terms: string[]
}

export interface DocumentUse {
  documentId: string
  filename: string
  status: PrintedRead['status'] | 'not_read'
  /** "Income Statement: FY2024, FY2023 · Balance Sheet: FY2024, FY2023". */
  found: string | null
  used: boolean
  /** For staff: why it is not used, or what could not be read. */
  message: string | null
  issues: PrintedRead['issues']
  /** The PDF has scanned pages: which, what was read, what was skipped. */
  scan?: ScanSummary
}

export interface PrintedComparison {
  columns: ComparisonColumn[]
  tables: ComparisonTable[]
  failures: ComparisonFailure[]
  documents: DocumentUse[]
  /** Annual years shown: fewer than two is not yet a comparison. */
  annualYears: number
  /** Years printed only as a comparative column, left out (unless asked for). */
  hiddenComparativeYears: number[]
  /** One per column: where each statement's figures come from, and where else they are printed. */
  periodSources: PeriodSources[]
}

export const NO_TEXT_LAYER_FOR_STAFF =
  'This PDF has no readable text. Please ask the accountant for the PDF exported from their accounting software.'

// ─── Which report each column comes from ──────────────────────────────────────

interface Instance {
  doc: ComparisonDocument
  statement: PrintedStatement
  statementIndex: number
  column: number
  /** The report's own period (its latest column), not a comparative. */
  own: boolean
  /** The PDF is a software export (reportKind.ts); a read stored before 25 Nov 2026 counts as annual statements. */
  isExport: boolean
}

const fyLabel = (fy: number) => `FY${fy}`

function instancesOf(docs: ComparisonDocument[]): Instance[] {
  const out: Instance[] = []
  for (const doc of docs) {
    const isExport = doc.read?.report?.kind === 'export'
    doc.read?.statements.forEach((statement, statementIndex) => {
      const latest = statement.columns.reduce((max, c) => (c.periodEnd > max ? c.periodEnd : max), '')
      statement.columns.forEach((c, column) => out.push({ doc, statement, statementIndex, column, own: c.periodEnd === latest, isExport }))
    })
  }
  return out
}

const ownEnd = (i: Instance) => i.statement.columns.reduce((max, c) => (c.periodEnd > max ? c.periodEnd : max), '')

/** The report's own financial year, for "the FY2025 report". */
function reportLabel(inst: Instance): string {
  if (inst.isExport) return `the export "${inst.doc.filename}"`
  const own = inst.statement.columns.reduce((a, b) => (b.periodEnd > a.periodEnd ? b : a))
  return own.kind === 'annual' ? `the ${fyLabel(own.financialYear)} report` : 'the current period report'
}

/** 1 own annual statements, 2 an export's column, 3 later annual statements' prior-year column. */
function tier(inst: Instance): 1 | 2 | 3 {
  if (inst.isExport) return 2
  return inst.own ? 1 : 3
}

function sourceKind(inst: Instance): SourceKind {
  if (inst.statement.columns[inst.column].kind === 'current_period') return 'current_period'
  return inst.isExport ? 'export' : inst.own ? 'annual_statements' : 'comparative'
}

function sourceLabel(inst: Instance): string {
  const kind = sourceKind(inst)
  if (kind === 'current_period') return inst.isExport ? 'Current-period report (export)' : 'Current-period financial statements'
  if (kind === 'annual_statements') return 'Annual financial statements'
  if (kind === 'comparative') {
    const own = inst.statement.columns.reduce((a, b) => (b.periodEnd > a.periodEnd ? b : a))
    return `Prior-year column of the ${fyLabel(own.financialYear)} financial statements`
  }
  const years = inst.statement.columns.filter((c) => c.kind === 'annual').map((c) => c.financialYear)
  return years.length > 1 ? `Multi-year export (${Math.max(...years)}–${Math.min(...years)})` : 'Export'
}

function describeSource(inst: Instance): PeriodSource {
  return {
    documentId: inst.doc.documentId,
    filename: inst.doc.filename,
    uploadedAt: inst.doc.uploadedAt,
    kind: sourceKind(inst),
    label: sourceLabel(inst),
    header: inst.statement.columns[inst.column].header,
  }
}

/**
 * Rank order for one period and statement. Annual: tier; within exports, the export whose latest
 * period it is first (an export's own year before its earlier columns); within prior-year columns,
 * the nearest later statements first; then the latest upload. Current period: the latest upload.
 */
function byRank(a: Instance, b: Instance): number {
  const upload = b.doc.uploadedAt.localeCompare(a.doc.uploadedAt)
  if (a.statement.columns[a.column].kind === 'current_period') return upload
  const t = tier(a) - tier(b)
  if (t) return t
  if (tier(a) === 2 && a.own !== b.own) return a.own ? -1 : 1
  if (tier(a) === 3) return ownEnd(a).localeCompare(ownEnd(b)) || upload
  return upload
}

function chooseColumns(instances: Instance[], comparativeYears: boolean): { columns: ComparisonColumn[]; hiddenYears: number[] } {
  const annual = new Map<number, Instance[]>()
  const latestCurrent = new Map<PrintedStatementKind, PrintedColumn>()
  for (const inst of instances) {
    const c = inst.statement.columns[inst.column]
    if (c.kind === 'annual') annual.set(c.financialYear, [...(annual.get(c.financialYear) ?? []), inst])
    else {
      const was = latestCurrent.get(inst.statement.kind)
      if (!was || c.periodEnd > was.periodEnd) latestCurrent.set(inst.statement.kind, c)
    }
  }
  // A year printed only as the prior-year column of later annual statements: shown on request.
  const shownByRule = (fy: number) => annual.get(fy)!.some((i) => tier(i) < 3)
  const hiddenYears = [...annual.keys()].filter((fy) => !shownByRule(fy)).sort((a, b) => a - b)
  const years = [...annual.keys()].filter((fy) => comparativeYears || shownByRule(fy)).sort((a, b) => a - b)
  const columns: ComparisonColumn[] = years.map((fy) => {
    // The period as its best-ranked report prints it (a profit and loss's start, when there is one).
    const ranked = [...annual.get(fy)!].sort(byRank)
    const c = (ranked.find((i) => i.statement.kind === 'profit_and_loss') ?? ranked[0]).statement.columns[(ranked.find((i) => i.statement.kind === 'profit_and_loss') ?? ranked[0]).column]
    return { key: fyLabel(fy), kind: 'annual', financialYear: fy, periodStart: c.periodStart, periodEnd: c.periodEnd }
  })
  const lastEnd = columns.length ? columns[columns.length - 1].periodEnd : ''
  // The current period: each statement's latest period end after the latest year.
  const current = [...latestCurrent.entries()].filter(([, c]) => c.periodEnd > lastEnd)
  if (current.length) {
    const latest = current.reduce((a, b) => (b[1].periodEnd > a[1].periodEnd ? b : a))[1]
    const pl = current.find(([k]) => k === 'profit_and_loss')?.[1]
    const ends = Object.fromEntries(current.map(([k, c]) => [k, c.periodEnd])) as Partial<Record<PrintedStatementKind, string>>
    const differ = new Set(Object.values(ends)).size > 1
    columns.push({
      key: 'current',
      kind: 'current_period',
      financialYear: latest.financialYear,
      periodStart: (pl ?? latest).periodStart,
      periodEnd: latest.periodEnd,
      ...(differ ? { ends } : {}),
    })
  }
  return { columns, hiddenYears: comparativeYears ? [] : hiddenYears }
}

function matches(inst: Instance, col: ComparisonColumn): boolean {
  const c = inst.statement.columns[inst.column]
  if (col.kind === 'annual') return c.kind === 'annual' && c.financialYear === col.financialYear
  return c.kind === 'current_period' && c.periodEnd === (col.ends?.[inst.statement.kind] ?? col.periodEnd)
}

/** The period's reports of one statement, best first, and the one used: a staff choice, else the best. */
function rankSources(instances: Instance[], kind: PrintedStatementKind, col: ComparisonColumn, choice: SourceChoice | undefined): { used: Instance | null; ranked: Instance[] } {
  const ranked = instances.filter((i) => i.statement.kind === kind && matches(i, col)).sort(byRank)
  // One per document (a report printing the statement twice keeps its first).
  const docs = ranked.filter((i, k) => ranked.findIndex((j) => j.doc === i.doc) === k)
  const chosen = choice?.documentId ? docs.find((i) => i.doc.documentId === choice.documentId) : undefined
  return { used: chosen ?? docs[0] ?? null, ranked: docs }
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

/**
 * Misspellings accountants print, fixed so the same line spelt two ways in
 * two years is one row (old reader labels.ts MISSPELLINGS). Applied to a row
 * key too, so a mapping confirmed before this still finds its row.
 */
const MISSPELLINGS: [RegExp, string][] = [
  [/\bassests?\b/g, 'assets'],
  [/\bliabilites\b/g, 'liabilities'],
  [/\bliabilties\b/g, 'liabilities'],
  [/\bmaintainance\b/g, 'maintenance'],
  [/\bmaintenence\b/g, 'maintenance'],
  [/\brecievables?\b/g, 'receivable'],
  [/\breceivables\b/g, 'receivable'],
  [/\bpayables\b/g, 'payable'],
  [/\bequipments\b/g, 'equipment'],
  [/\bfitings\b/g, 'fittings'],
  [/\bdepreciaton\b/g, 'depreciation'],
  [/\bdeverlopment\b/g, 'development'],
]

export function fixSpelling(s: string): string {
  return MISSPELLINGS.reduce((text, [wrong, right]) => text.replace(wrong, right), s)
}

const norm = (s: string) =>
  fixSpelling(
    s
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim(),
  )

interface BlockRow {
  key: string
  row: PrintedRow
  statement: PrintedStatement
  statementIndex: number
  /** The statement's column for this comparison column. */
  column: number
}

/** One document's rows of one statement kind (a Trading Statement then an Income Statement), keyed. */
function block(doc: ComparisonDocument, kind: PrintedStatementKind, col: ComparisonColumn, instances: Instance[]): BlockRow[] {
  const out: BlockRow[] = []
  const seen = new Map<string, number>()
  for (const inst of instances) {
    if (inst.doc !== doc || inst.statement.kind !== kind || !matches(inst, col)) continue
    for (const row of inst.statement.rows) {
      const base = `${kind}|${row.path.map(norm).join('>')}|${norm(row.label)}|${row.style === 'heading' ? 'h' : 'v'}`
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      out.push({ key: `${base}|${n}`, row, statement: inst.statement, statementIndex: inst.statementIndex, column: inst.column })
    }
  }
  return out
}

/** Adds a block's rows the merged order lacks, each after the row it follows in its own report. */
function mergeOrder(order: { key: string; row: PrintedRow }[], rows: BlockRow[]) {
  const at = new Map(order.map((o, i) => [o.key, i]))
  let previous = -1
  for (const r of rows) {
    const known = at.get(r.key)
    if (known !== undefined) {
      previous = known
      continue
    }
    order.splice(previous + 1, 0, { key: r.key, row: r.row })
    previous += 1
    at.clear()
    order.forEach((o, i) => at.set(o.key, i))
  }
}

/**
 * The same printed line across years when a report's section path differs
 * above the line's own heading (a scan read with "Non-Current Liabilities"
 * where another year prints "Liabilities › Non-Current Liabilities"): the
 * label and the DEEPEST heading match, and it is that heading's n-th such line.
 * Such a line takes the key the newer report gave it, so saved choices
 * (keyed on the newer report's lines) keep finding their row.
 */
function canonicalKeys(kind: PrintedStatementKind) {
  const byShape = new Map<string, string>()
  return (rows: BlockRow[]) => {
    const own = new Set(rows.map((r) => r.key))
    const count = new Map<string, number>()
    for (const r of rows) {
      const shape = `${kind}|${norm(r.row.path[r.row.path.length - 1] ?? '')}|${norm(r.row.label)}|${r.row.style === 'heading' ? 'h' : 'v'}`
      const n = count.get(shape) ?? 0
      count.set(shape, n + 1)
      const id = `${shape}#${n}`
      const known = byShape.get(id)
      if (known === undefined) byShape.set(id, r.key)
      // Only where this report has no line under the newer key itself.
      else if (known !== r.key && !own.has(known)) r.key = known
    }
  }
}

const sameAmount = (a: PrintedAmount, b: PrintedAmount) =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : a === b

function sourceOf(doc: ComparisonDocument, b: BlockRow): CellSource {
  return { documentId: doc.documentId, filename: doc.filename, page: b.row.page, text: b.row.text, header: b.statement.columns[b.column].header }
}

// ─── The comparison ───────────────────────────────────────────────────────────

const KINDS: PrintedStatementKind[] = ['profit_and_loss', 'balance_sheet']

export interface ComparisonOptions {
  /** Also show years printed only as a later report's comparative column ("Show earlier years…"). */
  comparativeYears?: boolean
  /** Staff choices of source ("Use this source instead"), the whole log: the latest per period and statement counts. */
  sourceChoices?: SourceChoice[]
}

/** "The profit and loss runs to 16 Nov 2026 but the balance sheet is as at 31 Oct 2026." */
function endsDifferMessage(ends: Partial<Record<PrintedStatementKind, string>>): string {
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const pl = ends.profit_and_loss
  const bs = ends.balance_sheet
  return pl && bs
    ? `The current-period profit and loss runs to ${day(pl)} but the balance sheet is as at ${day(bs)}: they do not cover the same period.`
    : 'The current-period statements end on different dates.'
}

/** The lines two reports of the same period print differently (or only one of them prints with a figure). */
function differingLines(source: BlockRow[], other: BlockRow[]): AlsoIn['differs'] {
  const out: AlsoIn['differs'] = []
  const value = (b: BlockRow | undefined) => (b ? b.row.amounts[b.column] : null)
  const keys = [...new Set([...source, ...other].filter((b) => b.row.style !== 'heading' && b.row.style !== 'ratio').map((b) => b.key))]
  for (const key of keys) {
    const s = source.find((b) => b.key === key)
    const o = other.find((b) => b.key === key)
    if (sameAmount(value(s), value(o))) continue
    const row = (s ?? o)!.row
    out.push({ key, label: row.label, path: row.path, source: value(s), other: value(o) })
  }
  return out
}

export function buildPrintedComparison(docs: ComparisonDocument[], { comparativeYears = false, sourceChoices = [] }: ComparisonOptions = {}): PrintedComparison {
  const instances = instancesOf(docs)
  const { columns, hiddenYears } = chooseColumns(instances, comparativeYears)
  const tables: ComparisonTable[] = []
  const failures: ComparisonFailure[] = []
  const usedDocs = new Set<string>()
  // The latest staff choice per period and statement (the log is append-only).
  const latestChoice = new Map<string, SourceChoice>()
  for (const c of [...sourceChoices].sort((a, b) => a.chosenAt.localeCompare(b.chosenAt))) latestChoice.set(`${c.column}|${c.statement}`, c)
  const periodSources: PeriodSources[] = columns.map((col) => ({
    column: col.key,
    statements: [],
    endsDiffer: col.ends ? endsDifferMessage(col.ends) : null,
  }))

  for (const kind of KINDS) {
    const ranks = columns.map((col) => rankSources(instances, kind, col, latestChoice.get(`${col.key}|${kind}`)))
    const sources = ranks.map((r) => r.used?.doc ?? null)
    const blocks = columns.map((col, i) => (sources[i] ? block(sources[i]!, kind, col, instances) : []))
    if (blocks.every((b) => b.length === 0)) {
      columns.forEach((_, i) => periodSources[i].statements.push({ statement: kind, source: null, chosen: null, alsoIn: [] }))
      continue
    }

    // The latest annual year's report sets the order; then newer to older; the current period last.
    const annualIdx = columns.map((c, i) => (c.kind === 'annual' ? i : -1)).filter((i) => i >= 0 && blocks[i].length)
    const orderIdx = [...annualIdx.reverse(), ...columns.map((c, i) => (c.kind === 'current_period' && blocks[i].length ? i : -1)).filter((i) => i >= 0)]
    // Newest report first: its keys are the ones the others take.
    const canonical = canonicalKeys(kind)
    for (const i of [...orderIdx, ...columns.keys()].filter((i, k, all) => all.indexOf(i) === k)) canonical(blocks[i])
    const order: { key: string; row: PrintedRow }[] = []
    for (const i of orderIdx) mergeOrder(order, blocks[i])

    const checkByCell = new Map<string, TotalCheck['status']>()
    columns.forEach((col, i) => {
      const doc = sources[i]
      if (!doc) return
      usedDocs.add(doc.documentId)
      const seen = new Set<number>()
      for (const b of blocks[i]) {
        if (seen.has(b.statementIndex)) continue
        seen.add(b.statementIndex)
        for (const check of verifyStatement(b.statement, b.statementIndex)) {
          if (check.column !== b.column) continue
          if (check.row !== null) {
            const row = b.statement.rows[check.row]
            const keyed = blocks[i].find((x) => x.row === row)
            if (keyed && check.status !== 'ok') checkByCell.set(`${keyed.key}#${i}`, check.status)
          }
          if (check.status === 'mismatch' || check.status === 'wrong_column') {
            failures.push({
              kind: check.kind === 'balance_sheet' ? 'balance_sheet_equation' : 'totals_reconciliation',
              statement: kind,
              column: col.key,
              financialYear: col.financialYear,
              currentPeriod: col.kind === 'current_period',
              documentId: doc.documentId,
              message: `${doc.filename}, ${b.statement.title} (page ${b.statement.pages.join(', ')}): ${check.message}`,
              terms: check.terms,
            })
          }
        }
      }
    })

    // Per column, each other report printing that period: one block per report, in rank order.
    const comparatives = columns.map((col, i) =>
      ranks[i].ranked
        .filter((inst) => inst.doc !== sources[i])
        .map((inst) => {
          const rows = block(inst.doc, kind, col, instances)
          canonical(rows)
          return { inst, rows }
        }),
    )
    columns.forEach((col, i) => {
      const used = ranks[i].used
      const choice = latestChoice.get(`${col.key}|${kind}`)
      periodSources[i].statements.push({
        statement: kind,
        source: used ? describeSource(used) : null,
        chosen: used && choice?.documentId === used.doc.documentId ? { by: choice.chosenBy, at: choice.chosenAt } : null,
        alsoIn: comparatives[i].map(({ inst, rows }) => ({ ...describeSource(inst), differs: differingLines(blocks[i], rows) })),
      })
    })

    const rows: ComparisonRow[] = order.map(({ key, row }) => ({
      key,
      path: row.path,
      label: row.label,
      style: row.style,
      cells: columns.map((col, i) => {
        const found = blocks[i].find((b) => b.key === key)
        const restated: Restatement[] = []
        if (row.style !== 'heading') {
          // Every other report printing this period (a later report's comparative, an export's column).
          for (const { inst, rows: otherRows } of comparatives[i]) {
            const other = otherRows.find((b) => b.key === key)
            if (!other) continue
            const value = other.row.amounts[other.column]
            // A nil "-" for a line the year's own report does not print says the same thing.
            if (!found && value === null) continue
            if (!found || !sameAmount(value, found.row.amounts[found.column])) {
              restated.push({ value, report: reportLabel(inst), source: sourceOf(inst.doc, other) })
            }
          }
        }
        const scanCell = found?.row.scan?.cells[found.column]
        return found
          ? {
              printed: true,
              value: found.row.amounts[found.column],
              source: sourceOf(sources[i]!, found),
              restated,
              check: checkByCell.get(`${key}#${i}`) ?? null,
              ...(scanCell
                ? { scan: { ...scanCell, key: found.row.scan!.key, documentId: sources[i]!.documentId, page: found.row.page, band: found.row.scan!.band, column: found.column } }
                : {}),
            }
          : { printed: false, value: null, source: null, restated, check: null }
      }),
    }))
    const titleSource = blocks[orderIdx[0]]?.[0]
    tables.push({ kind, title: titleSource?.statement.title ?? (kind === 'profit_and_loss' ? 'Profit and Loss' : 'Balance Sheet'), rows })
  }

  return {
    columns,
    tables,
    failures,
    documents: describeDocuments(docs, usedDocs),
    annualYears: columns.filter((c) => c.kind === 'annual').length,
    hiddenComparativeYears: hiddenYears,
    periodSources,
  }
}


function describeDocuments(docs: ComparisonDocument[], used: Set<string>): DocumentUse[] {
  return docs.map((doc) => {
    const read = doc.read
    if (!read) return { documentId: doc.documentId, filename: doc.filename, status: 'not_read', found: null, used: false, message: 'Not read yet.', issues: [] }
    const found = read.statements.length
      ? read.statements.map((s) => `${s.title}: ${s.columns.map((c) => (c.kind === 'annual' ? fyLabel(c.financialYear) : `to ${c.periodEnd}`)).join(', ')}`).join(' · ')
      : null
    const message =
      read.status === 'scan_pending'
        ? (read.scan?.message ?? 'Scanned pages are being read.')
        : read.status === 'no_text_layer'
        ? NO_TEXT_LAYER_FOR_STAFF
        : read.status === 'failed'
          ? read.issues.map((i) => i.message).join(' ')
        : read.status === 'no_statements'
          ? 'No profit and loss or balance sheet page was found in this PDF.'
          : read.issues.length
            ? `Some of it could not be read: ${read.issues.map((i) => i.message).join(' ')}`
            : used.has(doc.documentId)
              ? null
              : 'Not used: each year it prints comes from another report.'
    return { documentId: doc.documentId, filename: doc.filename, status: read.status, found, used: used.has(doc.documentId), message, issues: read.issues, ...(read.scan ? { scan: read.scan } : {}) }
  })
}
