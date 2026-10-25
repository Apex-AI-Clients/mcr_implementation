import { verifyStatement, type TotalCheck } from './verify'
import type { PrintedAmount, PrintedColumn, PrintedRead, PrintedRow, PrintedRowStyle, PrintedStatement, PrintedStatementKind } from './types'

/**
 * The as-printed comparison: a client's financial statement PDFs, read by
 * readStatements.ts, side by side. Pure. Nothing is calculated, renamed or
 * invented: every figure is a printed figure, with the file, page and line it
 * came from.
 *
 *   Columns   the latest YEAR_WINDOW financial years, oldest first, then the
 *             current period (when it ends after the latest year).
 *   Sources   each year from its own report; a comparative column of a later
 *             report only when the year has no report of its own.
 *   Rows      the latest report's printed order. A line only an earlier year
 *             prints goes under the same heading, after the line it follows
 *             there. Nothing is dropped; a line a year does not print is blank.
 *   Restated  a later report printing a different figure for the same year
 *             and line: the own report's figure stays, with a note.
 *   Checks    every printed total of every report used, against its lines
 *             (verify.ts). A failure is a hard check: Needs review.
 */

export const YEAR_WINDOW = 4

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
}

export interface PrintedComparison {
  columns: ComparisonColumn[]
  tables: ComparisonTable[]
  failures: ComparisonFailure[]
  documents: DocumentUse[]
  /** Annual years shown: fewer than two is not yet a comparison. */
  annualYears: number
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
}

const fyLabel = (fy: number) => `FY${fy}`


function instancesOf(docs: ComparisonDocument[]): Instance[] {
  const out: Instance[] = []
  for (const doc of docs) {
    doc.read?.statements.forEach((statement, statementIndex) => {
      const latest = statement.columns.reduce((max, c) => (c.periodEnd > max ? c.periodEnd : max), '')
      statement.columns.forEach((c, column) => out.push({ doc, statement, statementIndex, column, own: c.periodEnd === latest }))
    })
  }
  return out
}

/** The report's own financial year, for "the FY2025 report". */
function reportLabel(inst: Instance): string {
  const own = inst.statement.columns.reduce((a, b) => (b.periodEnd > a.periodEnd ? b : a))
  return own.kind === 'annual' ? `the ${fyLabel(own.financialYear)} report` : 'the current period report'
}

function chooseColumns(instances: Instance[]): ComparisonColumn[] {
  const annual = new Map<number, PrintedColumn>()
  let current: PrintedColumn | null = null
  for (const inst of instances) {
    const c = inst.statement.columns[inst.column]
    if (c.kind === 'annual') {
      if (!annual.has(c.financialYear) || inst.own) annual.set(c.financialYear, c)
    } else if (!current || c.periodEnd > current.periodEnd) {
      current = c
    }
  }
  const years = [...annual.keys()].sort((a, b) => a - b).slice(-YEAR_WINDOW)
  const columns: ComparisonColumn[] = years.map((fy) => {
    const c = annual.get(fy)!
    return { key: fyLabel(fy), kind: 'annual', financialYear: fy, periodStart: c.periodStart, periodEnd: c.periodEnd }
  })
  const lastEnd = columns.length ? columns[columns.length - 1].periodEnd : ''
  if (current && current.periodEnd > lastEnd) {
    columns.push({ key: 'current', kind: 'current_period', financialYear: current.financialYear, periodStart: current.periodStart, periodEnd: current.periodEnd })
  }
  return columns
}

function matches(inst: Instance, col: ComparisonColumn): boolean {
  const c = inst.statement.columns[inst.column]
  return col.kind === 'annual' ? c.kind === 'annual' && c.financialYear === col.financialYear : c.kind === 'current_period' && c.periodEnd === col.periodEnd
}

/** The year's own report (latest upload), else the comparative in the nearest later report. */
function sourceDocument(instances: Instance[], kind: PrintedStatementKind, col: ComparisonColumn): ComparisonDocument | null {
  const candidates = instances.filter((i) => i.statement.kind === kind && matches(i, col))
  if (candidates.length === 0) return null
  const own = candidates.filter((i) => i.own).sort((a, b) => b.doc.uploadedAt.localeCompare(a.doc.uploadedAt))
  if (own.length) return own[0].doc
  const ownEnd = (i: Instance) => i.statement.columns.reduce((max, c) => (c.periodEnd > max ? c.periodEnd : max), '')
  return [...candidates].sort((a, b) => ownEnd(a).localeCompare(ownEnd(b)) || b.doc.uploadedAt.localeCompare(a.doc.uploadedAt))[0].doc
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

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

const sameAmount = (a: PrintedAmount, b: PrintedAmount) =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : a === b

function sourceOf(doc: ComparisonDocument, b: BlockRow): CellSource {
  return { documentId: doc.documentId, filename: doc.filename, page: b.row.page, text: b.row.text, header: b.statement.columns[b.column].header }
}

// ─── The comparison ───────────────────────────────────────────────────────────

const KINDS: PrintedStatementKind[] = ['profit_and_loss', 'balance_sheet']

export function buildPrintedComparison(docs: ComparisonDocument[]): PrintedComparison {
  const instances = instancesOf(docs)
  const columns = chooseColumns(instances)
  const tables: ComparisonTable[] = []
  const failures: ComparisonFailure[] = []
  const usedDocs = new Set<string>()

  for (const kind of KINDS) {
    const sources = columns.map((col) => sourceDocument(instances, kind, col))
    const blocks = columns.map((col, i) => (sources[i] ? block(sources[i]!, kind, col, instances) : []))
    if (blocks.every((b) => b.length === 0)) continue

    // The latest annual year's report sets the order; then newer to older; the current period last.
    const annualIdx = columns.map((c, i) => (c.kind === 'annual' ? i : -1)).filter((i) => i >= 0 && blocks[i].length)
    const orderIdx = [...annualIdx.reverse(), ...columns.map((c, i) => (c.kind === 'current_period' && blocks[i].length ? i : -1)).filter((i) => i >= 0)]
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

    // Per column, each other report printing that year as a comparative: one block per report.
    const comparatives = columns.map((col, i) => {
      const out: { inst: Instance; rows: BlockRow[] }[] = []
      for (const inst of instances) {
        if (inst.statement.kind !== kind || inst.own || !matches(inst, col) || inst.doc === sources[i]) continue
        if (out.some((o) => o.inst.doc === inst.doc)) continue
        out.push({ inst, rows: block(inst.doc, kind, col, instances) })
      }
      return out
    })

    const rows: ComparisonRow[] = order.map(({ key, row }) => ({
      key,
      path: row.path,
      label: row.label,
      style: row.style,
      cells: columns.map((col, i) => {
        const found = blocks[i].find((b) => b.key === key)
        const restated: Restatement[] = []
        if (col.kind === 'annual' && row.style !== 'heading') {
          // Later reports printing this year as a comparative.
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
        return found
          ? {
              printed: true,
              value: found.row.amounts[found.column],
              source: sourceOf(sources[i]!, found),
              restated,
              check: checkByCell.get(`${key}#${i}`) ?? null,
            }
          : { printed: false, value: null, source: null, restated, check: null }
      }),
    }))
    const titleSource = blocks[orderIdx[0]]?.[0]
    tables.push({ kind, title: titleSource?.statement.title ?? (kind === 'profit_and_loss' ? 'Profit and Loss' : 'Balance Sheet'), rows })
  }

  return { columns, tables, failures, documents: describeDocuments(docs, usedDocs, new Set(columns.filter((c) => c.kind === 'annual').map((c) => c.financialYear))), annualYears: columns.filter((c) => c.kind === 'annual').length }
}

function describeDocuments(docs: ComparisonDocument[], used: Set<string>, shownYears: Set<number>): DocumentUse[] {
  return docs.map((doc) => {
    const read = doc.read
    if (!read) return { documentId: doc.documentId, filename: doc.filename, status: 'not_read', found: null, used: false, message: 'Not read yet.', issues: [] }
    const found = read.statements.length
      ? read.statements.map((s) => `${s.title}: ${s.columns.map((c) => (c.kind === 'annual' ? fyLabel(c.financialYear) : `to ${c.periodEnd}`)).join(', ')}`).join(' · ')
      : null
    const message =
      read.status === 'no_text_layer'
        ? NO_TEXT_LAYER_FOR_STAFF
        : read.status === 'failed'
          ? read.issues.map((i) => i.message).join(' ')
        : read.status === 'no_statements'
          ? 'No profit and loss or balance sheet page was found in this PDF.'
          : read.issues.length
            ? `Some of it could not be read: ${read.issues.map((i) => i.message).join(' ')}`
            : used.has(doc.documentId)
              ? null
              : shownYears.size && read.statements.every((s) => s.columns.every((c) => c.kind === 'annual' && c.financialYear < Math.min(...shownYears)))
                ? `Not used: older than the latest ${YEAR_WINDOW} years.`
                : 'Not used: each year it prints comes from another report.'
    return { documentId: doc.documentId, filename: doc.filename, status: read.status, found, used: used.has(doc.documentId), message, issues: read.issues }
  })
}
