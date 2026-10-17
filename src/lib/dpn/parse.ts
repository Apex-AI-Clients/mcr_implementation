import type { PdfCell, PdfLine } from '@/lib/pdf/pageLines'
import type {
  DirectorPenaltyNotice,
  DpnAmounts,
  DpnParseResult,
  DpnRow,
  DpnType,
} from './types'

/**
 * Reads an ATO director penalty notice from its text layer. Pure: positioned
 * lines in (lib/pdf/pageLines.ts), a notice out. Deterministic, no AI model —
 * the notice carries the director's personal details.
 *
 * The layout this follows (ATO notices, OpenText Exstream, 4 pages):
 *
 *   Page 1, right column   "Our reference:"  <value>
 *                          "Date of issue:"  <D Month YYYY>
 *   Page 1, left column    "This notice is for" <PAYG withholding | GST | …>
 *                          "For this company"   <company name>
 *                          "With this ACN"      <9 digits>
 *   Page 3                 "TO: <director's name>", then the home address
 *   Pages 3–4              the table, its header ("Column 1" … "Column 5")
 *                          repeated at the top of page 4; one row per period:
 *                          "DD MON YYYY to DD MON YYYY", then Columns 2–5.
 *
 * Page 1 prints the mailing block (name and address) on the same baselines as
 * the right-hand column, so a whole line would run the director's name into
 * "Our reference:". Every field is therefore read by cell: the label's own
 * cell, then the cell straight after it.
 *
 * The director's name is taken from the "TO:" line alone. The lines under it
 * are their home address: never read into the result, never logged.
 *
 * Table figures are right-aligned, so a figure's left edge moves with its
 * width. Each is placed by its RIGHT edge, between the left edge of its own
 * column header and the next one's. A blank or extra cell makes the table
 * unreadable rather than shifting figures into the wrong column.
 */

const DPN_WORDING = /director penalty notice|director's liability to pay a penalty/i

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

/** "30 September 2026", "30 SEP 2026" or "30/09/2026" -> "2026-09-30". */
export function parseNoticeDate(raw: string): string | null {
  const text = raw.trim()
  let day: number, month: number | undefined, year: number

  const words = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(text)
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  if (words) {
    day = Number(words[1])
    month = MONTHS[words[2].toLowerCase()] ?? MONTHS[words[2].slice(0, 3).toLowerCase()]
    year = Number(words[3])
  } else if (slashed) {
    day = Number(slashed[1])
    month = Number(slashed[2])
    year = Number(slashed[3])
  } else {
    return null
  }
  if (!month) return null

  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return date.toISOString().slice(0, 10)
}

/**
 * A figure as the notice prints it, in cents. "1,234.56", "$1,234.56";
 * negatives as "-1,234.56", "(1,234.56)" or "1,234.56 CR". Null when the text
 * is not a figure.
 */
export function parseMoney(raw: string): number | null {
  const match = /^(\()?(-)?\$?\s?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})(\))?\s*(CR)?$/i.exec(raw.trim())
  if (!match) return null
  const [, open, minus, whole, cents, close, credit] = match
  if (Boolean(open) !== Boolean(close)) return null
  const value = Number(whole.replace(/,/g, '')) * 100 + Number(cents)
  return open || minus || credit ? -value : value
}

const PERIOD = /^(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s+to\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})$/i

/**
 * The value printed after a label. The label is matched against the start of
 * a cell; the value is the rest of that cell, or else the next cell along.
 */
function valueAfter(pages: PdfLine[][], label: RegExp): string | null {
  for (const page of pages) {
    for (const line of page) {
      for (let i = 0; i < line.cells.length; i++) {
        const match = label.exec(line.cells[i].text)
        if (!match) continue
        const rest = line.cells[i].text.slice(match[0].length).trim()
        const value = rest || line.cells[i + 1]?.text.trim() || ''
        if (value) return value
      }
    }
  }
  return null
}

function typeOf(text: string): DpnType | null {
  if (/superannuation guarantee|super guarantee/i.test(text)) return 'sgc'
  if (/\bGST\b|goods and services tax/i.test(text)) return 'gst'
  if (/PAYG withholding/i.test(text)) return 'paygw'
  return null
}

/**
 * The notice's type: what "This notice is for" says, else the subtitle on the
 * page-3 notice ("PAYG withholding amounts", "Assessed net goods and services
 * tax amounts").
 */
function readType(pages: PdfLine[][]): DpnType | null {
  const stated = valueAfter(pages, /^This notice is for\b/i)
  const fromStated = stated ? typeOf(stated) : null
  if (fromStated) return fromStated
  for (const page of pages) {
    for (const line of page) {
      if (/^(PAYG withholding amounts|Assessed net goods and services tax amounts|.*superannuation guarantee charge.*)$/i.test(line.text)) {
        const found = typeOf(line.text)
        if (found) return found
      }
    }
  }
  return null
}

/** The name on the "TO:" line, and nothing from the lines below it. */
function readDirectorName(pages: PdfLine[][]): string | null {
  for (const page of pages) {
    for (const line of page) {
      const first = line.cells[0]
      const match = first && /^TO:\s*(.*)$/.exec(first.text)
      if (!match) continue
      const name = (match[1] || line.cells[1]?.text || '').trim()
      if (name) return name
    }
  }
  return null
}

/** Left edges of "Column 1" … "Column 5", when this line is the table's header. */
function columnStarts(line: PdfLine): number[] | null {
  const starts: number[] = []
  for (const cell of line.cells) {
    const match = /^Column\s*([1-5])$/i.exec(cell.text)
    if (match) starts[Number(match[1]) - 1] = cell.x
  }
  return starts.length === 5 && starts.every((x) => typeof x === 'number') ? starts : null
}

type TableRead = { kind: 'rows'; rows: DpnRow[] } | { kind: 'unreadable' }

/**
 * Every period row in the table, across pages. Each page sets its own column
 * positions from its own header, so the repeated header on page 4 is used
 * rather than skipped blindly, and nothing between headers is mistaken for a
 * row unless it starts with a period.
 */
function readTable(pages: PdfLine[][]): TableRead {
  const rows: DpnRow[] = []
  for (const page of pages) {
    let starts: number[] | null = null
    for (const line of page) {
      const header = columnStarts(line)
      if (header) {
        starts = header
        continue
      }
      if (!starts) continue

      // Column 1 is everything left of Column 2's header: the period, which
      // may come through as one cell or as several.
      const periodCells = line.cells.filter((cell) => cell.right < starts![1])
      const figureCells = line.cells.filter((cell) => cell.right >= starts![1])
      const period = PERIOD.exec(periodCells.map((cell) => cell.text).join(' '))
      if (!period) continue

      const row = readRow(period[1], period[2], figureCells, starts)
      if (!row) return { kind: 'unreadable' }
      rows.push(row)
    }
  }
  return rows.length > 0 ? { kind: 'rows', rows } : { kind: 'unreadable' }
}

const AMOUNT_KEYS: (keyof DpnAmounts)[] = ['column2', 'column3', 'column4', 'column5']

function readRow(
  fromText: string,
  toText: string,
  cells: PdfCell[],
  starts: number[],
): DpnRow | null {
  const periodFrom = parseNoticeDate(fromText)
  const periodTo = parseNoticeDate(toText)
  if (!periodFrom || !periodTo) return null

  const amounts: Partial<DpnAmounts> = {}
  for (const cell of cells) {
    const cents = parseMoney(cell.text)
    if (cents === null) return null
    // Columns 2–5 are starts[1..4]; the last runs to the page edge.
    let column = -1
    for (let k = 1; k <= 4; k++) {
      const upper = k < 4 ? starts[k + 1] : Infinity
      if (cell.right >= starts[k] && cell.right < upper) column = k
    }
    if (column < 0) return null
    const key = AMOUNT_KEYS[column - 1]
    if (amounts[key] !== undefined) return null
    amounts[key] = cents
  }
  if (AMOUNT_KEYS.some((key) => amounts[key] === undefined)) return null
  return { periodFrom, periodTo, ...(amounts as DpnAmounts) }
}

export function sumRows(rows: readonly DpnRow[]): DpnAmounts {
  const totals: DpnAmounts = { column2: 0, column3: 0, column4: 0, column5: 0 }
  for (const row of rows) {
    for (const key of AMOUNT_KEYS) totals[key] += row[key]
  }
  return totals
}

const REQUIRED: (keyof DirectorPenaltyNotice)[] = [
  'reference',
  'issuedOn',
  'type',
  'companyName',
  'acn',
  'directorName',
]

export function parseDirectorPenaltyNotice(pages: PdfLine[][]): DpnParseResult {
  if (!pages.some((page) => page.some((line) => DPN_WORDING.test(line.text)))) {
    return { kind: 'not_a_dpn' }
  }

  const reference = valueAfter(pages, /^Our reference:?/i)?.replace(/\s+/g, '') || undefined
  const issuedRaw = valueAfter(pages, /^Date of issue:?/i)
  const issuedOn = (issuedRaw && parseNoticeDate(issuedRaw)) || undefined
  const type = readType(pages) ?? undefined
  const companyName = valueAfter(pages, /^For this company\b/i) ?? undefined
  const acnRaw = valueAfter(pages, /^With this ACN\b/i)
  const acn = acnRaw && /^[\d ]+$/.test(acnRaw) ? acnRaw.replace(/\s+/g, '') : undefined
  const directorName = readDirectorName(pages) ?? undefined

  const table = readTable(pages)
  const rows = table.kind === 'rows' ? table.rows : undefined
  const partial: Partial<DirectorPenaltyNotice> = {
    reference,
    issuedOn,
    type,
    companyName,
    acn,
    directorName,
    ...(rows ? { rows, totals: sumRows(rows) } : {}),
  }
  for (const key of Object.keys(partial) as (keyof DirectorPenaltyNotice)[]) {
    if (partial[key] === undefined) delete partial[key]
  }

  const missing = REQUIRED.filter((key) => partial[key] === undefined)
  if (type === 'sgc') return { kind: 'needs_manual', reason: 'sgc', partial, missing }
  if (missing.length > 0) {
    return { kind: 'needs_manual', reason: 'missing_fields', partial, missing }
  }
  if (!rows) return { kind: 'needs_manual', reason: 'table_unreadable', partial, missing: [] }

  return { kind: 'parsed', notice: partial as DirectorPenaltyNotice }
}
