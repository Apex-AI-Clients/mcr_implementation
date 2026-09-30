import { describe, it, expect } from 'vitest'
import { parseAsicExtract } from '../parse'
import type { AsicExtract } from '../types'
import { JANE, MEI, NEVER_EXTRACTED, RAJ, SAMPLE } from './fixtures/extract'
import { realLayoutExtract, type RealLayoutOptions } from './fixtures/realLayout'

/**
 * The parser against the layout a real extract actually has (see
 * fixtures/realLayout.ts). Regression tests: the first real upload was refused
 * as "not an ASIC extract" because none of these quirks were in the fixtures.
 * SYNTHETIC data throughout.
 */

function parsed(options?: RealLayoutOptions): AsicExtract {
  const result = parseAsicExtract(realLayoutExtract(options))
  if (!result.ok) throw new Error(`expected a parse, got ${result.reason}`)
  return result.extract
}

describe('parseAsicExtract — the real layout', () => {
  it('reads an extract whose section headings carry "Document Number"', () => {
    expect(parsed()).toEqual({
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

  it('keeps the rest of an address whose document number is on its first line', () => {
    // "…, NORTH 7EBH40554" / "MELBOURNE VIC 3051": stopping at the document
    // number would lose the suburb, state and postcode.
    const extract = parsed({
      registered: ['Level 12, 100 Example Street, SAMPLE', 'HEIGHTS NSW 2000'],
    })
    expect(extract.registeredOffice).toBe('Level 12, 100 Example Street, Sample Heights NSW 2000')
    expect(extract.registeredOffice).not.toContain('7EBH40554')
  })

  it('reads a principal place of business whose label is split around the address', () => {
    const extract = parsed({
      principal: ['Shop 3, 7 Demo Parade, SOUTH', 'YARRA VIC 3141'],
    })
    expect(extract.principalPlaceOfBusiness).toBe('Shop 3, 7 Demo Parade, South Yarra VIC 3141')
    expect(extract.registeredOffice).toBe(SAMPLE.address)
  })

  it('reads addresses that fit on one line, and ones that run to three', () => {
    const extract = parsed({
      registered: ['1 Short Street, SAMPLETON VIC 3000'],
      principal: ['Unit 22, Building C,', '400-410 Very Long Example Boulevard,', 'SAMPLE HEIGHTS QLD 4000'],
    })
    expect(extract.registeredOffice).toBe('1 Short Street, Sampleton VIC 3000')
    expect(extract.principalPlaceOfBusiness).toBe(
      'Unit 22, Building C, 400-410 Very Long Example Boulevard, Sample Heights QLD 4000',
    )
  })

  it('reads several directors, and only directors', () => {
    const extract = parsed({ directors: [JANE, RAJ, MEI], secretaries: [JANE, RAJ] })
    expect(extract.directors).toEqual([
      { name: 'Jane Sample', dateOfBirth: '1970-03-14' },
      { name: 'Raj Example', dateOfBirth: '1981-11-02' },
      { name: "Mei O'Sample-Smith", dateOfBirth: '1988-02-29' },
    ])
  })

  it('ignores the page header and footer wherever the page breaks', () => {
    const breaks: RealLayoutOptions['pageBreakAfter'][] = [
      'officeholders',
      'first-director-name',
      'registered-address-first-line',
    ]
    for (const pageBreakAfter of breaks) {
      const extract = parsed({ pageBreakAfter, directors: [JANE, RAJ] })
      expect(extract.registeredOffice).toBe(SAMPLE.address)
      expect(extract.directors).toEqual([
        { name: 'Jane Sample', dateOfBirth: '1970-03-14' },
        { name: 'Raj Example', dateOfBirth: '1981-11-02' },
      ])
      expect(extract.warnings).toEqual([])
    }
  })

  it('never reads the contact address, the shareholders or a place of birth', () => {
    const text = JSON.stringify(parsed({ directors: [JANE, RAJ, MEI] }))
    for (const unwanted of NEVER_EXTRACTED) expect(text).not.toContain(unwanted)
  })

  it('still rejects a different kind of document that happens to say "Document Number"', () => {
    const result = parseAsicExtract([
      'Delivery Docket',
      'Order Details Document Number',
      'Name: Some Customer 123456789',
      'Address Details Document Number',
      'Registered address: 1 Sample Street',
    ])
    expect(result).toMatchObject({ ok: false, reason: 'not_asic_extract' })
  })
})
