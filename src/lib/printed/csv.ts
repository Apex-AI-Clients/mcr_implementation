import type { ComparisonColumn, PrintedComparison } from './compare'
import type { PrintedAmount } from './types'

/**
 * The as-printed comparison as CSV. Pure. Every figure exactly as printed
 * (cents kept, nil as "-", ratios as printed), a blank for a line a year does
 * not print, and the restatement notes. Totals that do not add up are listed
 * under NEEDS REVIEW with who checked them, when.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** "FY2024" or "Current period"; the period under it: "1 Jul 2023 – 30 Jun 2024". */
export function columnTitle(c: ComparisonColumn): { title: string; period: string } {
  return {
    title: c.kind === 'annual' ? c.key : 'Current period',
    period: c.periodStart ? `${shortDate(c.periodStart)} – ${shortDate(c.periodEnd)}` : `at ${shortDate(c.periodEnd)}`,
  }
}

/** For screen and CSV: "1,234.56", "(1,234)", "-" for nil, a ratio as printed. */
export function formatPrinted(value: PrintedAmount): string {
  if (value === null) return '-'
  if (typeof value === 'string') return value
  const abs = Math.abs(value).toLocaleString('en-AU', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })
  return value < 0 ? `(${abs})` : abs
}

const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const row = (...cells: string[]) => cells.map(cell).join(',')

export function comparisonCsv(input: {
  clientName: string
  comparison: PrintedComparison
  /** "Reviewed by X on <date>" once the failures were ticked. */
  reviewedBy: string | null
}): string {
  const { comparison: c } = input
  const lines: string[] = [row('Financial statements as printed', input.clientName), row('Generated', new Date().toISOString())]
  if (c.failures.length) {
    lines.push('', row('NEEDS REVIEW'))
    for (const f of c.failures) lines.push(row(f.column === 'current' ? 'Current period' : f.column, f.message))
    if (input.reviewedBy) lines.push(row(`${input.reviewedBy}: checked against the source documents`))
  }
  const heads = c.columns.map(columnTitle)
  for (const table of c.tables) {
    lines.push('', row(table.title.toUpperCase()), row('Line', ...heads.map((h) => `${h.title} (${h.period})`), 'Notes'))
    for (const r of table.rows) {
      const label = `${'  '.repeat(r.path.length)}${r.label || '(no label)'}`
      const notes = r.cells.flatMap((cl, i) => cl.restated.map((rs) => `${heads[i].title}: restated in ${rs.report.replace(/^the /, '')}: ${formatPrinted(rs.value)}`))
      lines.push(row(label, ...r.cells.map((cl) => (r.style === 'heading' || !cl.printed ? '' : formatPrinted(cl.value))), notes.join('; ')))
    }
  }
  return lines.join('\r\n')
}
