/**
 * SYNTHETIC ASIC extract text. Every name, number, date and address here is
 * invented. Never paste a real extract into a fixture: they carry real
 * people's dates of birth and residential addresses.
 *
 * The layout copies what extractText.ts produces from a real extract,
 * including its quirks: document numbers on the same line as values, labels
 * and addresses wrapped across lines, page furniture and repeated page headers.
 *
 * ACN 123 456 780 / ABN 11 123 456 780 and ACN 000 000 019 / ABN 89 000 000 019
 * pass their check digits; neither belongs to any company we deal with.
 */

export const SAMPLE = {
  companyRaw: 'SAMPLE TRADING PTY LTD',
  company: 'Sample Trading Pty Ltd',
  acn: '123456780',
  acnSpaced: '123 456 780',
  abn: '11123456780',
  otherAcn: '000000019',
  otherAbn: '89000000019',
  extractedAt: '2026-09-23T14:07:38+10:00',
  address: 'Unit 1, 10 Sample Road, North Melbourne VIC 3051',
} as const

export interface PersonBlock {
  name: string
  /** Printed on the Name line, as ASIC does. null prints none. */
  docNumber?: string | null
  /** The full "Born:" value, place and country included. null omits the line. */
  born?: string | null
  ceased?: boolean
}

export function person({
  name,
  docNumber = '7EBH40554',
  born = '14/03/1970, BIRTHVILLE, VIC',
  ceased = false,
}: PersonBlock): string[] {
  return [
    docNumber ? `Name: ${name} ${docNumber}` : `Name: ${name}`,
    'Address: Not available in this ASIC extract',
    ...(born === null ? [] : [`Born: ${born}`]),
    'Appointment date: 01/07/2015',
    ...(ceased ? ['Cease date: 30/06/2020'] : []),
  ]
}

export const JANE: PersonBlock = { name: 'JANE SAMPLE' }
export const RAJ: PersonBlock = { name: 'RAJ EXAMPLE', docNumber: '1AB234567', born: '02/11/1981, TESTVILLE, NSW' }
export const MEI: PersonBlock = { name: "MEI O'SAMPLE-SMITH", docNumber: '032144978', born: '29/02/1988, DEMOTOWN, QLD' }

export function cover(title = 'Current Company Extract'): string[] {
  return [
    title,
    `Name: ${SAMPLE.companyRaw}`,
    `ACN: ${SAMPLE.acnSpaced}`,
    'Date/Time: 23 September 2026 AEST 02:07:38 PM',
    'This extract contains information derived from the Australian Securities and',
    "Investments Commission's (ASIC) database under section 1274A of the Corporations Act 2001.",
    'Page 1 of 3',
  ]
}

export function organisation({
  acn = SAMPLE.acnSpaced as string,
  abn = SAMPLE.abn as string | null,
} = {}): string[] {
  return [
    'Organisation Details',
    'Current Organisation Details',
    `Name: ${SAMPLE.companyRaw} 032144978`,
    `ACN: ${acn}`,
    ...(abn === null ? [] : [`ABN: ${abn}`]),
    'Registered in: Victoria',
    'Registration date: 01/07/2015',
    'Next review date: 01/07/2027',
    'Status: Registered',
    'Company type: Australian Proprietary Company',
    'Class: Limited By Shares',
    'Subclass: Proprietary Company',
  ]
}

/** Both addresses wrapped, with the document number on a line of its own. */
export function addresses({
  registered = ['Unit 1, 10 Sample Road, NORTH', 'MELBOURNE VIC 3051'],
  principal = ['Unit 1, 10 Sample Road, NORTH', 'MELBOURNE VIC 3051'],
}: { registered?: string[] | null; principal?: string[] | null } = {}): string[] {
  const [firstRegistered, ...moreRegistered] = registered ?? []
  const [firstPrincipal, ...morePrincipal] = principal ?? []
  return [
    'Address Details',
    'Current',
    ...(registered
      ? [
          `Registered address: ${firstRegistered}`,
          ...moreRegistered,
          '7EBH40554',
          'Start date: 01/07/2015',
        ]
      : []),
    ...(principal
      ? [
          // The label itself wraps: "Principal Place Of" / "Business address: …".
          'Principal Place Of',
          `Business address: ${firstPrincipal}`,
          ...morePrincipal,
          '7EBH40554',
          'Start date: 01/07/2015',
        ]
      : []),
  ]
}

/** ASIC's own postal address for the company. Never one of the wanted fields. */
export function contactAddress(): string[] {
  return [
    'Contact Address',
    "Section 146A of the Corporations Act 2001 states 'A contact address is the address to which",
    "communications and notices are sent from ASIC to the company'.",
    'Current',
    'Address: PO BOX 999, CONTACTVILLE VIC 3999',
    'Start date: 01/07/2015',
  ]
}

export function officeholders(
  directors: PersonBlock[],
  secretaries: PersonBlock[] = [],
): string[] {
  return [
    'Officeholders and Other Roles',
    'Director',
    ...directors.flatMap(person),
    ...(secretaries.length ? ['Secretary', ...secretaries.flatMap(person)] : []),
  ]
}

/** Shareholders with residential addresses. Must never reach a result. */
export function shares(): string[] {
  return [
    'Share Information',
    'Share Structure',
    'Class Description Number issued Total amount paid Total amount due and payable',
    'ORD ORDINARY 100 100.00 0.00',
    'Members',
    'Name: HOLLY SHAREHOLDER 5CD678901',
    'Address: 42 Private Lane, SECRETVILLE VIC 3888',
    'Class Number held Beneficially held Paid Document number',
    'ORD 100 yes FULLY 5CD678901',
  ]
}

export function end(pages = 3): string[] {
  return [`***End of Extract of ${pages} Pages***`]
}

/** A whole current extract with one director who is also the secretary. */
export function currentExtract(directors: PersonBlock[] = [JANE], secretaries = [JANE]): string[] {
  return [
    ...cover(),
    ...organisation(),
    ...addresses(),
    ...contactAddress(),
    ...officeholders(directors, secretaries),
    ...shares(),
    ...end(),
  ]
}

/** Strings from the fixture that must never appear in any parse result. */
export const NEVER_EXTRACTED = [
  'BIRTHVILLE',
  'Birthville',
  'TESTVILLE',
  'DEMOTOWN',
  'CONTACTVILLE',
  'Contactville',
  'HOLLY',
  'Holly',
  'SHAREHOLDER',
  'Private Lane',
  'SECRETVILLE',
  'Secretville',
  '01/07/2015',
  '2015-07-01',
]
