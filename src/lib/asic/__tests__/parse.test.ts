import { describe, it, expect } from 'vitest'
import { parseAsicExtract, WARNINGS } from '../parse'
import type { AsicExtract, AsicParseResult } from '../types'
import {
  JANE,
  MEI,
  NEVER_EXTRACTED,
  RAJ,
  SAMPLE,
  addresses,
  contactAddress,
  cover,
  currentExtract,
  end,
  officeholders,
  organisation,
  person,
  shares,
} from './fixtures/extract'

/**
 * The pure parser, against SYNTHETIC extract text (see fixtures/extract.ts).
 */

function parsed(lines: string[]): AsicExtract {
  const result = parseAsicExtract(lines)
  if (!result.ok) throw new Error(`expected a parse, got ${result.reason}`)
  return result.extract
}

function failure(lines: string[]): Extract<AsicParseResult, { ok: false }> {
  const result = parseAsicExtract(lines)
  if (result.ok) throw new Error('expected a failure')
  return result
}

function expectNothingUnwanted(result: unknown) {
  const text = JSON.stringify(result)
  for (const unwanted of NEVER_EXTRACTED) expect(text).not.toContain(unwanted)
}

describe('parseAsicExtract — a current extract', () => {
  it('reads one director and everything else Gabby re-types', () => {
    const extract = parsed(currentExtract([JANE], []))

    expect(extract).toEqual({
      companyName: SAMPLE.company,
      acn: SAMPLE.acn,
      abn: SAMPLE.abn,
      status: 'Registered',
      registeredOffice: SAMPLE.address,
      principalPlaceOfBusiness: SAMPLE.address,
      directors: [{ name: 'Jane Sample', dateOfBirth: '1970-03-14' }],
      extractType: 'current',
      extractedAt: SAMPLE.extractedAt,
      warnings: [],
    })
  })

  it('reads two directors, in the order ASIC lists them', () => {
    const extract = parsed(currentExtract([JANE, RAJ], []))
    expect(extract.directors).toEqual([
      { name: 'Jane Sample', dateOfBirth: '1970-03-14' },
      { name: 'Raj Example', dateOfBirth: '1981-11-02' },
    ])
  })

  it('reads three directors, apostrophes and hyphens intact', () => {
    const extract = parsed(currentExtract([JANE, RAJ, MEI], []))
    expect(extract.directors.map((d) => d.name)).toEqual([
      'Jane Sample',
      'Raj Example',
      "Mei O'Sample-Smith",
    ])
    expect(extract.directors[2].dateOfBirth).toBe('1988-02-29')
  })

  it('lists somebody who is both director and secretary once', () => {
    const extract = parsed(currentExtract([JANE], [JANE]))
    expect(extract.directors).toEqual([{ name: 'Jane Sample', dateOfBirth: '1970-03-14' }])
  })

  it('never takes a secretary who is not a director', () => {
    const extract = parsed(currentExtract([JANE], [RAJ]))
    expect(extract.directors.map((d) => d.name)).toEqual(['Jane Sample'])
  })

  it('de-duplicates a director listed twice under Director', () => {
    const extract = parsed(currentExtract([JANE, JANE], []))
    expect(extract.directors).toHaveLength(1)
  })

  it('keeps two directors who share a name but not a date of birth', () => {
    const extract = parsed(
      currentExtract([JANE, { name: 'JANE SAMPLE', born: '01/01/1999, BIRTHVILLE, VIC' }], []),
    )
    expect(extract.directors.map((d) => d.dateOfBirth)).toEqual(['1970-03-14', '1999-01-01'])
  })
})

describe('parseAsicExtract — layout quirks', () => {
  it('strips document numbers from name lines, digits or letters-and-digits', () => {
    const extract = parsed(
      currentExtract(
        [
          { name: 'JANE SAMPLE', docNumber: '7EBH40554' },
          { name: 'RAJ EXAMPLE', docNumber: '032144978', born: '02/11/1981, TESTVILLE, NSW' },
        ],
        [],
      ),
    )
    // "Name: SAMPLE TRADING PTY LTD 032144978" in Organisation Details, too.
    expect(extract.companyName).toBe(SAMPLE.company)
    expect(extract.directors.map((d) => d.name)).toEqual(['Jane Sample', 'Raj Example'])
  })

  it("does not mistake a name's last word for a document number", () => {
    const extract = parsed(currentExtract([{ name: 'JANE SAMPLE', docNumber: null }], []))
    expect(extract.directors[0].name).toBe('Jane Sample')
  })

  it('strips a document number printed on the last address line', () => {
    const lines = [
      ...cover(),
      ...organisation(),
      'Address Details',
      'Current',
      'Registered address: Unit 1, 10 Sample Road, NORTH',
      'MELBOURNE VIC 3051 7EBH40554',
      'Start date: 01/07/2015',
      'Principal Place Of Business address: Level 2, 20 Example Street, SAMPLETON',
      'NSW 2000 7EBH40555',
      'Start date: 01/07/2015',
      ...officeholders([JANE]),
      ...end(),
    ]
    const extract = parsed(lines)
    expect(extract.registeredOffice).toBe(SAMPLE.address)
    expect(extract.principalPlaceOfBusiness).toBe('Level 2, 20 Example Street, Sampleton NSW 2000')
  })

  it('joins a wrapped label and a wrapped address', () => {
    const lines = [
      ...cover(),
      ...organisation(),
      'Address Details',
      'Current',
      'Registered',
      'address: Shop 3, 7 Demo Parade,',
      'SOUTH',
      'YARRA VIC 3141',
      '7EBH40554',
      'Start date: 01/07/2015',
      'Principal Place',
      'Of Business',
      'address: PO BOX 12, GPO SAMPLE',
      'VIC 3000',
      '7EBH40554',
      'Start date: 01/07/2015',
      ...officeholders([JANE]),
      ...end(),
    ]
    const extract = parsed(lines)
    expect(extract.registeredOffice).toBe('Shop 3, 7 Demo Parade, South Yarra VIC 3141')
    expect(extract.principalPlaceOfBusiness).toBe('PO Box 12, GPO Sample VIC 3000')
  })

  it('joins a director name that wraps onto the next line', () => {
    const lines = [
      ...cover(),
      ...organisation(),
      ...addresses(),
      'Officeholders and Other Roles',
      'Director',
      'Name: JANE ELIZABETH',
      'SAMPLE-LONGNAME 7EBH40554',
      'Address: Not available in this ASIC extract',
      'Born: 14/03/1970, BIRTHVILLE, VIC',
      'Appointment date: 01/07/2015',
      ...end(),
    ]
    expect(parsed(lines).directors).toEqual([
      { name: 'Jane Elizabeth Sample-Longname', dateOfBirth: '1970-03-14' },
    ])
  })

  it('stores both addresses when they are identical', () => {
    const extract = parsed(currentExtract())
    expect(extract.registeredOffice).toBe(SAMPLE.address)
    expect(extract.principalPlaceOfBusiness).toBe(SAMPLE.address)
  })

  it('keeps them apart when they differ', () => {
    const lines = [
      ...cover(),
      ...organisation(),
      ...addresses({ principal: ['LOT 4, 1 EXAMPLE HIGHWAY, DEMOVILLE', 'QLD 4000'] }),
      ...officeholders([JANE]),
      ...end(),
    ]
    const extract = parsed(lines)
    expect(extract.registeredOffice).toBe(SAMPLE.address)
    expect(extract.principalPlaceOfBusiness).toBe('Lot 4, 1 Example Highway, Demoville QLD 4000')
  })

  it('ignores page furniture and page headers that repeat the cover', () => {
    const lines = [
      ...cover(),
      ...organisation(),
      ...addresses(),
      'Officeholders and Other Roles',
      'Director',
      ...[
        'Name: JANE SAMPLE 7EBH40554',
        'Address: Not available in this ASIC extract',
      ],
      // Page break mid-block: footer, then the next page's header.
      'Page 2 of 3',
      'Current Company Extract',
      `Name: ${SAMPLE.companyRaw}`,
      `ACN: ${SAMPLE.acnSpaced}`,
      'Born: 14/03/1970, BIRTHVILLE, VIC',
      'Appointment date: 01/07/2015',
      ...end(),
    ]
    expect(parsed(lines).directors).toEqual([{ name: 'Jane Sample', dateOfBirth: '1970-03-14' }])
  })

  it('keeps only the date from "Born:", never the place or country', () => {
    const extract = parsed(currentExtract([JANE, RAJ, MEI], [JANE]))
    expectNothingUnwanted(extract)
  })

  it('never reads the contact address or the shareholders', () => {
    const extract = parsed(currentExtract([JANE, RAJ]))
    expectNothingUnwanted(extract)
    expect(extract.directors.map((d) => d.name)).not.toContain('Holly Shareholder')
  })

  it('stops at the shares section even with no Members heading before a Name', () => {
    const lines = [
      ...cover(),
      ...organisation(),
      ...addresses(),
      ...officeholders([JANE]),
      'Share Information',
      'Name: HOLLY SHAREHOLDER 5CD678901',
      'Born: 01/01/1960, SECRETVILLE, VIC',
      ...end(),
    ]
    const extract = parsed(lines)
    expect(extract.directors).toHaveLength(1)
    expectNothingUnwanted(extract)
  })
})

describe('parseAsicExtract — dates of birth', () => {
  it('leaves the date blank and warns, without naming anyone, when "Born:" is missing', () => {
    const extract = parsed(currentExtract([JANE, { ...RAJ, born: null }], []))
    expect(extract.directors).toEqual([
      { name: 'Jane Sample', dateOfBirth: '1970-03-14' },
      { name: 'Raj Example', dateOfBirth: null },
    ])
    expect(extract.warnings).toEqual([WARNINGS.missingDob(1)])
    expect(extract.warnings.join(' ')).not.toMatch(/raj|example/i)
  })

  it('counts every director without one', () => {
    const extract = parsed(currentExtract([{ ...JANE, born: null }, { ...RAJ, born: null }], []))
    expect(extract.warnings).toContain(WARNINGS.missingDob(2))
  })

  it('takes a year-only date of birth, as ASIC may print from July 2027', () => {
    const extract = parsed(currentExtract([{ ...JANE, born: '1970, BIRTHVILLE, VIC' }], []))
    expect(extract.directors[0].dateOfBirth).toBe('1970')
  })

  it('takes a month-and-year date of birth', () => {
    const extract = parsed(currentExtract([{ ...JANE, born: '03/1970, BIRTHVILLE, VIC' }], []))
    expect(extract.directors[0].dateOfBirth).toBe('1970-03')
  })

  it('treats an impossible date as missing rather than guessing', () => {
    const extract = parsed(currentExtract([{ ...JANE, born: '31/02/1970, BIRTHVILLE, VIC' }], []))
    expect(extract.directors[0].dateOfBirth).toBeNull()
  })
})

describe('parseAsicExtract — a Current & Historical extract', () => {
  const historical = [
    ...cover('Current & Historical Company Extract'),
    'Organisation Details',
    'Current Organisation Details',
    `Name: ${SAMPLE.companyRaw} 032144978`,
    `ACN: ${SAMPLE.acnSpaced}`,
    `ABN: ${SAMPLE.abn}`,
    'Status: Registered',
    'Previous Organisation Details',
    'Name: OLD SAMPLE NAME PTY LTD 012345678',
    'Start date: 01/07/2015',
    'End date: 01/01/2018',
    'Address Details',
    'Current',
    'Registered address: Unit 1, 10 Sample Road, NORTH',
    'MELBOURNE VIC 3051',
    '7EBH40554',
    'Start date: 01/01/2018',
    'Principal Place Of',
    'Business address: Unit 1, 10 Sample Road, NORTH',
    'MELBOURNE VIC 3051',
    '7EBH40554',
    'Start date: 01/01/2018',
    'Previous',
    'Registered address: 99 Old Street, OLDTOWN NSW 2000',
    '1AB000001',
    'Start date: 01/07/2015',
    'End date: 01/01/2018',
    ...contactAddress(),
    'Officeholders and Other Roles',
    'Director',
    ...person(JANE),
    // Ceased, but printed under the current heading: the cease date decides.
    ...person({ name: 'CEASED UNDERCURRENT', born: '05/05/1955, BIRTHVILLE, VIC', ceased: true }),
    'Previous Officeholders',
    'Director',
    ...person({ name: 'FORMER DIRECTORPERSON', born: '06/06/1966, BIRTHVILLE, VIC', ceased: true }),
    ...shares(),
    ...end(),
  ]

  it('takes current data only, and says so', () => {
    const extract = parsed(historical)
    expect(extract.extractType).toBe('current_and_historical')
    expect(extract.companyName).toBe(SAMPLE.company)
    expect(extract.registeredOffice).toBe(SAMPLE.address)
    expect(extract.directors).toEqual([{ name: 'Jane Sample', dateOfBirth: '1970-03-14' }])
    expect(extract.warnings).toEqual([WARNINGS.historical])
    expect(JSON.stringify(extract)).not.toMatch(/old sample|oldtown|ceased|former/i)
    expectNothingUnwanted(extract)
  })
})

describe('parseAsicExtract — rejections', () => {
  it('rejects a PDF with no text layer', () => {
    expect(failure([]).reason).toBe('no_text')
    expect(failure(['', '  ', 'Page 1 of 1']).reason).toBe('no_text')
    expect(failure([]).message).toBe('This PDF has no readable text. Fill the fields in by hand.')
  })

  it('rejects a document that is not an ASIC extract', () => {
    const invoice = [
      'TAX INVOICE',
      'Sample Supplies Pty Ltd',
      'ABN: 11 123 456 780',
      'Invoice number: INV-0042',
      'Name: Some Customer',
      'Total due: $1,234.00',
    ]
    expect(failure(invoice).reason).toBe('not_asic_extract')
  })

  it('rejects an extract title with none of the sections behind it', () => {
    expect(failure([...cover(), 'Nothing else here at all, just prose.']).reason).toBe(
      'not_asic_extract',
    )
  })

  it('rejects an ACN that fails its check digit', () => {
    const lines = [
      ...cover(),
      ...organisation({ acn: '123 456 789', abn: null }),
      ...officeholders([JANE]),
      ...end(),
    ]
    const result = failure(lines)
    expect(result.reason).toBe('acn_invalid')
    expect(result.message).toMatch(/ACN/)
  })

  it('rejects an ABN that fails its check digit', () => {
    const lines = [...cover(), ...organisation({ abn: '11123456781' }), ...officeholders([JANE]), ...end()]
    expect(failure(lines).reason).toBe('abn_invalid')
  })

  it('rejects an ABN whose last nine digits are not the ACN', () => {
    // Both valid on their own; they belong to different companies.
    const lines = [...cover(), ...organisation({ abn: SAMPLE.otherAbn }), ...officeholders([JANE]), ...end()]
    const result = failure(lines)
    expect(result.reason).toBe('abn_acn_mismatch')
    expect(result.message).toMatch(/ABN/)
  })

  it('accepts a company with no ABN, and says so', () => {
    const lines = [
      ...cover(),
      ...organisation({ abn: null }),
      ...addresses(),
      ...officeholders([JANE]),
      ...end(),
    ]
    const extract = parsed(lines)
    expect(extract.abn).toBeNull()
    expect(extract.warnings).toEqual([WARNINGS.noAbn])
  })
})

describe('parseAsicExtract — partial extracts', () => {
  it('warns when there are no current directors', () => {
    const lines = [...cover(), ...organisation(), ...addresses(), 'Officeholders and Other Roles', ...end()]
    const extract = parsed(lines)
    expect(extract.directors).toEqual([])
    expect(extract.warnings).toContain(WARNINGS.noDirectors)
  })

  it('warns about a missing address rather than inventing one', () => {
    const lines = [
      ...cover(),
      ...organisation(),
      ...addresses({ principal: null }),
      ...officeholders([JANE]),
      ...end(),
    ]
    const extract = parsed(lines)
    expect(extract.principalPlaceOfBusiness).toBeNull()
    expect(extract.warnings).toEqual([WARNINGS.noPrincipalPlace])
  })

  it('falls back to the cover for the name and ACN', () => {
    const lines = [
      ...cover(),
      'Organisation Details',
      'Status: Registered',
      ...addresses(),
      ...officeholders([JANE]),
      ...end(),
    ]
    const extract = parsed(lines)
    expect(extract.companyName).toBe(SAMPLE.company)
    expect(extract.acn).toBe(SAMPLE.acn)
  })

  it('warns when the cover date cannot be read', () => {
    const lines = currentExtract([JANE], []).map((line) =>
      line.startsWith('Date/Time:') ? 'Date/Time: sometime' : line,
    )
    const extract = parsed(lines)
    expect(extract.extractedAt).toBeNull()
    expect(extract.warnings).toContain(WARNINGS.noDate)
  })
})
