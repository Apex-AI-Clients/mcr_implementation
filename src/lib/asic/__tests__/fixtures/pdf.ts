import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

/**
 * SYNTHETIC PDFs for the extraction tests, built with pdf-lib. No real extract
 * is ever committed; these reproduce its layout from the synthetic text lines
 * in extract.ts.
 *
 * ASIC prints labels, values and document numbers in three columns on one
 * baseline. A line like "Name: JANE SAMPLE 7EBH40554" is drawn as three
 * separate pieces of text, so the test proves extractText.ts puts them back
 * together into the line the parser expects.
 */

const PAGE: [number, number] = [595, 842]
const TOP = 800
const BOTTOM = 60
const LEADING = 14
const COLUMNS = { label: 40, value: 200, document: 470 }

const LABELLED = /^([A-Za-z][A-Za-z &/()'.-]{0,48}:)\s*(.*)$/
const TRAILING_DOCUMENT = /^(.*?)\s+((?=[A-Z0-9]*\d)[A-Z0-9]{8,10})$/

/** The first half of a label that ASIC wraps in its narrow left column. */
const SPLIT_LABEL_START = /^(Principal Place Of) (.+)$/
/** A section heading with the right-hand column's header on the same line. */
const HEADING_WITH_COLUMN = /^(.+) (Document Number)$/

function columns(line: string): { x: number; text: string }[] {
  // "Principal Place Of Unit 1, … NORTH 7EBH40554": half a label in the left
  // column, the address's first line beside it, its document number on the right.
  const split = SPLIT_LABEL_START.exec(line)
  if (split) {
    const doc = TRAILING_DOCUMENT.exec(split[2])
    return [
      { x: COLUMNS.label, text: split[1] },
      { x: COLUMNS.value, text: doc ? doc[1] : split[2] },
      ...(doc ? [{ x: COLUMNS.document, text: doc[2] }] : []),
    ]
  }
  const heading = HEADING_WITH_COLUMN.exec(line)
  if (heading && !LABELLED.test(line)) {
    return [
      { x: COLUMNS.label, text: heading[1] },
      { x: COLUMNS.document, text: heading[2] },
    ]
  }

  const labelled = LABELLED.exec(line)
  if (!labelled) {
    const doc = TRAILING_DOCUMENT.exec(line)
    return doc
      ? [
          { x: COLUMNS.value, text: doc[1] },
          { x: COLUMNS.document, text: doc[2] },
        ]
      : [{ x: COLUMNS.label, text: line }]
  }
  const [, label, rest] = labelled
  const doc = TRAILING_DOCUMENT.exec(rest)
  const parts = [{ x: COLUMNS.label, text: label }]
  if (doc) {
    parts.push({ x: COLUMNS.value, text: doc[1] }, { x: COLUMNS.document, text: doc[2] })
  } else if (rest) {
    parts.push({ x: COLUMNS.value, text: rest })
  }
  return parts
}

/**
 * Lay the lines out over as many pages as they need, with a footer on each
 * page and the cover's header repeated at the top of every page after the
 * first — the way a real extract prints.
 */
export async function buildExtractPdf(
  lines: string[],
  { linesPerPage = 40, header = [] as string[] } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pageCount = Math.max(1, Math.ceil(lines.length / linesPerPage))

  for (let p = 0; p < pageCount; p++) {
    const page = doc.addPage(PAGE)
    let y = TOP
    const body = lines.slice(p * linesPerPage, (p + 1) * linesPerPage)
    for (const line of [...(p > 0 ? header : []), ...body]) {
      for (const part of columns(line)) {
        page.drawText(part.text, { x: part.x, y, size: 9, font, color: rgb(0, 0, 0) })
      }
      y -= LEADING
    }
    page.drawText(`Page ${p + 1} of ${pageCount}`, { x: 270, y: BOTTOM, size: 8, font })
  }
  return doc.save()
}

/** A PDF with no text layer at all — what a scan looks like to a text extractor. */
export async function buildImageOnlyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage(PAGE)
  page.drawRectangle({ x: 40, y: 400, width: 500, height: 300, color: rgb(0.8, 0.8, 0.8) })
  page.drawLine({ start: { x: 40, y: 380 }, end: { x: 540, y: 380 }, thickness: 2 })
  return doc.save()
}

/** An ordinary, non-ASIC document. */
export async function buildInvoicePdf(): Promise<Uint8Array> {
  return buildExtractPdf([
    'TAX INVOICE',
    'Sample Supplies Pty Ltd',
    'Invoice number: INV-0042',
    'Name: Some Customer',
    'Total due: $1,234.00',
  ])
}
