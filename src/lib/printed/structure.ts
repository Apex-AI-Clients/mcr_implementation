import type { PrintedAmount, PrintedRowStyle, PrintedStatementKind } from './types'

/**
 * Section structure of a statement's lines, from how they are printed. Pure.
 *
 *   A line with no figures is a heading and opens a section. It nests under
 *   the open section when it is indented further, or printed at the same
 *   indent while that section has no lines of its own yet ("Assets" then
 *   "Current assets" in a flat layout).
 *   "Total …" (or a figures-only line) closes a section: the open one whose
 *   name it repeats ("Total Bank Accounts"), else the innermost.
 *   "Gross profit", "Net profit…", "Net assets"… are results: they close
 *   nothing. So is a "Total …" with no section open ("Total Income" after
 *   Income and Other Income have closed).
 */

export interface UnstructuredRow {
  /** Left edge of the line's first cell: its indent. */
  x: number
  label: string
  amounts: PrintedAmount[]
  /** Any amount cell printed, even a nil "-". False for a heading. */
  hasAmounts: boolean
}

export interface StructuredRow extends UnstructuredRow {
  path: string[]
  style: PrintedRowStyle
}

const RESULT: Record<PrintedStatementKind, RegExp> = {
  profit_and_loss: /^(gross (profit|loss)|net\b|profit\b|profit\s*\/|operating (profit|loss)|undistributed income|retained (profits?|earnings) at)/i,
  balance_sheet: /^net (assets|liabilities)\b/i,
}

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')

export function structureRows<T extends UnstructuredRow>(kind: PrintedStatementKind, rows: T[]): (T & StructuredRow)[] {
  const stack: { label: string; x: number; lines: number }[] = []
  const labels = () => stack.map((s) => s.label)
  const out: (T & StructuredRow)[] = []

  for (const row of rows) {
    if (!row.hasAmounts) {
      while (stack.length && (stack[stack.length - 1].x > row.x + 1 || (Math.abs(stack[stack.length - 1].x - row.x) <= 1 && stack[stack.length - 1].lines > 0))) {
        stack.pop()
      }
      out.push({ ...row, path: labels(), style: 'heading' })
      stack.push({ label: row.label, x: row.x, lines: 0 })
      continue
    }
    if (row.amounts.some((a) => typeof a === 'string')) {
      out.push({ ...row, path: labels(), style: 'ratio' })
      continue
    }
    const result = RESULT[kind].test(row.label)
    const totalish = row.label === '' || /^total\b/i.test(row.label)
    if (totalish && !result && stack.length) {
      const key = nameKey(row.label.replace(/^total\s*/i, ''))
      let at = stack.length - 1
      if (key) {
        for (let i = stack.length - 1; i >= 0; i--) {
          const name = nameKey(stack[i].label)
          if (name && (name.startsWith(key) || key.startsWith(name))) {
            at = i
            break
          }
        }
      }
      const path = labels().slice(0, at + 1)
      stack.length = at
      out.push({ ...row, path, style: 'subtotal' })
      continue
    }
    out.push({ ...row, path: labels(), style: result || totalish ? 'total' : 'line' })
    if (stack.length) stack[stack.length - 1].lines++
  }
  return out
}
