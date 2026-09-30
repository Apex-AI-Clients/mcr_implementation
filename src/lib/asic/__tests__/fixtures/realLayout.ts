import { SAMPLE, person, type PersonBlock, JANE } from './extract'

/**
 * SYNTHETIC extract text in the layout a real ASIC Current Company Extract
 * actually produces once extractText.ts has grouped it into lines. The
 * structure was copied line for line from a real extract; every value is
 * invented. Never paste real extract text here.
 *
 * What differs from the simpler layout in extract.ts, and broke the first
 * version of the parser against a real file:
 *
 *   - Section headings share their line with a column header:
 *     "Organisation Details Document Number".
 *   - An address's document number is on its FIRST line; the address carries on
 *     underneath it.
 *   - The "Principal Place Of / Business address:" label is split AROUND the
 *     address: its first half shares a line with the address's first line, and
 *     its second half comes after the address's last line.
 *   - Every page has a header (the title with the company name, then "ACN …"
 *     with no colon) and a footer (the date and time, then the page number).
 *   - The first page header comes before the first section, straight after the
 *     cover blurb.
 */

const FOOTER = (page: number) => `23 September 2026 AEST 02:07:38 PM ${page}`
const HEADER = [`Current Company Extract ${SAMPLE.companyRaw}`, `ACN ${SAMPLE.acnSpaced}`]

export interface RealLayoutOptions {
  directors?: PersonBlock[]
  secretaries?: PersonBlock[]
  /** Where page 1 ends, to land a page break in different places. */
  pageBreakAfter?: 'officeholders' | 'first-director-name' | 'registered-address-first-line'
  registered?: string[]
  principal?: string[]
}

export function realLayoutExtract({
  directors = [JANE],
  secretaries = [JANE],
  pageBreakAfter = 'officeholders',
  registered = ['Unit 1, 10 Sample Road, NORTH', 'MELBOURNE VIC 3051'],
  principal = ['Unit 1, 10 Sample Road, NORTH', 'MELBOURNE VIC 3051'],
}: RealLayoutOptions = {}): string[] {
  const pageBreak = [FOOTER(1), ...HEADER]
  const [registeredFirst, ...registeredRest] = registered
  const [principalFirst, ...principalRest] = principal

  const directorBlocks = directors.flatMap((director, index) => {
    const block = person(director)
    // A page break straight after the first director's Name line.
    if (index === 0 && pageBreakAfter === 'first-director-name') {
      return [block[0], ...pageBreak, ...block.slice(1)]
    }
    return block
  })

  return [
    // Cover
    'Current Company Extract',
    `Name: ${SAMPLE.companyRaw}`,
    `ACN: ${SAMPLE.acnSpaced}`,
    'Date/Time: 23 September 2026 AEST 02:07:38 PM',
    'This extract contains information derived from the Australian Securities and',
    "Investments Commission's (ASIC) database under section 1274A of the",
    'Corporations Act 2001.',
    'Please advise ASIC of any error or omission which you may identify.',
    // Page 1 header
    ...HEADER,
    'Organisation Details Document Number',
    'Current Organisation Details',
    `Name: ${SAMPLE.companyRaw} 032144978`,
    `ACN: ${SAMPLE.acnSpaced}`,
    `ABN: ${SAMPLE.abn}`,
    'Registered in: Victoria',
    'Registration date: 01/07/2015',
    'Next review date: 01/07/2027',
    'Name start date: 01/07/2015',
    'Status: Registered',
    'Company type: Australian Proprietary Company',
    'Class: Limited By Shares',
    'Subclass: Proprietary Company',
    'Address Details Document Number',
    'Current',
    // The document number is beside the address's first line.
    `Registered address: ${registeredFirst} 7EBH40554`,
    ...(pageBreakAfter === 'registered-address-first-line' ? pageBreak : []),
    ...registeredRest,
    'Start date: 01/07/2015',
    // The label is split around the address.
    `Principal Place Of ${principalFirst} 7EBH40554`,
    ...principalRest,
    'Business address:',
    'Start date: 01/07/2015',
    'Contact Address',
    "Section 146A of the Corporations Act 2001 states 'A contact address is the address to which communications",
    "and notices are sent from ASIC to the company'.",
    'Current',
    'Address: PO BOX 999, CONTACTVILLE VIC 3999',
    'Start date: 01/07/2015',
    'Officeholders and Other Roles Document Number',
    'Director',
    ...directorBlocks,
    ...(secretaries.length ? ['Secretary', ...secretaries.flatMap(person)] : []),
    'Share Information',
    ...(pageBreakAfter === 'officeholders' ? pageBreak : []),
    'Share Structure',
    'Class Description Number Total amount Total amount Document',
    'issued paid unpaid number',
    'ORD ORDINARY 10 10.00 0.00 5CD678901',
    'Members',
    'Note: For each class of shares issued by a proprietary company, ASIC records the details of the top twenty',
    'members of the class (based on shareholdings). The details of any other members holding the same number of',
    'shares as the twentieth ranked member will also be recorded by ASIC on the database.',
    // No document number on a member's name line.
    'Name: HOLLY SHAREHOLDER',
    'Address: 42 Private Lane, SECRETVILLE VIC 3888',
    'Class Number held Beneficially held Paid Document number',
    'ORD 10 yes FULLY 5CD678901',
    '***End of Extract of 2 Pages***',
    FOOTER(2),
  ]
}
