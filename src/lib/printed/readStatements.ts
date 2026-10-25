import type { PdfCell, PdfLine } from '@/lib/pdf/pageLines'
import { isLoneMinus, parseAmount } from './amounts'
import { columnPeriod, titlePeriod } from './periods'
import { structureRows, type UnstructuredRow } from './structure'
import type { PrintedAmount, PrintedColumn, PrintedRead, PrintedStatement, PrintedStatementKind, ReadIssue } from './types'

/**
 * Positioned text lines (lib/pdf/pageLines.ts) -> the profit and loss and
 * balance sheet rows exactly as printed. Pure and deterministic: no model,
 * nothing calculated, renamed or guessed.
 *
 * A statement page reads top to bottom as
 *
 *   title block   entity, "Balance Sheet", "As at 30 June 2024"   (the title within the first lines)
 *   header line   "NOTES   2024   2023" / "Total" / "30 JUNE 2024"  (each cell a year, a date or "Total")
 *   rows          label cells on the left, one amount cell per column, placed by the
 *                 column whose right edge is nearest (figures are right-aligned)
 *   footer        page numbers, repeated lines, the accountant's sentences
 *
 * Pages without a P&L or balance sheet title are not read: cover, contents,
 * cash flow, notes, declarations, tax returns, depreciation schedules.
 * What cannot be read is reported as an issue with its page and text, never
 * guessed around.
 */

const PL_TITLE =
  /^(detailed\s+)?(profit\s*(and|&)\s*loss(\s+statement|\s+account)?|income\s+statement|trading\s+statement|statement\s+of\s+profit\s+or\s+loss(\s+and\s+other\s+comprehensive\s+income)?|statement\s+of\s+comprehensive\s+income|operating\s+statement|trading\s*(and|&)\s*profit\s*(and|&)\s*loss(\s+statement|\s+account)?)$/i
const BS_TITLE = /^(detailed\s+)?(balance\s+sheet|statement\s+of\s+financial\s+position)$/i
/** A title of anything but a P&L or balance sheet: such a page never continues one. */
const OTHER_TITLE = /\b(statement|notes?|schedule|report|declaration|reconciliation|worksheet|return|summary)\b/i
/** The title is printed within the first lines of the page. */
const TITLE_WITHIN = 8

const YEAR = /\b(19|20)\d{2}\b/
const HEADER_WORD = /^(total|notes?|\$|a\$|aud|\.|ytd|actual)$/i
const NOTES_HEADER = /^notes?$/i
const CURRENCY_ONLY = /^((\$|A\$|AUD|\$'000)\s*)+$/i
const PAGE_NUMBER = /(^\d+\s*(\/|of)\s*\d+$)|(\bpage\s+\d+(\s+of\s+\d+)?\b)/i
/** Furthest a figure sits from its column's right edge. */
const MAX_COLUMN_DISTANCE = 60

function statementKind(text: string): PrintedStatementKind | null {
  const t = text.replace(/\s+/g, ' ').trim()
  if (PL_TITLE.test(t)) return 'profit_and_loss'
  if (BS_TITLE.test(t)) return 'balance_sheet'
  return null
}

/** A title is a line on its own: one cell (a contents page prints "3  Income Statement"). */
function findTitle(lines: PdfLine[]): { index: number; kind: PrintedStatementKind; title: string } | null {
  for (let i = 0; i < Math.min(lines.length, TITLE_WITHIN); i++) {
    if (lines[i].cells.length !== 1) continue
    const kind = statementKind(lines[i].text)
    if (kind) return { index: i, kind, title: lines[i].text }
  }
  return null
}

function isHeaderCell(text: string): boolean {
  const t = text.trim()
  if (HEADER_WORD.test(t)) return true
  if (!YEAR.test(t) || t.split(/\s+/).length > 4) return false
  // A figure is not a header ("2,024", "2024.00").
  return !/[,.]\d/.test(t)
}

function isHeaderLine(line: PdfLine): boolean {
  return line.cells.length > 0 && line.cells.every((c) => isHeaderCell(c.text)) && line.cells.some((c) => YEAR.test(c.text) || /^total$/i.test(c.text.trim()))
}

/** A label ending mid-phrase continues on the next line. */
const WRAPS = /\b(the|of|and|to|for|at|in|on|from|by|with)$|[&,-]$/i

/** A wrapped header line's cells end where the header's columns end. */
const HEADER_ALIGN = 15

function isHeaderContinuation(line: PdfLine, anchors: Anchor[]): boolean {
  return line.cells.every(
    (c) => /[a-z0-9]/i.test(c.text) && isHeaderCell(c.text) && !HEADER_WORD.test(c.text.trim()) && anchors.some((a) => !a.notes && Math.abs(a.right - c.right) <= HEADER_ALIGN),
  )
}

function isSentence(text: string): boolean {
  const words = text.trim().split(/\s+/)
  return words.length >= 8 || (words.length >= 2 && /\.$/.test(text.trim()) && !/\d\.$/.test(text.trim()))
}

interface Anchor {
  header: string
  x: number
  right: number
  notes: boolean
}

interface PageRead {
  page: number
  kind: PrintedStatementKind
  title: string
  titleBlock: string[]
  anchors: Anchor[]
  rows: (UnstructuredRow & { text: string; page: number; cents: boolean })[]
}

/**
 * A page with no title straight after a statement page continues it when it
 * repeats that page's column header ("2026  2025") near its top. The header
 * is found as on any page; index -1 stands for the (unprinted) title.
 */
function continuationOf(lines: PdfLine[], previous: PageRead | null): { index: number; kind: PrintedStatementKind; title: string } | null {
  if (!previous) return null
  const wanted = previous.anchors.filter((a) => !a.notes).map((a) => a.header.split(' ')[0])
  for (let i = 0; i < Math.min(lines.length, TITLE_WITHIN); i++) {
    // Another statement's title (cash flows, notes, appropriation…): a page of its own.
    if (lines[i].cells.length === 1 && OTHER_TITLE.test(lines[i].text)) return null
    if (!isHeaderLine(lines[i])) continue
    const found = lines[i].cells.filter((c) => !HEADER_WORD.test(c.text.trim()) || /^total$/i.test(c.text.trim())).map((c) => c.text.trim().split(' ')[0])
    if (found.length === wanted.length && found.every((f, j) => f === wanted[j])) return { index: i - 1, kind: previous.kind, title: previous.title }
  }
  // No header either: the first figures sit under the previous page's columns.
  const columns = previous.anchors.filter((a) => !a.notes)
  const firstFigures = lines.slice(0, TITLE_WITHIN).find((l) => l.cells.some((c) => /\d/.test(c.text) && parseAmount(c.text)?.kind === 'amount'))
  const figures = firstFigures?.cells.filter((c) => parseAmount(c.text)) ?? []
  if (figures.length && figures.every((c) => columns.some((a) => Math.abs(a.right - c.right) <= MAX_COLUMN_DISTANCE / 2))) {
    return { index: -1, kind: previous.kind, title: previous.title }
  }
  return null
}

function readPage(page: number, lines: PdfLine[], issues: ReadIssue[], repeated: Set<string>, previous: PageRead | null): PageRead | null {
  const title = findTitle(lines) ?? continuationOf(lines, previous?.page === page - 1 ? previous : null)
  if (!title) return null

  let header = -1
  for (let i = title.index + 1; i < lines.length; i++) {
    if (isHeaderLine(lines[i])) {
      header = i
      break
    }
    // A figure before any header: this page has none of its own.
    if (lines[i].cells.some((c) => parseAmount(c.text)?.kind === 'amount' && /\d/.test(c.text))) break
  }
  let anchors: Anchor[]
  let titleBlock: string[]
  let first: number
  if (header >= 0) {
    anchors = lines[header].cells
      .filter((c) => !/^(\$|a\$|aud|\.)$/i.test(c.text.trim()))
      .map((c) => ({ header: c.text.trim(), x: c.x, right: c.right, notes: NOTES_HEADER.test(c.text.trim()) }))
    titleBlock = lines.slice(0, header).map((l) => l.text)
    first = header + 1
    // A header that wraps ("1 JULY 2025-4 MAY" over "2026"): its next line joins the column above.
    while (first < lines.length && isHeaderContinuation(lines[first], anchors)) {
      for (const cell of lines[first].cells) {
        const anchor = anchors.find((a) => Math.abs(a.right - cell.right) <= HEADER_ALIGN)!
        anchor.header = `${anchor.header} ${cell.text.trim()}`
      }
      first++
    }
  } else if (previous && previous.kind === title.kind && previous.title === title.title) {
    // A continuation page that does not repeat the header: the previous page's columns.
    anchors = previous.anchors
    titleBlock = previous.titleBlock
    first = title.index + 1
  } else {
    issues.push({
      kind: 'no_column_header',
      page,
      text: lines[title.index + 1]?.text ?? null,
      message: `"${title.title}" on page ${page}: no column header line (years, dates or "Total") found under the title.`,
    })
    return null
  }

  const columns = anchors.filter((a) => !a.notes)
  if (columns.length === 0) {
    issues.push({ kind: 'no_column_header', page, text: lines[header]?.text ?? null, message: `Page ${page}: the header line has no amount columns.` })
    return null
  }
  const zoneStart = Math.min(...anchors.map((a) => Math.min(a.x, a.right - 80))) - 20

  const rows: PageRead['rows'] = []
  for (let i = first; i < lines.length; i++) {
    const line = lines[i]
    // Page numbers print wherever the footer is, in the figure columns too ("3/5", "Page 3 of 10").
    // Running headers and footers print on every page, across the columns too.
    if (CURRENCY_ONLY.test(line.text) || isHeaderLine(line) || PAGE_NUMBER.test(line.text) || repeated.has(line.text)) continue
    const labelCells = line.cells.filter((c) => c.x < zoneStart)
    const amountCells = line.cells.filter((c) => c.x >= zoneStart)
    // Text across the figure columns with no label and no figure: an e-signature
    // stamp ("Doc ID: …"), a watermark. Not a row. A line with any figure is read
    // (and its unreadable cells reported).
    if (labelCells.length === 0 && !amountCells.some((c) => parseAmount(c.text) || isLoneMinus(c.text))) continue
    if (amountCells.length === 0) {
      // Furniture: page numbers, lines on every page, the accountant's sentences.
      if (repeated.has(line.text) || isSentence(line.text)) continue
      // A label that wraps ("Add Retained Profits B/Fwd at The" / "Beginning Of Year"): one line.
      const previous = rows[rows.length - 1]
      if (previous?.hasAmounts && Math.abs(previous.x - line.cells[0].x) <= 1 && WRAPS.test(previous.label)) {
        previous.label = `${previous.label} ${line.text}`
        previous.text = `${previous.text} / ${line.text}`
        continue
      }
    }
    const row = readRow(page, line, labelCells, amountCells, anchors, columns, issues)
    if (row) rows.push(row)
  }
  return { page, kind: title.kind, title: title.title, titleBlock, anchors, rows }
}

/**
 * "- 116,215": a minus printed to the left of its figure. A nil "-" sits on
 * its column's right edge, under the figures; a sign sits clear of every
 * column edge, just before a figure.
 */
const ON_COLUMN_EDGE = 15
const SIGN_GAP = 40

function joinMinusSigns(cells: PdfCell[], anchors: Anchor[]): PdfCell[] {
  const out: PdfCell[] = []
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]
    const next = cells[i + 1]
    const figure = next && parseAmount(next.text)
    const onEdge = anchors.some((a) => Math.abs(a.right - cell.right) <= ON_COLUMN_EDGE)
    if (isLoneMinus(cell.text) && !onEdge && figure?.kind === 'amount' && figure.value !== null && next.x - cell.right < SIGN_GAP) {
      out.push({ x: cell.x, right: next.right, text: `-${next.text.replace(/^-/, '')}` })
      i++
    } else out.push(cell)
  }
  return out
}

function readRow(
  page: number,
  line: PdfLine,
  labelCells: PdfCell[],
  amountCells: PdfCell[],
  anchors: Anchor[],
  columns: Anchor[],
  issues: ReadIssue[],
): PageRead['rows'][number] | null {
  const amounts: PrintedAmount[] = columns.map(() => null)
  const filled = columns.map(() => false)
  let cents = false
  for (const cell of joinMinusSigns(amountCells, anchors)) {
    const nearest = anchors.reduce((best, a) => (Math.abs(a.right - cell.right) < Math.abs(best.right - cell.right) ? a : best))
    if (Math.abs(nearest.right - cell.right) > MAX_COLUMN_DISTANCE) {
      issues.push({ kind: 'unplaced_cell', page, text: line.text, message: `Page ${page}: "${cell.text}" is not under any column of the header.` })
      return null
    }
    if (nearest.notes) continue
    const j = columns.indexOf(nearest)
    const parsed = parseAmount(cell.text)
    if (!parsed) {
      issues.push({ kind: 'unparsed_amount', page, text: line.text, message: `Page ${page}: "${cell.text}" sits in the ${columns[j].header} column but is not an amount.` })
      return null
    }
    if (filled[j]) {
      issues.push({ kind: 'unplaced_cell', page, text: line.text, message: `Page ${page}: two figures in the ${columns[j].header} column on one line.` })
      return null
    }
    if (parsed.kind === 'ratio') amounts[j] = parsed.text
    else {
      amounts[j] = parsed.value
      cents ||= parsed.cents
    }
    filled[j] = true
  }
  return {
    page,
    x: (labelCells[0] ?? amountCells[0] ?? line.cells[0]).x,
    label: labelCells.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim(),
    amounts,
    hasAmounts: filled.some(Boolean),
    text: line.text,
    cents,
  }
}

/** Lines a page's footer is drawn from. */
const FOOTER_LINES = 3

/** Lines a page's running header is drawn from. */
const HEADER_LINES = 2

/**
 * Running headers and footers: a line with no figures among the first or last
 * lines of two or more pages ("ZAUK Enterprises Pty Ltd" under every
 * statement, "Financial Statements | 30 June 2023 | <entity>" over it). A
 * heading that happens to end one page ("Equity", continued overleaf) is not one.
 */
function repeatedLines(pages: PdfLine[][]): Set<string> {
  const bottoms = new Map<string, number>()
  for (const lines of pages) {
    const seen = new Set<string>()
    for (const line of [...lines.slice(0, HEADER_LINES), ...lines.slice(-FOOTER_LINES)]) {
      if (line.cells.some((c) => /\d/.test(c.text) && parseAmount(c.text))) continue
      if (!seen.has(line.text)) bottoms.set(line.text, (bottoms.get(line.text) ?? 0) + 1)
      seen.add(line.text)
    }
  }
  return new Set([...bottoms].filter(([, n]) => n >= 2).map(([text]) => text))
}

export function readStatements(pages: PdfLine[][]): PrintedRead {
  const issues: ReadIssue[] = []
  if (pages.every((lines) => lines.length === 0)) {
    return { status: 'no_text_layer', pageCount: pages.length, statements: [], issues: [{ kind: 'no_text_layer', page: null, text: null, message: 'This PDF has no readable text.' }] }
  }
  const repeated = repeatedLines(pages)
  const reads: PageRead[] = []
  let previous: PageRead | null = null
  pages.forEach((lines, i) => {
    const read = readPage(i + 1, lines, issues, repeated, previous)
    if (read) reads.push(read)
    previous = read
  })

  // Consecutive pages with the same title are one statement.
  const groups: PageRead[][] = []
  for (const read of reads) {
    const last = groups[groups.length - 1]
    const prev = last?.[last.length - 1]
    if (prev && prev.page === read.page - 1 && prev.kind === read.kind && prev.title.toLowerCase() === read.title.toLowerCase()) last.push(read)
    else groups.push([read])
  }

  const statements: PrintedStatement[] = []
  for (const group of groups) {
    const head = group[0]
    // After the last figure on the statement's last page: notes, signatures, the accountant's statement.
    const tail = group[group.length - 1]
    const lastFigure = tail.rows.map((r) => r.hasAmounts).lastIndexOf(true)
    tail.rows = tail.rows.slice(0, lastFigure + 1)

    const period = titlePeriod(head.titleBlock)
    const columns: PrintedColumn[] = []
    for (const anchor of head.anchors.filter((a) => !a.notes)) {
      const column = columnPeriod(anchor.header, period, head.kind)
      if (!column) {
        issues.push({
          kind: 'unknown_period',
          page: head.page,
          text: anchor.header,
          message: `"${head.title}" on page ${head.page}: no period for the column "${anchor.header}" (title block: ${head.titleBlock.join(' / ') || 'none'}).`,
        })
        continue
      }
      columns.push(column)
    }
    if (columns.length !== head.anchors.filter((a) => !a.notes).length) continue

    const rows = group.flatMap((g) => g.rows)
    statements.push({
      kind: head.kind,
      title: head.title,
      pages: group.map((g) => g.page),
      columns,
      rows: structureRows(head.kind, rows).map(({ page, path, label, style, amounts, text }) => ({ page, path, label, style, amounts, text })),
      wholeDollars: !rows.some((r) => r.cents),
    })
  }

  if (statements.length === 0 && issues.length === 0) {
    issues.push({ kind: 'no_statements', page: null, text: null, message: 'No page is titled as a profit and loss or a balance sheet.' })
  }
  return { status: statements.length ? 'read' : 'no_statements', pageCount: pages.length, statements, issues }
}
