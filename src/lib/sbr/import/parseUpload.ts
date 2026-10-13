/**
 * Reads an uploaded CSV or Excel file into rows. Server-side only: the file
 * never goes to the browser's bundle or to any AI.
 *
 * Excel (.xlsx, .xls) is read with SheetJS Community Edition, pinned to the
 * official 0.20.3 tarball (package.json) — not the npm "xlsx" 0.18.x, which
 * has known vulnerabilities. It is read with formulas, HTML and styles off and
 * a row cap per tab; the size limit is checked before anything is parsed.
 * Every tab whose header row matches is read; the others are listed as
 * skipped.
 *
 * CSV is read with csv-parse in array mode (no `columns` option).
 */
import { parse as parseCsv } from 'csv-parse/sync'
import * as XLSX from 'xlsx'
import {
  ACCEPTED_EXTENSIONS,
  HEADER_SEARCH_ROWS,
  MAX_ROWS_PER_TAB,
  MAX_UPLOAD_BYTES,
} from './config'
import { describeFields, matchHeader } from './headers'
import { cellText } from './normalise'
import type { ImportField, RawRow, SourceRow, TabSummary } from './types'

export interface ParsedUpload {
  tabs: TabSummary[]
  rows: SourceRow[]
}

/** A file the import cannot read at all; `message` is shown to staff. */
export class UploadError extends Error {}

/**
 * One tab (or the CSV) as rows of cells. Blank rows are kept so a row's
 * position is its row number; firstRow is the 0-based spreadsheet row the
 * grid starts at (a sheet's used range need not start at row 1).
 */
interface Grid {
  tab: string | null
  grid: unknown[][]
  firstRow: number
}

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase()
}

export function parseUpload(bytes: Uint8Array, fileName: string): ParsedUpload {
  const ext = fileExtension(fileName)
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new UploadError('Upload a .csv, .xlsx or .xls file.')
  }
  if (bytes.byteLength === 0) throw new UploadError('The file is empty.')
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadError(`The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`)
  }

  if (ext !== '.csv' && !hasWorkbookSignature(bytes, ext)) {
    throw new UploadError(
      "This doesn't look like an Excel file. Save it as .xlsx or .csv and upload it again.",
    )
  }

  const grids: Grid[] =
    ext === '.csv' ? [{ tab: null, grid: readCsv(bytes), firstRow: 0 }] : readWorkbook(bytes)

  const tabs: TabSummary[] = []
  const rows: SourceRow[] = []
  for (const grid of grids) {
    const result = readGrid(grid)
    tabs.push(result.summary)
    rows.push(...result.rows)
  }

  if (rows.length === 0 && !tabs.some((t) => t.status === 'read')) {
    const detail = tabs.find((t) => t.detail)?.detail
    throw new UploadError(
      detail ? `No usable header row found. ${detail}` : 'No usable header row found.',
    )
  }
  return { tabs, rows }
}

/**
 * .xlsx is a ZIP (PK); .xls is an OLE compound file. Checked before
 * SheetJS sees the bytes, so it never falls back to guessing among its other
 * formats (HTML, SYLK, ...) on whatever was uploaded.
 */
const ZIP = [0x50, 0x4b, 0x03, 0x04]
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

function hasWorkbookSignature(bytes: Uint8Array, ext: string): boolean {
  const magic = ext === '.xlsx' ? ZIP : OLE
  return magic.every((b, i) => bytes[i] === b)
}

function readCsv(bytes: Uint8Array): unknown[][] {
  const text = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '')
  try {
    const grid: string[][] = parseCsv(text.replace(/\r\n?/g, '\n'), {
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: false,
      to: MAX_ROWS_PER_TAB,
    })
    return grid
  } catch {
    throw new UploadError('The CSV file could not be read.')
  }
}

function readWorkbook(bytes: Uint8Array): Grid[] {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(bytes, {
      type: 'array',
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      cellDates: false,
      sheetRows: MAX_ROWS_PER_TAB,
      dense: true,
    })
  } catch {
    throw new UploadError('The Excel file could not be read.')
  }
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    const ref = sheet['!ref']
    return {
      tab: name.trim(),
      // raw: numbers stay numbers at full precision, not as the cell displays them.
      grid: ref
        ? XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            raw: true,
            defval: '',
            blankrows: true,
          })
        : [],
      firstRow: ref ? XLSX.utils.decode_range(ref).s.r : 0,
    }
  })
}

function readGrid({ tab, grid, firstRow }: Grid): { summary: TabSummary; rows: SourceRow[] } {
  // The header is the first of the top rows that names every required field;
  // failing that, the one that names the most (for the "missing" message).
  let headerIndex = -1
  let best: { found: number; missing: ImportField[] } | null = null
  for (let i = 0; i < Math.min(HEADER_SEARCH_ROWS, grid.length); i++) {
    const cells = (grid[i] ?? []).map(cellText)
    const match = matchHeader(cells)
    if (match.missing.length === 0) {
      headerIndex = i
      break
    }
    const found = Object.keys(match.columns).length
    if (!best || found > best.found) best = { found, missing: match.missing }
  }

  if (headerIndex < 0) {
    const detail =
      best && best.found >= 3
        ? `${tab ? `Tab "${tab}"` : 'The file'} is missing: ${describeFields(best.missing)}.`
        : null
    return { summary: { tab, status: 'skipped', rows: 0, detail }, rows: [] }
  }

  const headerCells = (grid[headerIndex] ?? []).map(cellText)
  const { columns } = matchHeader(headerCells)
  const rows: SourceRow[] = []
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const line = grid[i] ?? []
    if (line.every((v) => cellText(v) === '')) continue

    const cells: SourceRow['cells'] = {}
    for (const field of Object.keys(columns) as ImportField[]) cells[field] = line[columns[field]!]

    const raw: RawRow = {}
    headerCells.forEach((header, j) => {
      if (header) raw[header] = cellText(line[j])
    })

    rows.push({ ref: { tab, rowNumber: firstRow + i + 1 }, cells, raw })
  }
  return { summary: { tab, status: 'read', rows: rows.length, detail: null }, rows }
}
