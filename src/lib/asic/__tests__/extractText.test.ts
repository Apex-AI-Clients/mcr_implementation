// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { extractPdfLines, groupIntoLines, PdfUnreadableError } from '../extractText'
import { parseAsicExtract } from '../parse'
import { JANE, MEI, NEVER_EXTRACTED, RAJ, SAMPLE, currentExtract } from './fixtures/extract'
import { buildExtractPdf, buildImageOnlyPdf, buildInvoicePdf } from './fixtures/pdf'
import { realLayoutExtract } from './fixtures/realLayout'
import type { StructuredTextItem } from 'unpdf'

/**
 * PDF -> text lines -> parse, end to end, on SYNTHETIC PDFs built with pdf-lib.
 *
 * fetch is replaced with one that fails the test: text extraction must happen
 * entirely in memory, with no network call of any kind.
 */

const fetchSpy = vi.fn(() => {
  throw new Error('extractText must not make network calls')
})

beforeEach(() => {
  fetchSpy.mockClear()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

const HEADER = ['Current Company Extract', `Name: ${SAMPLE.companyRaw}`, `ACN: ${SAMPLE.acnSpaced}`]

describe('extractPdfLines + parseAsicExtract', () => {
  it('reads a multi-page synthetic extract laid out in ASIC columns', async () => {
    const pdf = await buildExtractPdf(currentExtract([JANE, RAJ, MEI], [JANE]), {
      linesPerPage: 30,
      header: HEADER,
    })
    const { pageCount, lines } = await extractPdfLines(pdf)

    expect(pageCount).toBeGreaterThan(1)
    // The three columns come back as the one line the parser expects.
    expect(lines).toContain('Name: JANE SAMPLE 7EBH40554')
    expect(lines).toContain('Principal Place Of')

    const result = parseAsicExtract(lines)
    if (!result.ok) throw new Error(`expected a parse, got ${result.reason}`)
    expect(result.extract).toMatchObject({
      companyName: SAMPLE.company,
      acn: SAMPLE.acn,
      abn: SAMPLE.abn,
      registeredOffice: SAMPLE.address,
      principalPlaceOfBusiness: SAMPLE.address,
      extractType: 'current',
      extractedAt: SAMPLE.extractedAt,
      directors: [
        { name: 'Jane Sample', dateOfBirth: '1970-03-14' },
        { name: 'Raj Example', dateOfBirth: '1981-11-02' },
        { name: "Mei O'Sample-Smith", dateOfBirth: '1988-02-29' },
      ],
    })
    const text = JSON.stringify(result)
    for (const unwanted of NEVER_EXTRACTED) expect(text).not.toContain(unwanted)
  })

  it('reads a PDF laid out the way a real extract is', async () => {
    // Headings with "Document Number" in the right-hand column, the document
    // number beside an address's first line, and the principal place label
    // split around its address — drawn as separate pieces of text per column.
    const pdf = await buildExtractPdf(realLayoutExtract({ directors: [JANE, RAJ] }), {
      linesPerPage: 200,
    })
    const { lines } = await extractPdfLines(pdf)

    expect(lines).toContain('Organisation Details Document Number')
    expect(lines).toContain('Principal Place Of Unit 1, 10 Sample Road, NORTH 7EBH40554')
    expect(lines).toContain('Business address:')

    const result = parseAsicExtract(lines)
    if (!result.ok) throw new Error(`expected a parse, got ${result.reason}`)
    expect(result.extract).toMatchObject({
      registeredOffice: SAMPLE.address,
      principalPlaceOfBusiness: SAMPLE.address,
      directors: [
        { name: 'Jane Sample', dateOfBirth: '1970-03-14' },
        { name: 'Raj Example', dateOfBirth: '1981-11-02' },
      ],
      warnings: [],
    })
  })

  it('finds no text in an image-only PDF', async () => {
    const { lines } = await extractPdfLines(await buildImageOnlyPdf())
    expect(lines).toEqual([])
    const result = parseAsicExtract(lines)
    expect(result).toMatchObject({
      ok: false,
      reason: 'no_text',
      message: 'This PDF has no readable text. Fill the fields in by hand.',
    })
  })

  it('rejects a PDF that is not an ASIC extract', async () => {
    const { lines } = await extractPdfLines(await buildInvoicePdf())
    expect(parseAsicExtract(lines)).toMatchObject({ ok: false, reason: 'not_asic_extract' })
  })

  it('throws PdfUnreadableError for bytes that are not a PDF', async () => {
    const junk = new TextEncoder().encode('%PDF-1.7\nthis is not really a pdf')
    await expect(extractPdfLines(junk)).rejects.toBeInstanceOf(PdfUnreadableError)
  })

  it('does not detach the caller\'s buffer', async () => {
    const pdf = await buildExtractPdf(currentExtract())
    const length = pdf.byteLength
    await extractPdfLines(pdf)
    expect(pdf.byteLength).toBe(length)
  })
})

describe('groupIntoLines', () => {
  const item = (str: string, x: number, y: number, width = str.length * 5): StructuredTextItem => ({
    str,
    x,
    y,
    width,
    height: 9,
    fontSize: 9,
    fontFamily: '',
    dir: 'ltr',
    hasEOL: false,
  })

  it('orders lines top to bottom and items left to right', () => {
    expect(
      groupIntoLines([item('second', 40, 700), item('b', 200, 714), item('a', 40, 714)]),
    ).toEqual(['a b', 'second'])
  })

  it('treats baselines within a point or two as one line', () => {
    expect(groupIntoLines([item('Name:', 40, 700), item('JANE', 200, 701.2)])).toEqual([
      'Name: JANE',
    ])
  })

  it('joins pieces of one word that touch without adding a space', () => {
    expect(groupIntoLines([item('SAM', 40, 700, 15), item('PLE', 55, 700)])).toEqual(['SAMPLE'])
  })

  it('drops empty items', () => {
    expect(groupIntoLines([item('', 40, 700), item('  ', 60, 700), item('x', 80, 690)])).toEqual([
      'x',
    ])
  })
})
