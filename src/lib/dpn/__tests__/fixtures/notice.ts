import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { PdfLine } from '@/lib/pdf/pageLines'

/**
 * A SYNTHETIC director penalty notice, laid out like the ATO's (OpenText
 * Exstream, 4 pages). Every name, address, reference and figure here is made
 * up; no real notice is ever committed.
 *
 * The parts of the layout the parser depends on are reproduced:
 *  - page 1's mailing block shares baselines with the right-hand column, so
 *    the director's name sits on the same line as "Our reference:";
 *  - labels and values in separate cells ("For this company" | name);
 *  - page 3's "TO:" line with the home address under it;
 *  - the table on pages 3–4, its header repeated at the top of page 4, and
 *    right-aligned figures whose left edge moves with their width.
 */

export const SYNTHETIC = {
  director: 'MR JANE Q SAMPLE',
  street: '1 EXAMPLE STREET',
  suburb: 'SAMPLETON NSW 2000',
  company: 'EXAMPLE TRADING PTY LTD',
  /** A valid ACN check digit. */
  acn: '000000019',
  reference: '1234567890123',
}

/** A cell as drawn: left-aligned at `x`, or right-aligned to `right`. */
export type CellSpec = { x: number; text: string } | { right: number; text: string }

type Row = [period: string, column2: string, column3: string, column4: string, column5: string]

/** Left edges of "Column 1" … "Column 5", as on the PAYGW sample. */
export const COLUMN_X = [60, 211, 283, 364, 454]
/** Where each figure column's right-aligned amounts end. */
const FIGURE_RIGHT = [262, 333, 413, 510]

/** Rows on page 3, then page 4. Column 3 = Column 4 + Column 5 on each. */
export const PAGE3_ROWS: Row[] = [
  ['01 JAN 2025 to 31 MAR 2025', '12,500.00', '10,000.00', '9,000.00', '1,000.00'],
  ['01 OCT 2024 to 31 DEC 2024', '8,250.50', '8,250.50', '8,250.50', '0.00'],
  ['01 JUL 2024 to 30 SEP 2024', '123,456.78', '23,456.78', '0.00', '23,456.78'],
]
export const PAGE4_ROWS: Row[] = [
  ['01 APR 2024 to 30 JUN 2024', '4,000.00', '3,500.00', '3,000.00', '500.00'],
  ['01 JAN 2024 to 31 MAR 2024', '1,000.00', '999.99', '999.99', '0.00'],
]

/** The totals of the rows above, in cents. */
export const EXPECTED_TOTALS = {
  column2: 1_250_000 + 825_050 + 12_345_678 + 400_000 + 100_000,
  column3: 1_000_000 + 825_050 + 2_345_678 + 350_000 + 99_999,
  column4: 900_000 + 825_050 + 0 + 300_000 + 99_999,
  column5: 100_000 + 0 + 2_345_678 + 50_000 + 0,
}

function tableHeader(): CellSpec[][] {
  return [
    COLUMN_X.map((x, i) => ({ x, text: `Column ${i + 1}` })),
    [
      { x: 60, text: 'Particular withholding period' },
      { x: 211, text: 'Amount' },
      { x: 283, text: 'Amount the' },
      { x: 364, text: 'Unpaid amount of' },
      { x: 454, text: 'Unpaid amount' },
    ],
    [{ x: 211, text: 'withheld' }, { x: 283, text: 'Commissioner' }, { x: 364, text: "the company's" }],
    [{ x: 240, text: '$' }, { x: 317, text: '$' }, { x: 402, text: '$' }, { x: 490, text: '$' }],
  ]
}

function tableRow([period, ...figures]: Row): CellSpec[] {
  return [{ x: 60, text: period }, ...figures.map((text, i) => ({ right: FIGURE_RIGHT[i], text }))]
}

export interface NoticeOptions {
  /** What "This notice is for" says. */
  noticeFor?: string
  /** The page-3 subtitle. */
  subtitle?: string
  page3Rows?: Row[]
  page4Rows?: Row[]
  /** Drop the "TO:" line (and its address). */
  withoutTo?: boolean
}

/** The notice's pages, as cell specs. */
export function noticePages(options: NoticeOptions = {}): CellSpec[][][] {
  const {
    noticeFor = 'PAYG withholding',
    subtitle = 'PAYG withholding amounts',
    page3Rows = PAGE3_ROWS,
    page4Rows = PAGE4_ROWS,
    withoutTo = false,
  } = options

  const page1: CellSpec[][] = [
    [{ x: 57, text: SYNTHETIC.director }, { x: 387, text: 'Our reference:' }, { x: 462, text: SYNTHETIC.reference }],
    [{ x: 57, text: SYNTHETIC.street }],
    [{ x: 412, text: 'Client ID:' }, { x: 462, text: '999 999 999' }],
    [{ x: 57, text: SYNTHETIC.suburb }],
    [{ x: 391, text: 'Date of issue:' }, { x: 462, text: '30 September 2026' }],
    [{ x: 57, text: 'You have been issued with a director penalty notice' }],
    [{ x: 57, text: 'Dear Sir/Madam,' }],
    [{ x: 60, text: 'This notice is for' }, { x: 190, text: noticeFor }],
    [{ x: 60, text: 'For this company' }, { x: 190, text: SYNTHETIC.company }, { x: 436, text: 'Biller code:' }, { x: 479, text: '75556' }],
    [{ x: 60, text: 'With this ACN' }, { x: 190, text: SYNTHETIC.acn }, { x: 436, text: 'Ref:' }, { x: 453, text: '999999999999999999' }],
    [{ x: 57, text: 'Within 21 days after the issue date of the notice, you need to:' }],
  ]
  const page2: CellSpec[][] = [
    [{ x: 57, text: 'Director penalty defences' }],
    [{ x: 57, text: "be helpful if you can tell us the 'Our reference' number at the top" }],
  ]
  const page3: CellSpec[][] = [
    [{ x: 57, text: "Notice of director's liability to pay a penalty to" }],
    [{ x: 57, text: subtitle }],
    ...(withoutTo
      ? []
      : [
          [{ x: 57, text: `TO: ${SYNTHETIC.director}` }],
          [{ x: 57, text: SYNTHETIC.street }],
          [{ x: 57, text: SYNTHETIC.suburb }],
        ]),
    [{ x: 57, text: `a director of ${SYNTHETIC.company}, ACN ${SYNTHETIC.acn}` }],
    ...tableHeader(),
    ...page3Rows.map(tableRow),
    [{ x: 285, text: 'Page 3 of 4' }],
  ]
  const page4: CellSpec[][] = [
    ...tableHeader(),
    ...page4Rows.map(tableRow),
    [{ x: 57, text: 'The penalty in respect of each unpaid amount of the company\'s liability as detailed in Column 4 of the' }],
    [{ x: 57, text: 'above table will be remitted if' }, { x: 190, text: 'within 21 days after the date of this notice' }],
    [{ x: 285, text: 'Page 4 of 4' }],
  ]
  return [page1, page2, page3, page4]
}

/** A rough text width at 9pt, for cells built without a PDF. */
const approxWidth = (text: string) => text.length * 4.6

/** The pages as positioned lines, the way lib/pdf/pageLines.ts would read them. */
export function noticeLines(options?: NoticeOptions): PdfLine[][] {
  return noticePages(options).map((page) =>
    page.map((line) => {
      const cells = line.map((cell) => {
        const width = approxWidth(cell.text)
        return 'x' in cell
          ? { x: cell.x, right: cell.x + width, text: cell.text }
          : { x: cell.right - width, right: cell.right, text: cell.text }
      })
      return { text: cells.map((cell) => cell.text).join(' '), cells }
    }),
  )
}

/** The pages drawn into a real PDF with pdf-lib, right-aligned figures included. */
export async function buildNoticePdf(options?: NoticeOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const size = 9
  for (const lines of noticePages(options)) {
    const page = doc.addPage([595, 842])
    let y = 800
    for (const line of lines) {
      for (const cell of line) {
        const x = 'x' in cell ? cell.x : cell.right - font.widthOfTextAtSize(cell.text, size)
        page.drawText(cell.text, { x, y, size, font })
      }
      y -= 14
    }
  }
  return doc.save()
}
