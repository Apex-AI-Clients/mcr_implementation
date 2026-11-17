import { parse } from 'csv-parse/sync'
import * as XLSX from 'xlsx'
import { parseAtoDate } from '@/lib/analysis/parseActivityStatement'
import { readAtoAccountHeader, type DetectedAtoAccountKind } from '@/lib/analysis/atoAccountKind'
import type { Cents, IcaFile, IcaRow, SpreadsheetFigures } from './types'

/**
 * Reads an ATO account export into rows exactly as printed:
 *   - the ATO's CSV (any date format the date reader accepts: the ATO's own,
 *     or re-saved by a spreadsheet);
 *   - an RBA ICA spreadsheet (.xlsx): the same six columns A–F, the ATO's
 *     account label on row 1, the entity on row 3, the header on row 7, rows
 *     from row 9. Its own late-lodgement figures (H3, H4) are read too.
 *
 * Nothing is interpreted here beyond reading the cells: no row is dropped,
 * merged or re-ordered.
 */

const HEADER = ['Processed date', 'Effective date', 'Description', 'Debit (DR)', 'Credit (CR)', 'Balance']

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export class IcaReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IcaReadError'
  }
}

/** A local-midnight date as yyyy-mm-dd. */
function isoDay(d: Date | null): string | null {
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null
}

/** "$1,234.56", "1234.56", "$1,234.56 DR"/"CR" → cents; null when blank or not a number. */
export function readMoney(raw: string, signed = false): Cents | null {
  let s = raw.replace(/"/g, '').trim()
  if (!s) return null
  let sign = 1
  if (signed) {
    const m = s.match(/\s*(DR|CR)$/i)
    if (m) {
      if (m[1].toUpperCase() === 'CR') sign = -1
      s = s.slice(0, m.index)
    }
  }
  s = s.replace(/[$,\s]/g, '')
  if (/^\(.*\)$/.test(s)) {
    sign = -sign
    s = s.slice(1, -1)
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  return sign * Math.round(Number(s) * 100)
}

function rowOf(id: number, cells: string[]): IcaRow {
  const [rawProcessed = '', rawEffective = '', rawDescription = '', rawDebit = '', rawCredit = '', rawBalance = ''] = cells
  return {
    id,
    rawProcessed: rawProcessed.trim(),
    rawEffective: rawEffective.trim(),
    description: rawDescription.replace(/^'/, '').trim(),
    rawDebit: rawDebit.trim(),
    rawCredit: rawCredit.trim(),
    rawBalance: rawBalance.trim(),
    processed: isoDay(parseAtoDate(rawProcessed)),
    effective: isoDay(parseAtoDate(rawEffective)),
    // A debit or credit is printed positive; a blank cell is nothing.
    debit: Math.abs(readMoney(rawDebit) ?? 0),
    credit: Math.abs(readMoney(rawCredit) ?? 0),
    balance: readMoney(rawBalance, true),
  }
}

function printOrderOf(rows: IcaRow[]): IcaFile['printOrder'] {
  const dated = rows.filter((r) => r.processed)
  if (dated.length < 2) return 'newest_first'
  return dated[0].processed! < dated[dated.length - 1].processed! ? 'oldest_first' : 'newest_first'
}

function kindOf(label: string): DetectedAtoAccountKind {
  return readAtoAccountHeader(`"${label.replace(/"/g, '""')}"\n"x"\n`).kind
}

const isHeader = (cells: unknown[]) => HEADER.every((h, i) => String(cells[i] ?? '').trim() === h)

export function readIcaCsv(text: string): IcaFile {
  // CRLF first: with relax_quotes a CR would stay on the last cell (the balance).
  const all: string[][] = parse(text.replace(/^﻿/, '').replace(/\r\n?/g, '\n'), {
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
  })
  if (all.length < 3) throw new IcaReadError('Not an ATO account export: fewer than three lines.')
  const label = (all[0][0] ?? '').trim()
  const entityName = (all[1][0] ?? '').trim()
  if (!label || !isHeader(all[2])) throw new IcaReadError('Not an ATO account export: line 3 is not the ATO column header.')
  const rows = all.slice(3).map((cells, i) => rowOf(i, cells))
  return { source: 'csv', label, entityName, kind: kindOf(label), rows, printOrder: printOrderOf(rows), spreadsheet: null }
}

/** A spreadsheet date cell as the ATO prints dates ("02 Nov 2026"); text as it is. */
function dateCell(cell: XLSX.CellObject | undefined): string {
  if (!cell) return ''
  if (typeof cell.v === 'number') {
    const d = parseAtoDate(String(Math.round(cell.v)))
    return d ? `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : String(cell.v)
  }
  if (cell.v instanceof Date) {
    const d = cell.v
    return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
  }
  return String(cell.v ?? '')
}

/** A money cell as the ATO prints it ("$1,234.56"); text as it is. */
function moneyCell(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null || cell.v === '') return ''
  if (typeof cell.v === 'number') {
    const c = Math.round(Math.abs(cell.v) * 100)
    return `${cell.v < 0 ? '-' : ''}$${Math.floor(c / 100).toLocaleString('en-AU')}.${String(c % 100).padStart(2, '0')}`
  }
  return String(cell.v)
}

const textCell = (cell: XLSX.CellObject | undefined) => (cell ? String(cell.w ?? cell.v ?? '') : '')

export function readIcaXlsx(data: ArrayBuffer | Uint8Array): IcaFile {
  const wb = XLSX.read(data, { type: 'array', cellDates: false })
  const name = wb.SheetNames.find((n) => /rba\s*ica/i.test(n)) ?? wb.SheetNames[0]
  const ws = name ? wb.Sheets[name] : undefined
  if (!ws) throw new IcaReadError('The spreadsheet has no sheets.')
  const at = (ref: string) => ws[ref] as XLSX.CellObject | undefined
  const label = textCell(at('A1')).trim()
  const entityName = textCell(at('A3')).trim()
  const headerCells = ['A7', 'B7', 'C7', 'D7', 'E7', 'F7'].map((r) => textCell(at(r)))
  if (!label || !isHeader(headerCells)) {
    throw new IcaReadError('Not an RBA ICA spreadsheet: row 7 is not the ATO column header (columns A–F).')
  }

  let spreadsheet: SpreadsheetFigures | null = null
  if (/late lodgements/i.test(textCell(at('G3'))) && /days late/i.test(textCell(at('G4')))) {
    const h3 = Number(at('H3')?.v)
    const h4 = Number(at('H4')?.v)
    if (Number.isFinite(h3) && Number.isFinite(h4)) spreadsheet = { lateLodgements: h3, cumulativeDaysLate: h4 }
  }

  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:F9')
  const rows: IcaRow[] = []
  for (let r = 8; r <= range.e.r; r++) {
    const cell = (c: number) => ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined
    const cells = [dateCell(cell(0)), dateCell(cell(1)), textCell(cell(2)), moneyCell(cell(3)), moneyCell(cell(4)), textCell(cell(5))]
    if (cells.every((c) => c.trim() === '')) continue
    rows.push(rowOf(rows.length, cells))
  }
  return { source: 'xlsx', label, entityName, kind: kindOf(label), rows, printOrder: printOrderOf(rows), spreadsheet }
}

/** Either kind of file, told apart by content (an .xlsx is a zip: it starts "PK"). */
export function readIcaFile(data: Uint8Array): IcaFile {
  if (data.length >= 2 && data[0] === 0x50 && data[1] === 0x4b) return readIcaXlsx(data)
  return readIcaCsv(new TextDecoder('utf-8').decode(data))
}

/**
 * Rows stored by the earlier analyses (lodgement_analyses.rows,
 * ato_account_analyses.rows): the raw date cells and description as printed,
 * the amounts as read then. Null when the rows are not in that shape.
 */
export function readStoredRows(stored: unknown, header: { label?: string | null; entityName?: string | null } = {}): IcaFile | null {
  if (!Array.isArray(stored) || stored.length === 0) return null
  const money = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : null)
  const printed = (c: Cents | null, signed = false) => {
    if (c === null) return ''
    const abs = Math.abs(c)
    const s = `$${Math.floor(abs / 100).toLocaleString('en-AU')}.${String(abs % 100).padStart(2, '0')}`
    return signed ? (c === 0 ? s : `${s} ${c > 0 ? 'DR' : 'CR'}`) : s
  }
  const rows: IcaRow[] = []
  for (const [i, raw] of stored.entries()) {
    const r = raw as Record<string, unknown>
    // lodgement_analyses keep the raw date cells; ato_account_analyses keep yyyy-mm-dd dates.
    const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
    const rawProcessed = typeof r.rawProcessed === 'string' ? r.rawProcessed : day(r.processedDate) ?? ''
    const rawEffective = typeof r.rawEffective === 'string' ? r.rawEffective : day(r.effectiveDate) ?? ''
    if (typeof r.description !== 'string' || (typeof r.rawProcessed !== 'string' && typeof r.processedDate !== 'string' && r.processedDate !== null)) return null
    const debit = money(r.debit)
    const credit = money(r.credit)
    const balance = money(r.balance)
    const row = rowOf(typeof r.rowIndex === 'number' ? r.rowIndex : i, [rawProcessed, rawEffective, r.description, printed(debit), printed(credit), printed(balance, true)])
    rows.push({ ...row, id: rows.length })
  }
  const label = header.label?.trim() || ''
  return { source: 'csv', label, entityName: header.entityName?.trim() || '', kind: label ? kindOf(label) : 'activity_statement', rows, printOrder: printOrderOf(rows), spreadsheet: null }
}
