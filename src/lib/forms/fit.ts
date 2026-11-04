import { pdfSafe } from '@/lib/pdfSafe'
import { HELVETICA_KERNING, HELVETICA_WIDTHS } from './helveticaMetrics'
import type { FieldValue, FormField, TableColumn } from './types'

/**
 * How text fits a box on an official form: the rules the PDF filler draws
 * by (shrink, wrap, then cut), and the room each box gives. Pure and
 * browser-safe, so the entry screen can say, while the answer is typed, how
 * much of it would be cut off on the printout.
 */

/** Width of `text` at `size` points. */
export type Measure = (text: string, size: number) => number

export const DEFAULT_SIZE = 9
export const MIN_SIZE = 6
/** Table text: one line at this size (shrinking to MIN_SIZE), or two lines at CELL_WRAP_SIZE. */
export const CELL_LINE_SIZE = 8
export const CELL_WRAP_SIZE = 7
/** Lines fields wrap from DEFAULT_SIZE down to this before the rest is cut. */
export const LINES_MIN_SIZE = 7

/** Helvetica, measured as pdf-lib measures it (glyph widths plus kerning). */
export const measureHelvetica: Measure = (text, size) => {
  let total = 0
  for (let i = 0; i < text.length; i++) {
    total += HELVETICA_WIDTHS[text[i]] ?? HELVETICA_WIDTHS['?']
    if (i + 1 < text.length) total += HELVETICA_KERNING[text[i] + text[i + 1]] ?? 0
  }
  return (total * size) / 1000
}

/** The largest size from `size` down to `min` (in quarter points) at which the text fits. */
export function fitSize(measure: Measure, text: string, maxW: number, size: number, min: number): number {
  let s = size
  while (s > min && measure(text, s) > maxW) s -= 0.25
  return s
}

/** Words onto lines of at most maxW; a word longer than a line gets a line of its own. */
export function wrap(measure: Measure, text: string, maxW: number, size: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word
    if (measure(next, size) <= maxW || !cur) cur = next
    else {
      lines.push(cur)
      cur = word
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/** What prints of one line at `size`: characters are dropped from the end until it fits. */
export function cutToFit(measure: Measure, str: string, size: number, maxW: number): string {
  let out = str
  while (out.length > 1 && measure(out, size) > maxW + 0.5) out = out.slice(0, -1)
  return out
}

/** One line as the filler draws it: whitespace folded, made WinAnsi-safe, shrunk, then cut. */
export function fitLine(measure: Measure, raw: string, maxW: number, size = DEFAULT_SIZE, min = MIN_SIZE): { str: string; out: string; size: number } {
  const str = pdfSafe(raw.replace(/\s+/g, ' ').trim())
  const s = fitSize(measure, str, maxW, size, min)
  return { str, out: str ? cutToFit(measure, str, s, maxW) : str, size: s }
}

/* ---------------- the room each box gives ---------------- */

/** The room an answer has on the form, for the entry screen to measure against. */
export type Room =
  | { kind: 'line'; maxW: number; size: number }
  | { kind: 'lines'; wrapW: number; lineWs: number[] }
  | { kind: 'cell'; maxW: number }
  /** An amount box: the amount is formatted first ("12,345.60"); text that isn't an amount prints as typed. */
  | { kind: 'money'; maxW: number; size: number; currency: boolean }

/* ---------------- amounts ---------------- */

export function toNumber(v: FieldValue): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
  const n = Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** "12,345.60"; whole dollars without cents; negatives in brackets. */
export function formatAmount(v: FieldValue, currency = false): string {
  const n = toNumber(v)
  if (n === null) return String(v ?? '').trim()
  const cents = Math.round(n * 100) % 100 !== 0
  const s = Math.abs(n).toLocaleString('en-AU', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: 2,
  })
  const withSign = currency ? `$${s}` : s
  return n < 0 ? `(${withSign})` : withSign
}

/** Amount boxes: from the printed "$" when there is one, else from the box's left (Form 509). */
export function moneySpot(f: { x0: number; x1: number; startX?: number }): { x: number; maxW: number; size: number } {
  return f.startX !== undefined ? { x: f.startX, maxW: f.x1 - f.startX - 4, size: DEFAULT_SIZE } : { x: f.x0 + 5, maxW: f.x1 - f.x0 - 9, size: 8.5 }
}

/** Table amount columns: after the printed "$". */
export function moneyCellSpot(col: { x0: number; x1: number; dollar?: number }): { x: number; maxW: number; size: number } {
  const x = (col.dollar ?? col.x0) + 9
  return { x, maxW: col.x1 - x - 4, size: 8.5 }
}

/** A text box: its width less the padding. */
export const textMaxW = (f: { x0: number; x1: number }, pad: number) => f.x1 - f.x0 - pad - 3
/** Each printed line of a lines field, less its margins. */
export const lineMaxW = (L: { x0: number; x1: number }) => L.x1 - L.x0 - 8
/** A table text column, less its margins. */
export const cellMaxW = (col: { x0: number; x1: number }) => col.x1 - col.x0 - 7

/** The room for a typed answer, or null when there is nothing to measure (dates, ticks). */
export function roomOf(f: FormField): Room | null {
  if (f.type === 'money') {
    const { maxW, size } = moneySpot(f)
    return { kind: 'money', maxW, size, currency: !!f.currency }
  }
  if (f.type === 'text' && f.format !== 'date')
    return {
      kind: 'line',
      maxW: textMaxW(f, f.pad ?? 4),
      size: f.size ?? DEFAULT_SIZE,
    }
  if (f.type === 'lines' && f.lines.length)
    return {
      kind: 'lines',
      wrapW: lineMaxW(f.lines[0]),
      lineWs: f.lines.map(lineMaxW),
    }
  return null
}

export function cellRoomOf(col: TableColumn): Room | null {
  if (col.type === 'money') {
    const { maxW, size } = moneyCellSpot(col)
    return { kind: 'money', maxW, size, currency: false }
  }
  return col.type === 'text' ? { kind: 'cell', maxW: cellMaxW(col) } : null
}

/* ---------------- how much won't print ---------------- */

/** Lines field: the text on the printed lines (wrapped from 9pt down to 7pt), and the size used. */
export function layoutLines(measure: Measure, text: string, wrapW: number, count: number): { lines: string[]; size: number } {
  let size = DEFAULT_SIZE
  let lines = wrap(measure, text, wrapW, size)
  while (lines.length > count && size > LINES_MIN_SIZE) {
    size -= 0.5
    lines = wrap(measure, text, wrapW, size)
  }
  return { lines, size }
}

/** Table text cell: one line, or two smaller lines. */
export function layoutCell(measure: Measure, str: string, maxW: number): { single: boolean; lines: string[] } {
  const all = wrap(measure, str, maxW, CELL_WRAP_SIZE)
  return measure(str, CELL_LINE_SIZE) <= maxW || all.length < 2 ? { single: true, lines: [str] } : { single: false, lines: all }
}

/**
 * How many characters of the answer won't print in its box: 0 when it all
 * fits. Spaces folded together don't count.
 */
export function overflowOf(room: Room, value: string, measure: Measure = measureHelvetica): number {
  if (!value.trim()) return 0
  if (room.kind === 'line' || room.kind === 'money') {
    const text = room.kind === 'money' ? formatAmount(value, room.currency) : value
    const { str, out } = fitLine(measure, text, room.maxW, room.size)
    return str.length - out.length
  }
  if (room.kind === 'lines') {
    const text = pdfSafe(value)
    const { lines, size } = layoutLines(measure, text, room.wrapW, room.lineWs.length)
    let lost = lines.slice(room.lineWs.length).join(' ').length
    if (lines.length > room.lineWs.length) lost += 1 // the space before the cut-off words
    lines.slice(0, room.lineWs.length).forEach((ln, i) => {
      const r = fitLine(measure, ln, room.lineWs[i], size, size)
      lost += r.str.length - r.out.length
    })
    return lost
  }
  const str = pdfSafe(value.replace(/\s+/g, ' ').trim())
  const cell = layoutCell(measure, str, room.maxW)
  if (cell.single) {
    const r = fitLine(measure, str, room.maxW, CELL_LINE_SIZE)
    return r.str.length - r.out.length
  }
  let lost = cell.lines.length > 2 ? cell.lines.slice(2).join(' ').length + 1 : 0
  cell.lines.slice(0, 2).forEach((ln) => {
    const r = fitLine(measure, ln, room.maxW, CELL_WRAP_SIZE, 5.5)
    lost += r.str.length - r.out.length
  })
  return lost
}
