import { inflateSync } from 'node:zlib'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFObject } from 'pdf-lib'
import sharp from 'sharp'

/**
 * Server-only. A scanned page is a picture: a PDF page whose only content is
 * one image covering it. This pulls that image out of the PDF as it is stored
 * (a JPEG, or raw pixels made into a PNG), in memory: nothing is rendered,
 * written to disk or sent anywhere.
 *
 * Supported: JPEG (DCTDecode, also inside FlateDecode) and 8-bit grey/RGB
 * pixels (FlateDecode with no predictor). Anything else (CCITT fax, JBIG2,
 * JPEG 2000) is reported, never guessed.
 */

export interface PageImage {
  bytes: Uint8Array
  mediaType: 'image/jpeg' | 'image/png'
  width: number
  height: number
}

export interface PageImageInfo {
  /** Page size in PDF points. */
  widthPt: number
  heightPt: number
  /** The page's largest image, and whether its shape matches the page (a full-page scan). */
  image: { width: number; height: number; fullPage: boolean; format: string } | null
}

const name = (o: PDFObject | undefined) => (o instanceof PDFName ? o.decodeText() : null)
const filters = (o: PDFObject | undefined): string[] =>
  o instanceof PDFArray ? o.asArray().map((x) => name(x) ?? '') : o instanceof PDFName ? [o.decodeText()] : []

function largestImage(doc: PDFDocument, pageIndex: number): PDFRawStream | null {
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

export class UnsupportedScanImageError extends Error {
  constructor(readonly format: string) {
    super(`This scanned page's image (${format}) cannot be read yet.`)
    this.name = 'UnsupportedScanImageError'
  }
}

/** The page's image, ready for Tesseract and Claude. Throws UnsupportedScanImageError for formats not handled. */
export async function extractPageImage(doc: PDFDocument, pageIndex: number): Promise<PageImage> {
  const stream = largestImage(doc, pageIndex)
  if (!stream) throw new UnsupportedScanImageError('no image')
  const width = (stream.dict.lookup(PDFName.of('Width')) as PDFNumber).asNumber()
  const height = (stream.dict.lookup(PDFName.of('Height')) as PDFNumber).asNumber()
  const chain = filters(stream.dict.get(PDFName.of('Filter')))
  let data = stream.contents
  const rest = [...chain]
  while (rest[0] === 'FlateDecode' && rest.length > 1) {
    data = inflateSync(data)
    rest.shift()
  }
  if (rest.length === 1 && rest[0] === 'DCTDecode') return { bytes: data, mediaType: 'image/jpeg', width, height }
  if (rest.length === 1 && rest[0] === 'FlateDecode' && !stream.dict.get(PDFName.of('DecodeParms'))) {
    const bpc = (stream.dict.lookup(PDFName.of('BitsPerComponent')) as PDFNumber | undefined)?.asNumber()
    const cs = name(stream.dict.get(PDFName.of('ColorSpace')))
    const channels = cs === 'DeviceGray' ? 1 : cs === 'DeviceRGB' ? 3 : 0
    if (bpc === 8 && channels) {
      const png = await sharp(inflateSync(data), { raw: { width, height, channels } }).png().toBuffer()
      return { bytes: new Uint8Array(png), mediaType: 'image/png', width, height }
    }
  }
  throw new UnsupportedScanImageError(chain.join('+') || 'unknown')
}

/** A horizontal band of the page image (fractions of its height), as a PNG: the crop shown beside a scanned figure. */
export async function cropBand(image: PageImage, band: [number, number], { pad = 0.008, maxWidth = 1400 } = {}): Promise<Uint8Array> {
  const top = Math.max(0, Math.floor((band[0] - pad) * image.height))
  const bottom = Math.min(image.height, Math.ceil((band[1] + pad) * image.height))
  const out = await sharp(image.bytes)
    .extract({ left: 0, top, width: image.width, height: Math.max(1, bottom - top) })
    .resize({ width: Math.min(maxWidth, image.width), withoutEnlargement: true })
    .png()
    .toBuffer()
  return new Uint8Array(out)
}
