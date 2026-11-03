import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import { pdfSafe } from '@/lib/dpn/exportPdf'
import type {
  Box,
  FieldValue,
  FillOptions,
  FillResult,
  FormData,
  FormField,
  FormMap,
  FormTable,
  FormWarning,
  TableRow,
} from './types'

/**
 * Writes answers ON TOP of an official ASIC PDF.
 *
 * The template's pages are copied unchanged — logo, layout and wording are
 * never redrawn — and the answers, ticks and appendix rows are drawn over
 * them at the positions in the form's map. With no answers, every page is
 * identical to the original (tested pixel by pixel).
 *
 * The output has no form fields: answers are page content, so the PDF is
 * flat and prints as typed. Signatures are left for the hand, and so is any
 * field the map marks `handwritten`, whatever the data says.
 *
 * Text that doesn't fit is shrunk; if it still doesn't fit it is cut and a
 * warning names the question, so staff can attach an annexure.
 */

const DEFAULT_SIZE = 9
const MIN_SIZE = 6
/** Centre of the checkbox square inside a ❑/❏ glyph box. */
const CHECK_DX = 5.5
const CHECK_DY = 7.2
/** Width of the "/" printed in most date boxes (Part B, 14pt). */
const SLASH_WIDTH = 5.46
/** Half of Helvetica's cap height (718/1000 em). */
const CAP_MIDDLE = 0.359

/* ---------------- value helpers ---------------- */

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

/** "2026-10-27" | "27/10/2026" → { d: "27", m: "10", y: "2026" }. */
export function dateParts(v: FieldValue): { d: string; m: string; y: string } | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
  const s = String(v).trim()
  let d: string, m: string, y: string
  let r: RegExpMatchArray | null
  if ((r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [, y, m, d] = r
  else if ((r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) [, d, m, y] = r
  else return null
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null
  const pad = (x: string) => x.padStart(2, '0')
  return { d: pad(d), m: pad(m), y: y.length === 2 ? `20${y}` : y }
}

export function isYes(v: FieldValue): boolean {
  return v === true || /^(y|yes|true|1)$/i.test(String(v ?? ''))
}

export function isNo(v: FieldValue): boolean {
  return v === false || /^(n|no|false|0)$/i.test(String(v ?? ''))
}

function isBlank(v: FieldValue): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

function rowUsed(row: TableRow): boolean {
  return Object.values(row).some((v) => !isBlank(v) && v !== false)
}

/* ---------------- drawing ---------------- */

interface Pen {
  page: PDFPage
  font: PDFFont
  ink: RGB
  warnings: FormWarning[]
}

/** pdf-lib measures y from the bottom; maps measure from the top. */
function y(pen: Pen, top: number): number {
  return pen.page.getHeight() - top
}

function fitSize(font: PDFFont, text: string, maxW: number, size: number, min: number): number {
  let s = size
  while (s > min && font.widthOfTextAtSize(text, s) > maxW) s -= 0.25
  return s
}

function wrap(font: PDFFont, text: string, maxW: number, size: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word
    if (font.widthOfTextAtSize(next, size) <= maxW || !cur) cur = next
    else {
      lines.push(cur)
      cur = word
    }
  }
  if (cur) lines.push(cur)
  return lines
}

interface TextOpts {
  size?: number
  min?: number
  align?: 'left' | 'center' | 'right'
  /** Warn under this key (and question) when the text had to be cut. */
  warn?: { key: string; q?: string }
}

/** One line of text in [x, x + maxW], baseline at `baseline` (from the top). Returns false if cut. */
function drawText(pen: Pen, raw: string, x: number, baseline: number, maxW: number, opts: TextOpts = {}): boolean {
  const str = pdfSafe(raw.replace(/\s+/g, ' ').trim())
  if (!str) return true
  const size = fitSize(pen.font, str, maxW, opts.size ?? DEFAULT_SIZE, opts.min ?? MIN_SIZE)
  let out = str
  while (out.length > 1 && pen.font.widthOfTextAtSize(out, size) > maxW + 0.5) out = out.slice(0, -1)
  const cut = out !== str
  if (cut && opts.warn) {
    pen.warnings.push({
      ...opts.warn,
      message: 'Answer is too long for the box and was cut off: attach an annexure.',
    })
  }
  const w = pen.font.widthOfTextAtSize(out, size)
  const dx = opts.align === 'right' ? maxW - w : opts.align === 'center' ? (maxW - w) / 2 : 0
  // Shrunk text keeps the middle of its capitals where full-size text has
  // them, so it lines up with the rest of its row instead of sinking.
  const lift = ((opts.size ?? DEFAULT_SIZE) - size) * CAP_MIDDLE
  pen.page.drawText(out, { x: x + dx, y: y(pen, baseline - lift), size, font: pen.font, color: pen.ink })
  return !cut
}

/** A vector tick in the same ink as the text, centred on (cx, cyTop). */
function drawTick(pen: Pen, cx: number, cyTop: number, size = 9) {
  const s = size / 9
  pen.page.drawSvgPath(`M ${-3.6 * s} ${-0.2 * s} L ${-1.1 * s} ${2.6 * s} L ${3.9 * s} ${-3.4 * s}`, {
    x: cx,
    y: y(pen, cyTop),
    borderColor: pen.ink,
    borderWidth: 1.5 * s,
    borderLineCap: 1,
  })
}

function tickGlyph(pen: Pen, glyph: { x0: number; top: number }, size = 9) {
  drawTick(pen, glyph.x0 + CHECK_DX, glyph.top + CHECK_DY, size)
}

interface DateSpot {
  s1: number
  s2: number
  baseline: number
  slashWidth?: number
  /** Right edge available for the year. */
  x1?: number
  size?: number
}

/** DD, MM and YYYY either side of the two printed "/". Falls back to YY when the year has no room. */
function drawDate(pen: Pen, spot: DateSpot, value: FieldValue, warn?: { key: string; q?: string }) {
  if (isBlank(value)) return
  const p = dateParts(value)
  if (!p) {
    if (warn) pen.warnings.push({ ...warn, message: `"${value}" is not a date: use DD/MM/YYYY.` })
    return
  }
  const sw = spot.slashWidth ?? SLASH_WIDTH
  const size = spot.size ?? DEFAULT_SIZE
  drawText(pen, p.d, spot.s1 - 21, spot.baseline, 19, { size, align: 'center' })
  const m0 = spot.s1 + 0.62 * sw
  drawText(pen, p.m, m0, spot.baseline, spot.s2 - 0.2 - m0, { size, align: 'center' })
  const y0 = spot.s2 + sw + 1.2
  const room = Math.min(26, (spot.x1 ?? Infinity) - y0 - 1)
  const year = pen.font.widthOfTextAtSize(p.y, MIN_SIZE) <= room ? p.y : p.y.slice(2)
  drawText(pen, year, y0, spot.baseline, room, { size, min: MIN_SIZE })
}

function textWidthBox(f: Box, pad: number) {
  return f.x1 - f.x0 - pad - 3
}

function drawField(pen: Pen, f: FormField, value: FieldValue) {
  const warn = { key: f.key, q: f.q }
  switch (f.type) {
    case 'yesno': {
      const box = isYes(value) ? f.yes : isNo(value) ? f.no : null
      if (box) tickGlyph(pen, box)
      return
    }
    case 'choice': {
      const box = typeof value === 'string' ? f.options[value] : undefined
      if (box) tickGlyph(pen, box)
      else if (!isBlank(value)) pen.warnings.push({ ...warn, message: `"${value}" is not one of the boxes for ${f.q}.` })
      return
    }
    case 'text': {
      if (isBlank(value)) return
      const pad = f.pad ?? 4
      let text = String(value)
      if (f.format === 'date') {
        const p = dateParts(value)
        if (p) text = `${p.d}/${p.m}/${p.y}`
      }
      drawText(pen, text, f.x0 + pad, f.bot - 4.5, textWidthBox(f, pad), { size: f.size, align: f.align, warn })
      return
    }
    case 'money': {
      if (isBlank(value)) return
      const text = formatAmount(value, f.currency)
      if (f.startX !== undefined) drawText(pen, text, f.startX, f.bot - 4.5, f.x1 - f.startX - 4, { warn })
      else drawText(pen, text, f.x0 + 4, f.bot - 4.5, f.x1 - f.x0 - 8, { align: 'right', size: 8.5, warn })
      return
    }
    case 'date':
      drawDate(pen, { s1: f.slashes[0], s2: f.slashes[1], baseline: f.bot - 4.5, slashWidth: f.slashWidth, x1: f.x1 }, value, warn)
      return
    case 'datecells': {
      if (isBlank(value)) return
      const p = dateParts(value)
      if (!p) {
        pen.warnings.push({ ...warn, message: `"${value}" is not a date: use DD/MM/YYYY.` })
        return
      }
      const chars = `${p.d}${p.m}${p.y.slice(2)}`.split('')
      f.cells.forEach((c, i) =>
        drawText(pen, chars[i] ?? '', c.x0, c.bot - 3.7, c.x1 - c.x0, { align: 'center', min: DEFAULT_SIZE }),
      )
      return
    }
    case 'lines': {
      if (isBlank(value)) return
      const first = f.lines[0]
      const maxW = first.x1 - first.x0 - 8
      const text = pdfSafe(String(value))
      let size = DEFAULT_SIZE
      let lines = wrap(pen.font, text, maxW, size)
      while (lines.length > f.lines.length && size > 7) {
        size -= 0.5
        lines = wrap(pen.font, text, maxW, size)
      }
      if (lines.length > f.lines.length) {
        pen.warnings.push({
          ...warn,
          message: 'Answer is longer than the lines on the form; the rest was cut off: attach an annexure.',
        })
      }
      lines.slice(0, f.lines.length).forEach((ln, i) => {
        const L = f.lines[i]
        drawText(pen, ln, L.x0 + 4, L.bot - 4.5, L.x1 - L.x0 - 8, { size, min: size })
      })
      return
    }
  }
}

function outline(pen: Pen, b: Box) {
  pen.page.drawRectangle({
    x: b.x0,
    y: y(pen, b.bot),
    width: b.x1 - b.x0,
    height: b.bot - b.top,
    borderColor: rgb(1, 0, 0),
    borderWidth: 0.4,
  })
}

function fieldBoxes(f: FormField): Box[] {
  switch (f.type) {
    case 'lines':
      return f.lines
    case 'datecells':
      return f.cells
    case 'yesno':
      return [f.yes, f.no]
    case 'choice':
      return Object.values(f.options)
    default:
      return [f]
  }
}

/* ---------------- appendix tables ---------------- */

/** The rows of a table that hold anything. */
export function usedRows(data: FormData, tableId: string): TableRow[] {
  return (data.tables?.[tableId] ?? []).filter(rowUsed)
}

function drawCell(pen: Pen, t: FormTable, col: FormTable['columns'][number], top: number, bot: number, v: FieldValue) {
  if (col.type === 'check') {
    if (isYes(v) && col.glyph) drawTick(pen, col.glyph.x0 + CHECK_DX, top + col.glyph.dy + CHECK_DY, 8.5)
    return
  }
  if (isBlank(v)) return
  const warn = { key: `${t.id}.${col.key}`, q: t.q }
  if (col.type === 'money') {
    const x = (col.dollar ?? col.x0) + 9
    drawText(pen, formatAmount(v), x, bot - 5, col.x1 - x - 4, { size: 8.5, warn })
    return
  }
  if (col.type === 'date' && col.slashes) {
    drawDate(pen, { s1: col.slashes[0], s2: col.slashes[1], baseline: bot - 5, x1: col.x1, size: 8 }, v, warn)
    return
  }
  const maxW = col.x1 - col.x0 - 7
  const str = pdfSafe(String(v).replace(/\s+/g, ' ').trim())
  const size = 7
  const all = wrap(pen.font, str, maxW, size)
  // One line on the row's baseline (shrunk a little if need be, and centred
  // with the other cells): short entries, and single words such as an email
  // address that can't wrap. Cut and flagged if it still doesn't fit.
  if (pen.font.widthOfTextAtSize(str, 8) <= maxW || all.length < 2) {
    drawText(pen, str, col.x0 + 3.5, bot - 5.5, maxW, { size: 8, warn })
    return
  }
  // Two lines in the cell, smaller; past that the rest is cut and flagged.
  const lh = Math.min(8.2, (bot - top - 4) / 2)
  all.slice(0, 2).forEach((ln, k) => drawText(pen, ln, col.x0 + 3.5, top + 2 + lh * (k + 1) - 0.8, maxW, { size, min: 5.5 }))
  if (all.length > 2) {
    pen.warnings.push({ ...warn, message: `A ${col.label} entry in table ${t.id} is too long for its cell: attach an annexure.` })
  }
}

/** Rows (and the total, on the last page) of one table on one copy of its page. */
function drawTableRows(pen: Pen, t: FormTable, rows: TableRow[], totals: TableRow | null) {
  const shift = (x: number) => (t.skew ? t.skew * (x - (t.skewOrigin ?? 0)) : 0)
  rows.forEach((row, i) => {
    const r = t.rows[i]
    for (const col of t.columns) {
      const dy = shift(col.x0)
      drawCell(pen, t, col, r.top + dy, r.bot + dy, row[col.key])
    }
  })
  if (totals && t.totals) {
    for (const col of t.columns) {
      if (col.type === 'money') drawCell(pen, t, col, t.totals.top, t.totals.bot, totals[col.key])
    }
  }
}

function drawTableHeader(pen: Pen, t: FormTable, pageNo: number, pageCount: number, data: FormData, formPageTotal: number) {
  const h = t.header
  const spot = (s: { x0: number; x1: number; baseline: number }, text: string, size: number, align: 'left' | 'center' = 'center') =>
    drawText(pen, text, s.x0, s.baseline, s.x1 - s.x0, { size, align })
  spot(h.pageFrom, String(t.formPage), 8.5)
  spot(h.pageOf, String(formPageTotal), 8.5)
  // Just above the dotted line, so the dots don't run through the name.
  if (data.signedBy) drawText(pen, data.signedBy, h.signedBy.x0 + 4, h.signedBy.baseline - 2, h.signedBy.x1 - h.signedBy.x0 - 8, { size: 8.5 })
  // "...and dated" stays blank: dated by hand beside the signature.
  spot(t.footer.page, String(pageNo), 14)
  spot(t.footer.of, String(pageCount), 14)
}

/* ---------------- fill ---------------- */

/** Applies the map's computed sums (only where the answer wasn't given). */
export function withComputed(map: FormMap, fields: FormData['fields']): FormData['fields'] {
  const out = { ...fields }
  for (const c of map.computed ?? []) {
    if (!isBlank(out[c.key])) continue
    const nums = c.sum.map((k) => toNumber(out[k])).filter((n): n is number => n !== null)
    if (nums.length) out[c.key] = Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100
  }
  return out
}

/**
 * Fills one form.
 *
 * @param template the official PDF, unchanged
 * @param map      the form's map (same version as the template)
 */
export async function fillForm(
  template: Uint8Array,
  map: FormMap,
  data: FormData,
  opts: FillOptions = {},
): Promise<FillResult> {
  const src = await PDFDocument.load(template)
  if (src.getPageCount() !== map.pageCount) {
    throw new Error(`Template has ${src.getPageCount()} pages; ${map.form} (${map.version}) has ${map.pageCount}.`)
  }
  const out = await PDFDocument.create()
  const font = await out.embedFont(StandardFonts.Helvetica)
  const ink = rgb(0, 0, 0)
  const warnings: FormWarning[] = []
  const fields = withComputed(map, data.fields ?? {})

  // 1) the form pages (plus any optional page asked for), unchanged, then the answers
  const include = new Set(opts.include ?? [])
  const printed = [...map.formPages, ...(map.optionalPages ?? []).filter((p) => include.has(p.id)).map((p) => p.page)]
  const copies = await out.copyPages(src, printed.map((p) => p - 1))
  const pageSources = [...printed]
  const pens = new Map<number, Pen>()
  printed.forEach((p, i) => {
    out.addPage(copies[i])
    pens.set(p, { page: copies[i], font, ink, warnings })
  })
  for (const f of map.fields) {
    const pen = pens.get(f.page)
    if (!pen) continue
    if (opts.debug) fieldBoxes(f).forEach((b) => outline(pen, b))
    if (f.handwritten) continue
    drawField(pen, f, fields[f.key])
  }

  // 2) appendix tables: the cover, then one copy of each table page per
  //    page-full of rows. Tables that share a page (A6) are drawn together.
  const mode = opts.tables ?? 'used'
  if (mode !== 'none') {
    const byPage = new Map<number, FormTable[]>()
    for (const t of map.tables) byPage.set(t.page, [...(byPage.get(t.page) ?? []), t])
    const pages = [...byPage.entries()]
      .map(([page, tables]) => ({ page, tables, rows: tables.map((t) => usedRows(data, t.id)) }))
      .filter((g) => mode === 'all' || g.rows.some((r) => r.length > 0))
    if (pages.length && map.appendixCoverPage) {
      const [cover] = await out.copyPages(src, [map.appendixCoverPage - 1])
      out.addPage(cover)
      pageSources.push(map.appendixCoverPage)
    }
    for (const g of pages) {
      const chunks = Math.max(1, ...g.tables.map((t, i) => Math.ceil(g.rows[i].length / t.rows.length)))
      g.tables.forEach((t, i) => {
        if (g.rows[i].length > t.rows.length) {
          warnings.push({
            key: t.id,
            q: t.q,
            message: `Table ${t.id} has ${g.rows[i].length} rows; the form holds ${t.rows.length} a page, so it is printed on ${Math.ceil(g.rows[i].length / t.rows.length)} pages.`,
          })
        }
      })
      for (let k = 0; k < chunks; k++) {
        const [pg] = await out.copyPages(src, [g.page - 1])
        out.addPage(pg)
        pageSources.push(g.page)
        const pen: Pen = { page: pg, font, ink, warnings }
        if (!g.rows.some((r) => r.length > 0)) continue // "all": a blank table stays as printed
        drawTableHeader(pen, g.tables[0], k + 1, chunks, data, map.formPageTotal)
        g.tables.forEach((t, i) => {
          const per = t.rows.length
          const slice = g.rows[i].slice(k * per, (k + 1) * per)
          const last = k === chunks - 1
          drawTableRows(pen, t, slice, last ? columnTotals(t, g.rows[i]) : null)
        })
      }
    }
  }

  out.setTitle(map.title)
  out.setSubject(`${map.form} (${map.version})`)
  out.setProducer('pdf-lib: official ASIC pages unchanged, answers written on top')
  return { pdf: await out.save(), warnings: dedupe(warnings), pages: out.getPageCount(), pageSources }
}

function columnTotals(t: FormTable, rows: TableRow[]): TableRow | null {
  if (!t.totals || rows.length === 0) return null
  const out: TableRow = {}
  for (const col of t.columns) {
    if (col.type !== 'money') continue
    const nums = rows.map((r) => toNumber(r[col.key])).filter((n): n is number => n !== null)
    if (nums.length) out[col.key] = Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100
  }
  return out
}

function dedupe(ws: FormWarning[]): FormWarning[] {
  const seen = new Set<string>()
  return ws.filter((w) => {
    const k = `${w.key}|${w.message}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Joins several filled forms into one PDF ("all forms"). */
export async function combinePdfs(parts: Uint8Array[], title: string): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  for (const bytes of parts) {
    const doc = await PDFDocument.load(bytes)
    const pages = await out.copyPages(doc, doc.getPageIndices())
    pages.forEach((p) => out.addPage(p))
  }
  out.setTitle(title)
  out.setProducer('pdf-lib: official ASIC pages unchanged, answers written on top')
  return out.save()
}
