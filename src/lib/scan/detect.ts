import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFObject } from 'pdf-lib'
import type { PdfLine } from '@/lib/pdf/pageLines'
import { readPdfPageCells } from '@/lib/pdf/pageLines'
import { MAX_FINANCIALS_PAGES } from '@/lib/printed/readPdf'

/**
 * Server-only. Which pages of a PDF are scans: (almost) no text layer and a
 * full-page image. Cheap (the text layer and the PDF's structure, no OCR, no
 * image decoding), so every read can ask it. Deliberately light: no sharp, no
 * Tesseract, so the pages that read statements do not carry the scan reader
 * (that runs only in /api/admin/clients/[id]/scan-read).
 */

/** Fewer text characters than this and a full-page image: a scan. */
const SCANNED_MAX_TEXT = 20

export interface PageImageInfo {
  /** Page size in PDF points. */
  widthPt: number
  heightPt: number
  /** The page's largest image, and whether its shape matches the page (a full-page scan). */
  image: { width: number; height: number; fullPage: boolean; format: string } | null
}

export const name = (o: PDFObject | undefined) => (o instanceof PDFName ? o.decodeText() : null)
export const filters = (o: PDFObject | undefined): string[] =>
  o instanceof PDFArray ? o.asArray().map((x) => name(x) ?? '') : o instanceof PDFName ? [o.decodeText()] : []

export function largestImage(doc: PDFDocument, pageIndex: number): PDFRawStream | null {
  const page = doc.getPage(pageIndex)
  const resources = page.node.Resources()
  const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict)
  if (!xobjects) return null
  let best: PDFRawStream | null = null
  let bestArea = 0
  for (const [, ref] of xobjects.entries()) {
    const stream = doc.context.lookup(ref)
    if (!(stream instanceof PDFRawStream) || name(stream.dict.get(PDFName.of('Subtype'))) !== 'Image') continue
    const w = (stream.dict.lookup(PDFName.of('Width')) as PDFNumber | undefined)?.asNumber() ?? 0
    const h = (stream.dict.lookup(PDFName.of('Height')) as PDFNumber | undefined)?.asNumber() ?? 0
    if (w * h > bestArea) {
      best = stream
      bestArea = w * h
    }
  }
  return best
}

export async function openPdf(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
}

export function pageImageInfo(doc: PDFDocument, pageIndex: number): PageImageInfo {
  const { width: widthPt, height: heightPt } = doc.getPage(pageIndex).getSize()
  const stream = largestImage(doc, pageIndex)
  if (!stream) return { widthPt, heightPt, image: null }
  const width = (stream.dict.lookup(PDFName.of('Width')) as PDFNumber).asNumber()
  const height = (stream.dict.lookup(PDFName.of('Height')) as PDFNumber).asNumber()
  // A full-page scan has the page's shape (either way round) and real resolution.
  const ratio = width / height
  const pageRatio = widthPt / heightPt
  const fullPage = Math.min(width, height) >= 800 && (Math.abs(ratio - pageRatio) / pageRatio < 0.06 || Math.abs(1 / ratio - pageRatio) / pageRatio < 0.06)
  return { widthPt, heightPt, image: { width, height, fullPage, format: filters(stream.dict.get(PDFName.of('Filter'))).join('+') || 'none' } }
}

/** Pages that are scans (1-based), from the text layer and the images. */
export async function scannedPages(bytes: Uint8Array): Promise<{ textPages: PdfLine[][]; scanned: number[] }> {
  const { pages: textPages } = await readPdfPageCells(bytes, MAX_FINANCIALS_PAGES)
  const doc = await openPdf(bytes)
  const scanned: number[] = []
  textPages.forEach((lines, i) => {
    const chars = lines.reduce((n, l) => n + l.text.replace(/\s/g, '').length, 0)
    if (chars >= SCANNED_MAX_TEXT) return
    if (pageImageInfo(doc, i).image?.fullPage) scanned.push(i + 1)
  })
  return { textPages, scanned }
}
