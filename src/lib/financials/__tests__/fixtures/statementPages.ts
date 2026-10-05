import { PDFDocument, StandardFonts } from 'pdf-lib'

/**
 * SYNTHETIC financial statement pages for the pre-pass tests. Every name, ABN
 * and figure here is invented. No real client document is reproduced; these
 * only copy the SHAPES the product has to read:
 *
 *   A) combined — cover letter, contents, Income Statement, Balance Sheet,
 *      notes / appropriation / declaration / depreciation, then an appended
 *      Company Tax Return. Two columns (current FY + prior FY).
 *   B) separate — one-page P&L and one-page Balance Sheet per FY, a trust's
 *      heading ("<CO> PTY LTD ATF <NAME> FAMILY TRUST") with the trust's ABN.
 *   C) current period — "For the period 1 July 2025 to 4 May 2026" P&L and an
 *      "As at 4 May 2026" Balance Sheet, one column, with cents.
 *
 * A page is a list of lines, top to bottom. In a line, "|" separates pieces
 * that the PDF builder draws in separate columns, the way statements print
 * labels and figures — so the PDF tests prove they come back as one line.
 */

export type Page = string[]

export const COMPANY = 'SAMPLE TRADING PTY LTD'
/** Invented, but with valid ABN checksums (randomly generated, not looked up). */
export const COMPANY_ABN = '30 484 621 880'
export const TRUST_ABN = '33 114 847 696'
export const TRUSTEE_HEADING = 'SAMPLE HOLDINGS PTY LTD ATF SAMPLE FAMILY TRUST'

const FIGURES = [
  ['Sales', '120,000', '98,500'],
  ['Purchases', '40,000', '35,250'],
  ['Rent', '12,000', '12,000'],
  ['Wages and salaries', '30,500', '28,000'],
]

export function coverLetter(): Page {
  return [
    'Sample & Co Chartered Accountants',
    'ABN 12 345 678 901',
    '1 Example Street, Sampletown',
    `The Directors, ${COMPANY}`,
    'Dear Directors,',
    'We enclose the financial statements and income tax return for the year.',
    'The balance sheet and income statement have been prepared from your records.',
    'Yours faithfully,',
  ]
}

export function titlePage(fy: number, entity = COMPANY, abn = COMPANY_ABN): Page {
  return [entity, `ABN ${abn}`, 'Financial Statements', `For the year ended 30 June ${fy}`]
}

export function contents(): Page {
  return [
    'Contents',
    'Income Statement | 3',
    'Balance Sheet | 4',
    'Notes to the Financial Statements | 5',
    'Directors Declaration | 7',
    'Compilation Report | 8',
  ]
}

export function incomeStatement(
  fy: number,
  { entity = COMPANY, heading = 'Income Statement', comparative = true } = {},
): Page {
  return [
    entity,
    heading,
    `For the year ended 30 June ${fy}`,
    comparative ? `| ${fy} | ${fy - 1}` : `| ${fy}`,
    ...FIGURES.map(([label, a, b]) => (comparative ? `${label} | ${a} | ${b}` : `${label} | ${a}`)),
    comparative ? 'Net Profit | 37,500 | 23,250' : 'Net Profit | 37,500',
  ]
}

export function balanceSheet(
  fy: number,
  { entity = COMPANY, heading = 'Balance Sheet', comparative = true, abn = '' } = {},
): Page {
  return [
    entity,
    ...(abn ? [`ABN ${abn}`] : []),
    heading,
    `As at 30 June ${fy}`,
    comparative ? `| 30 JUN ${fy} | 30 JUN ${fy - 1}` : `| 30 JUN ${fy}`,
    comparative ? 'Cash at bank | 15,000 | 12,000' : 'Cash at bank | 15,000',
    comparative ? 'Total Assets | 65,000 | 52,000' : 'Total Assets | 65,000',
    comparative ? 'Total Liabilities | 40,000 | 35,000' : 'Total Liabilities | 40,000',
    comparative ? 'Net Assets | 25,000 | 17,000' : 'Net Assets | 25,000',
  ]
}

/** A detailed P&L that runs onto a second page with no heading of its own. */
export function incomeStatementContinuation(): Page {
  return [
    'Telephone and internet | 2,400 | 2,100',
    'Insurance | 3,100 | 2,950',
    'Motor vehicle expenses | 6,250 | 5,900',
    'Total Expenses | 54,250 | 51,100',
  ]
}

export function notes(): Page {
  return [
    COMPANY,
    'Notes to the Financial Statements',
    'For the year ended 30 June 2025',
    'Note 1: Summary of Significant Accounting Policies',
    'Income statement items are recognised on an accruals basis.',
    'Balance sheet items are measured at cost.',
  ]
}

export function appropriation(fy: number): Page {
  return [
    COMPANY,
    'Appropriation Statement',
    `For the year ended 30 June ${fy}`,
    'Retained profits at the beginning | 17,000 | 10,000',
    'Dividends paid | (20,000) | (16,250)',
  ]
}

export function declaration(): Page {
  return [COMPANY, "Directors' Declaration", 'The directors declare that the financial statements present fairly.']
}

export function depreciation(): Page {
  return [COMPANY, 'Depreciation Schedule', 'For the year ended 30 June 2025', 'Plant | 4,000 | 800']
}

/** An appended Company Tax Return: a heading page, then schedules without it. */
export function taxReturn(fy: number, pages = 3): Page[] {
  const first = [
    `Company tax return ${fy}`,
    'Tax file number | 000 000 000',
    'Item 6 Calculation statement',
    'Balance sheet items | 65,000',
    'Profit and loss statement | 37,500',
  ]
  const schedule = [
    'Losses schedule',
    'Item 1 Tax losses carried forward | 0',
    'TFN | 000 000 000',
  ]
  const worksheet = [
    'Balance sheet items',
    'Total assets | 65,000',
    'Total liabilities | 40,000',
    'Trade debtors | 3,000',
  ]
  return [first, schedule, ...Array.from({ length: Math.max(0, pages - 2) }, () => worksheet)]
}

/** A one-page P&L from a separate-files trust, the way the trust's accountant prints it. */
export function trustProfitAndLoss(fy: number): Page {
  return [
    TRUSTEE_HEADING,
    `ABN ${TRUST_ABN}`,
    'Profit and Loss Statement',
    `for the year ended 30 June ${fy}`,
    `| ${fy} | ${fy - 1}`,
    'Sales | 210,000 | 190,000',
    'Cost of sales | 120,000 | 110,000',
    'Net Profit | 45,000 | 38,000',
  ]
}

export function trustBalanceSheet(fy: number): Page {
  return [
    TRUSTEE_HEADING,
    `ABN ${TRUST_ABN}`,
    'Balance Sheet',
    `As at 30 June ${fy}`,
    `| ${fy} | ${fy - 1}`,
    'Total Assets | 140,000 | 120,000',
    'Total Liabilities | 90,000 | 85,000',
    'Net Assets | 50,000 | 35,000',
  ]
}

export function currentPeriodProfitAndLoss(): Page {
  return [
    'Profit and Loss',
    COMPANY,
    'For the period 1 July 2025 to 4 May 2026',
    'Trading Income',
    'Sales | 85,432.17',
    'Total Trading Income | 85,432.17',
    'Net Profit | 12,345.67',
  ]
}

export function currentPeriodBalanceSheet(): Page {
  return [
    'Balance Sheet',
    COMPANY,
    'As at 4 May 2026',
    'Bank | 4,321.09',
    'Total Assets | 54,321.09',
    'Net Assets | 9,876.54',
  ]
}

/** One page carrying both statements — some software exports do this. */
export function onePageBoth(fy: number): Page {
  return [
    COMPANY,
    'Profit and Loss',
    `For the year ended 30 June ${fy}`,
    'Sales | 50,000',
    'Net Profit | 5,000',
    'Balance Sheet',
    `As at 30 June ${fy}`,
    'Total Assets | 20,000',
    'Net Assets | 8,000',
  ]
}

export function trustDeed(): Page[] {
  return [
    ['DEED OF SETTLEMENT', 'SAMPLE FAMILY TRUST', 'THIS DEED is made on 1 July 2010'],
    ['The Settlor pays the Settled Sum to the Trustee.', 'The Appointor may remove the Trustee.'],
    ['IN WITNESS WHEREOF the parties have executed this deed.'],
  ]
}

export function contractorLicence(): Page[] {
  return [['Contractor Licence', 'Licence number: 123456', 'Licence holder: SAMPLE TRADING PTY LTD']]
}

export function invoice(): Page[] {
  return [['TAX INVOICE', 'Invoice number INV-0042', 'Total due | 1,234.00', 'Thank you for your business']]
}

// ─── PDF builder ──────────────────────────────────────────────────────────────

const PAGE_SIZE: [number, number] = [595, 842]
const COLUMN_X = [40, 380, 480]

/** Draw the pages with pdf-lib, putting each "|" piece in its own column. */
export async function buildFinancialPdf(pages: Page[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const lines of pages) {
    const page = doc.addPage(PAGE_SIZE)
    let y = 790
    for (const line of lines) {
      line.split('|').forEach((piece, i) => {
        const text = piece.trim()
        if (text) page.drawText(text, { x: COLUMN_X[Math.min(i, 2)], y, size: 10, font })
      })
      y -= 16
    }
  }
  return doc.save()
}
