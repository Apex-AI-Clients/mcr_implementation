import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument } from 'pdf-lib'

/**
 * Synthetic scanned statements for the tests: a made-up statement drawn on a
 * 200 dpi A4 canvas and wrapped, as a JPEG, in an image-only PDF page (as a
 * scanner makes them). No real client data.
 */

export interface SyntheticRow {
  label: string
  indent?: number
  /** One per column, as printed; omitted for a heading. */
  amounts?: string[]
  bold?: boolean
}

export interface SyntheticPage {
  title?: string
  titleBlock?: string[]
  columns?: string[]
  rows?: SyntheticRow[]
  /** Free text instead of a statement (a cover, notes). */
  text?: string[]
}

const W = 1654
const H = 2339
const LEFT = 190
const RIGHTS = [1300, 1480]

export function drawPage(page: SyntheticPage): Buffer {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#111111'
  let y = 260
  if (page.title) {
    ctx.font = 'bold 64px Arial'
    ctx.fillText(page.title, LEFT, y)
    y += 80
  }
  ctx.font = '40px Arial'
  for (const t of page.titleBlock ?? []) {
    ctx.fillText(t, LEFT, y)
    y += 56
  }
  for (const t of page.text ?? []) {
    ctx.fillText(t, LEFT, y)
    y += 56
  }
  if (page.columns) {
    y += 40
    ctx.font = 'bold 34px Arial'
    ctx.textAlign = 'right'
    page.columns.forEach((c, i) => ctx.fillText(c, RIGHTS[i], y))
    ctx.textAlign = 'left'
    y += 70
  }
  for (const row of page.rows ?? []) {
    ctx.font = `${row.bold || !row.amounts ? 'bold ' : ''}36px Arial`
    ctx.fillText(row.label, LEFT + (row.indent ?? 0) * 30, y)
    ctx.textAlign = 'right'
    row.amounts?.forEach((a, i) => ctx.fillText(a, RIGHTS[i], y))
    ctx.textAlign = 'left'
    y += 58
  }
  return canvas.toBuffer('image/jpeg', 92)
}

/** An image-only PDF, one scanned page per entry; `textPages` adds ordinary text-layer pages (by index) for a mixed PDF. */
export async function scannedPdf(pages: SyntheticPage[], { textPages = new Map<number, string[]>() } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont('Helvetica')
  for (let i = 0; i < pages.length; i++) {
    const page = doc.addPage([595.28, 841.89])
    const text = textPages.get(i)
    if (text) {
      text.forEach((t, n) => page.drawText(t, { x: 57, y: 780 - n * 16, size: 11, font }))
      continue
    }
    const jpg = await doc.embedJpg(drawPage(pages[i]))
    page.drawImage(jpg, { x: 0, y: 0, width: 595.28, height: 841.89 })
  }
  return doc.save()
}

/** A two-year profit and loss that adds up (or, with `wrongTotal`, a printed total that does not). */
export function profitAndLoss({ wrongTotal = false } = {}): SyntheticPage {
  return {
    title: 'Profit & Loss Statement',
    titleBlock: ['Example Family Trust', 'For the year ended 30 June 2023'],
    columns: ['2023', '2022'],
    rows: [
      { label: 'Income' },
      { label: 'Sales', indent: 1, amounts: ['152,400', '140,100'] },
      { label: 'Interest Income', indent: 1, amounts: ['600', '-'] },
      { label: 'Total Income', indent: 1, amounts: ['153,000', '140,100'], bold: true },
      { label: 'Expenses' },
      { label: 'Rent', indent: 1, amounts: ['24,000', '24,000'] },
      { label: 'Wages', indent: 1, amounts: ['61,500', '58,200'] },
      { label: 'Total Expenses', indent: 1, amounts: [wrongTotal ? '86,500' : '85,500', '82,200'], bold: true },
      { label: 'Net Profit', amounts: ['67,500', '57,900'], bold: true },
    ],
  }
}

/** Claude's transcription of profitAndLoss(), as the schema asks (scan/claudeReader.ts); `change` alters one figure. */
export function profitAndLossAnswer({ change }: { change?: { label: string; column: number; to: string } } = {}): string {
  const page = profitAndLoss()
  const rows = page.rows!.map((r, i) => ({
    label: r.label,
    indent: r.indent ?? 0,
    amounts: (r.amounts ?? [null, null]).map((a, c) => (change && change.label === r.label && change.column === c ? change.to : a)),
    top: Math.round(((370 + 110 + i * 58) / H) * 100) / 100,
  }))
  return JSON.stringify({ title: page.title, title_block: page.titleBlock, columns: page.columns, rows })
}
