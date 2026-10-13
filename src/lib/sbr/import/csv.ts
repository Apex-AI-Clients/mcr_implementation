/**
 * CSV writing for the import: the template (headers.ts) and the "Download
 * rejected rows" file, which Gabby fixes and uploads again.
 */
import type { RejectedRow } from './types'

/**
 * One CSV cell: quoted when it needs to be, and with a leading apostrophe
 * when a spreadsheet would read it as a formula (CSV injection). A lone "-"
 * and negative numbers are left alone; cellText() drops the apostrophe again
 * on re-upload.
 */
export function csvCell(value: string): string {
  let v = value
  if (/^[=+@\t\r]/.test(v) || /^-(?![\d.\s]|$)/.test(v)) v = `'${v}`
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/**
 * The rejected rows with their original columns (in the order the file had
 * them, tabs merged) followed by Reason and Source. The two extra columns
 * match no import field, so the fixed file uploads without removing them.
 */
export function rejectedRowsCsv(rows: readonly RejectedRow[]): string {
  const headers: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const h of Object.keys(row.raw)) {
      if (!seen.has(h)) {
        seen.add(h)
        headers.push(h)
      }
    }
  }
  const line = (values: string[]) => values.map(csvCell).join(',')
  const lines = [line([...headers, 'Reason', 'Source'])]
  for (const row of rows) {
    lines.push(
      line([
        ...headers.map((h) => row.raw[h] ?? ''),
        row.reasons.map((r) => r.message).join(' '),
        row.ref.tab ? `${row.ref.tab}, row ${row.ref.rowNumber}` : `row ${row.ref.rowNumber}`,
      ]),
    )
  }
  return lines.join('\r\n') + '\r\n'
}
