/**
 * CSV building and download, shared. The older exports (lodgement,
 * financials, outcome prediction) still carry their own copies; new exports
 * use these.
 */

export type CsvValue = string | number | null | undefined

/** Quoted when it holds a comma, a quote or a line break; quotes doubled. */
export function csvCell(value: CsvValue): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvRow(...cells: CsvValue[]): string {
  return cells.map(csvCell).join(',')
}

/** Browser only. A UTF-8 BOM first, so Excel reads the encoding correctly. */
export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' })
  downloadBlob(blob, filename)
}

/** Browser only. Save a file the page has built. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
