import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { formatCents } from './view'
import {
  DPN_EXPORT_SOURCE_NOTE,
  DPN_TABLE_LEGEND,
  amountHeadings,
  columnLabels,
  describeDaysLeft,
  formatIsoDate,
  isUrgent,
  typeLabel,
  type DpnSummary,
} from './summary'
import type { DpnExportMeta } from './exportCsv'
import type { DpnAmounts } from './types'

/**
 * The DPN summary as a PDF of real text (pdf-lib), not a screenshot: it can
 * be searched, copied and read by a screen reader. Landscape A4, so the
 * notice table's columns fit.
 *
 * Every page's footer says where the figures come from. Only what the summary
 * holds is drawn — the director's name, never an address.
 */

const PAGE: [number, number] = [842, 595]
const MARGIN = 40
const FOOTER_SPACE = 40
const SIZE = 9
const LINE = 13

const INK = rgb(0.1, 0.1, 0.12)
const MUTED = rgb(0.4, 0.4, 0.45)
const RULE = rgb(0.78, 0.78, 0.8)
const RED = rgb(0.75, 0.15, 0.12)

/**
 * The standard fonts encode WinAnsi only. A name with characters outside it
 * would make pdf-lib throw, so accents are folded and anything else becomes
 * "?" rather than failing the export.
 */
export function pdfSafe(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of pdfSafe(text).split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

function fit(font: PDFFont, text: string, size: number, width: number): string {
  let s = pdfSafe(text)
  if (font.widthOfTextAtSize(s, size) <= width) return s
  while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > width) s = s.slice(0, -1)
  return `${s}...`
}

/** The notice table's columns: left edge, width, alignment. */
const NOTICE_COLUMNS = [
  { key: 'standing', title: 'Standing', x: 40, w: 46 },
  { key: 'type', title: 'Type', x: 88, w: 72 },
  { key: 'director', title: 'Director', x: 162, w: 112 },
  { key: 'issued', title: 'Issued', x: 276, w: 56 },
  { key: 'deadline', title: 'Deadline', x: 334, w: 56 },
  { key: 'days', title: 'Days left', x: 392, w: 64 },
  // Amount columns are titled from the notices' own headings (amountHeadings).
  { key: 'column2', title: '', x: 458, w: 62, right: true },
  { key: 'column3', title: '', x: 528, w: 62, right: true },
  { key: 'column4', title: '', x: 598, w: 62, right: true },
  { key: 'column5', title: '', x: 668, w: 62, right: true },
  { key: 'source', title: 'How read', x: 744, w: 58 },
] as const

class Writer {
  page!: PDFPage
  y = 0
  constructor(
    private doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.newPage()
  }

  newPage() {
    this.page = this.doc.addPage(PAGE)
    this.y = PAGE[1] - MARGIN
  }

  /** Start a new page unless `height` still fits above the footer. */
  ensure(height: number) {
    if (this.y - height < MARGIN + FOOTER_SPACE) this.newPage()
  }

  text(text: string, x: number, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; right?: number } = {}) {
    const font = opts.font ?? this.font
    const size = opts.size ?? SIZE
    const safe = pdfSafe(text)
    const drawX = opts.right !== undefined ? opts.right - font.widthOfTextAtSize(safe, size) : x
    this.page.drawText(safe, { x: drawX, y: this.y, size, font, color: opts.color ?? INK })
  }

  rule() {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y + 4 },
      end: { x: PAGE[0] - MARGIN, y: this.y + 4 },
      thickness: 0.5,
      color: RULE,
    })
  }

  heading(text: string) {
    this.ensure(40)
    this.y -= 10
    this.text(text, MARGIN, { font: this.bold, size: 12 })
    this.y -= 18
  }
}

/** Header text and line height for the long, wrapped column headings. */
const HEAD_SIZE = 6.5
const HEAD_LINE = 7.5

/**
 * A table header whose cells wrap: each title over as many lines as it needs,
 * bottom-aligned so every column's last line sits on the rule.
 */
function drawWrappedHeader(
  w: Writer,
  cells: { title: string; x: number; w: number; right?: boolean }[],
) {
  const wrapped = cells.map((c) => wrap(w.bold, c.title, HEAD_SIZE, c.w))
  const depth = Math.max(...wrapped.map((lines) => lines.length))
  w.ensure(depth * HEAD_LINE + LINE * 2)
  const top = w.y
  cells.forEach((c, i) => {
    const lines = wrapped[i]
    lines.forEach((line, k) => {
      w.y = top - (depth - lines.length + k) * HEAD_LINE
      w.text(line, c.x, { font: w.bold, size: HEAD_SIZE, right: c.right ? c.x + c.w : undefined })
    })
  })
  w.y = top - (depth - 1) * HEAD_LINE - 6
  w.rule()
  w.y -= 8
}

function money(a: DpnAmounts, key: keyof DpnAmounts) {
  return formatCents(a[key])
}

export async function buildDpnPdf(summary: DpnSummary, meta: DpnExportMeta): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(pdfSafe(`Director penalty notices - ${meta.clientName}`))
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const w = new Writer(doc, font, bold)

  w.text('Director penalty notices', MARGIN, { font: bold, size: 16 })
  w.y -= 18
  w.text(`${meta.clientName} · as at ${formatIsoDate(meta.asAtIso)}`, MARGIN, { color: MUTED, size: 10 })
  w.y -= 14

  // ── Company totals by type ────────────────────────────────────────────────
  w.heading('What the company owes, by type')
  if (summary.companyByType.length === 0) {
    w.text('No notice has been read or entered yet.', MARGIN, { color: MUTED })
    w.y -= LINE
  }
  const labelWidth = 520
  const amountRight = MARGIN + labelWidth + 140
  for (const t of summary.companyByType) {
    const labels = columnLabels(t.type, t.earliestDeadline)
    w.ensure(90)
    w.text(typeLabel(t.type), MARGIN, { font: bold, size: 10 })
    w.text(
      `${t.periods} period${t.periods === 1 ? '' : 's'}, each counted once · earliest deadline ${formatIsoDate(t.earliestDeadline)}`,
      MARGIN + 130,
      { color: MUTED },
    )
    w.y -= LINE + 2
    for (const key of ['column3', 'column4', 'column5', 'column2'] as const) {
      const lines = wrap(font, labels[key], SIZE, labelWidth - 20)
      w.ensure(lines.length * LINE)
      lines.forEach((line, i) => {
        w.text(line, MARGIN + 12, { font: key === 'column3' ? bold : font })
        if (i === 0) w.text(money(t.totals, key), 0, { right: amountRight, font: key === 'column3' ? bold : font })
        w.y -= LINE
      })
    }
    w.y -= 6
  }
  if (summary.companyByType.length > 1) {
    w.ensure(LINE * 2)
    // The rule sits above the line, clear of the text.
    w.y -= 2
    w.rule()
    w.y -= 12
    w.text('All types: unpaid', MARGIN + 12, { font: bold })
    w.text(money(summary.company, 'column3'), 0, { right: amountRight, font: bold })
    w.y -= LINE + 6
  }

  // ── Notices ───────────────────────────────────────────────────────────────
  w.heading('Notices')
  const noticeHeadings = amountHeadings(summary.notices.map((n) => n.type))
  const noticeHeaderCells = NOTICE_COLUMNS.map((c) => ({
    title: c.key in noticeHeadings ? noticeHeadings[c.key as keyof DpnAmounts] : c.title,
    x: c.x,
    w: c.w,
    right: 'right' in c,
  }))
  const drawNoticeHeader = () => drawWrappedHeader(w, noticeHeaderCells)
  drawNoticeHeader()
  for (const n of summary.notices) {
    if (w.y - LINE < MARGIN + FOOTER_SPACE) {
      w.newPage()
      drawNoticeHeader()
    }
    const cells: Record<string, string> = {
      standing: n.standing === 'current' ? 'Current' : 'History',
      type: typeLabel(n.type),
      director: n.directorName,
      issued: formatIsoDate(n.issuedOn),
      deadline: formatIsoDate(n.deadline),
      days: describeDaysLeft(n.daysLeft),
      column2: money(n.totals, 'column2'),
      column3: money(n.totals, 'column3'),
      column4: money(n.totals, 'column4'),
      column5: money(n.totals, 'column5'),
      source: `${n.source === 'manual' ? 'Manually' : 'Automatically'}${n.needsReview || n.issues.length > 0 ? ' *' : ''}`,
    }
    for (const c of NOTICE_COLUMNS) {
      const value = fit(font, cells[c.key], 8, c.w)
      const urgent = c.key === 'days' && n.standing === 'current' && isUrgent(n.daysLeft)
      w.text(value, c.x, {
        size: 8,
        right: 'right' in c ? c.x + c.w : undefined,
        color: urgent ? RED : n.standing === 'history' ? MUTED : INK,
        font: urgent ? bold : font,
      })
    }
    w.y -= LINE
  }
  if (summary.notices.length === 0) {
    w.text('None yet.', MARGIN, { color: MUTED })
    w.y -= LINE
  }
  const legend = [...DPN_TABLE_LEGEND, '* Something on this notice needs checking: see the client page.']
  w.y -= 4
  for (const line of legend) {
    for (const part of wrap(font, line, 8, PAGE[0] - 2 * MARGIN)) {
      w.ensure(LINE)
      w.text(part, MARGIN, { size: 8, color: MUTED })
      w.y -= 11
    }
  }

  // ── By director ───────────────────────────────────────────────────────────
  // The heading, the wrapped column headings and a first row stay together.
  w.ensure(110)
  w.heading('By director (current notices)')
  const dirHeadings = amountHeadings(summary.directors.flatMap((d) => d.byType.map((t) => t.type)))
  // Right edges of the four amount columns.
  const dirAmountRights = [480, 580, 680, 780]
  const dirHeaderCells = [
    { title: 'Director', x: 40, w: 210 },
    { title: 'Type', x: 260, w: 120 },
    ...(['column2', 'column3', 'column4', 'column5'] as const).map((key, k) => ({
      title: dirHeadings[key],
      x: dirAmountRights[k] - 90,
      w: 90,
      right: true,
    })),
  ]
  const drawDirHeader = () => drawWrappedHeader(w, dirHeaderCells)
  drawDirHeader()
  for (const d of summary.directors) {
    const rows = [
      ...d.byType.map((t) => ({ type: typeLabel(t.type), totals: t.totals, strong: false })),
      ...(d.byType.length > 1 ? [{ type: 'All types', totals: d.overall, strong: true }] : []),
    ]
    rows.forEach((r, i) => {
      if (w.y - LINE < MARGIN + FOOTER_SPACE) {
        w.newPage()
        drawDirHeader()
      }
      const f = r.strong ? bold : font
      if (i === 0) w.text(fit(font, d.directorName, 8, 210), 40, { size: 8 })
      w.text(r.type, 260, { size: 8, font: f })
      ;(['column2', 'column3', 'column4', 'column5'] as const).forEach((key, k) => {
        w.text(money(r.totals, key), 0, { size: 8, font: f, right: dirAmountRights[k] })
      })
      w.y -= LINE
    })
  }

  // ── Not counted ───────────────────────────────────────────────────────────
  if (summary.waiting.length > 0) {
    w.heading('Not in the totals')
    w.text('These files are waiting to be read or entered manually:', MARGIN, { color: MUTED })
    w.y -= LINE
    for (const waiting of summary.waiting) {
      w.ensure(LINE)
      w.text(fit(font, waiting.filename, SIZE, 600), MARGIN + 12)
      w.y -= LINE
    }
  }

  // ── Footers ───────────────────────────────────────────────────────────────
  const pages = doc.getPages()
  pages.forEach((page, i) => {
    page.drawText(pdfSafe(DPN_EXPORT_SOURCE_NOTE), { x: MARGIN, y: 22, size: 8, font, color: MUTED })
    const label = `Page ${i + 1} of ${pages.length}`
    page.drawText(label, {
      x: PAGE[0] - MARGIN - font.widthOfTextAtSize(label, 8),
      y: 22,
      size: 8,
      font,
      color: MUTED,
    })
  })

  return doc.save()
}
