import { inflateSync } from 'node:zlib'
import { PDFName, PDFNumber, type PDFDocument } from 'pdf-lib'
import { filters, largestImage, name } from './detect'

export { openPdf, pageImageInfo, type PageImageInfo } from './detect'
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

export class UnsupportedScanImageError extends Error {
  constructor(readonly format: string) {
    super(`This scanned page's image (${format}) cannot be read yet.`)
    this.name = 'UnsupportedScanImageError'
  }
}

/** The page's image, ready for Claude. Throws UnsupportedScanImageError for formats not handled. */
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

