import type { PdfCell, PdfLine } from '@/lib/pdf/pageLines'

/**
 * Tesseract's words on a scanned page -> the positioned lines the as-printed
 * reader reads (readStatements.ts), exactly as it reads a text layer. Pure.
 *
 *   positions   image pixels -> PDF points, so the reader's column distances hold
 *   cells       words closer than about one character height join; a wider gap
 *               (label to figure, figure to figure) starts a new cell
 *   rules       a printed ruling line Tesseract reads as junk ("EE ———— NSE") is dropped
 *   dashes      a nil "—" or "–" (or a faint one read as ".") is the "-" the reader takes as nil
 *   junk        a fragment of a ruling line: a dash wider than a nil dash, short
 *               text spread across the page ("J SSSR"), a low-confidence scrap
 *               of one or two letters; a heading's underline end read as a
 *               lone "-" beside its label
 *
 * Each line keeps its band on the page (fractions of the height) for the crop.
 */

export interface OcrWord {
  text: string
  /** 0–100. */
  confidence: number
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrLine {
  words: OcrWord[]
}

export interface BandedLine extends PdfLine {
  band: [number, number]
}

/** A word that is only rule strokes, or junk Tesseract reads off a ruling line. */
const RULE_RUN = /[—–_=~-]{3,}/
const DASH_ONLY = /^[—–-]+$/

export function ocrToLines(lines: OcrLine[], image: { width: number; height: number }, page: { widthPt: number; heightPt: number }): BandedLine[] {
  const sx = page.widthPt / image.width
  const out: BandedLine[] = []
  for (const line of lines) {
    // Low-confidence scraps of one or two letters out among the figures are ruling-line noise (labels sit at the left).
    const words = line.words.filter((w) => w.text.trim() !== '' && !(w.confidence < 50 && /^[A-Za-z]{1,2}$/.test(w.text.trim()) && w.x0 > image.width * 0.35))
    if (words.length === 0) continue
    // A ruling line: any long run of strokes, the rest low-confidence noise.
    if (words.some((w) => RULE_RUN.test(w.text)) && words.every((w) => RULE_RUN.test(w.text) || w.confidence < 70)) continue
    const sorted = [...words].sort((a, b) => a.x0 - b.x0)
    const height = Math.max(1, median(sorted.map((w) => w.y1 - w.y0)))
    const cells: PdfCell[] = []
    let current: (PdfCell & { endPx: number }) | null = null
    for (const w of sorted) {
      const raw = w.text.trim()
      const text = DASH_ONLY.test(raw) || (raw === '.' && (w.x1 - w.x0) * sx <= 4) ? '-' : raw
      if (current && w.x0 - current.endPx <= height * 1.1) {
        current.text += ` ${text}`
        current.right = w.x1 * sx
        current.endPx = w.x1
      } else {
        current = { x: w.x0 * sx, right: w.x1 * sx, text, endPx: w.x1 }
        cells.push(current)
      }
    }
    let tidy = cells
      .map(({ x, right, text }) => ({ x, right, text: text.replace(/\s+/g, ' ').trim() }))
      .filter((c) => c.text !== '')
      // A ruling-line fragment: a dash wider than a nil dash, or a few letters spread far wider than text is.
      .filter((c) => !(c.text === '-' && c.right - c.x > 8) && !((c.right - c.x) / c.text.length > 20 && !/\d/.test(c.text)))
    // A heading's underline ending in one column: a lone "-" beside a label, with no other figure.
    const figures = tidy.filter((c) => /\d/.test(c.text) || c.text === '-')
    if (tidy.length >= 2 && figures.length === 1 && figures[0].text === '-' && /[a-z]/i.test(tidy[0].text)) tidy = tidy.filter((c) => c !== figures[0])
    if (tidy.length === 0) continue
    const top = Math.min(...words.map((w) => w.y0)) / image.height
    const bottom = Math.max(...words.map((w) => w.y1)) / image.height
    out.push({ text: tidy.map((c) => c.text).join(' '), cells: tidy, band: [top, bottom] })
  }
  return out
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}
