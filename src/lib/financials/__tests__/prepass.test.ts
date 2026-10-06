// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { PDFDocument } from 'pdf-lib'
import { MAX_FINANCIALS_PAGES, isEncryptedPdf, runFinancialsPrepass } from '../prepass'
import { buildImageOnlyPdf } from '@/lib/asic/__tests__/fixtures/pdf'
import {
  balanceSheet,
  buildFinancialPdf,
  coverLetter,
  incomeStatement,
  notes,
  taxReturn,
  trustProfitAndLoss,
} from './fixtures/statementPages'

/**
 * The pre-pass end to end: PDF bytes -> pdf.js text -> classification, on
 * SYNTHETIC PDFs.
 *
 * The two encrypted fixtures in fixtures/pdf/ hold the same synthetic text as
 * buildFinancialPdf([...taxReturn(2025, 3), coverLetter(), incomeStatement(2025),
 * balanceSheet(2025), notes()]), encrypted with pypdf (pdf-lib cannot encrypt):
 *   signed-owner-password.pdf   AES-256, owner password only, copying allowed —
 *                               how signed accountant PDFs arrive
 *   needs-open-password.pdf     AES-256 with an open password
 *
 * fetch is replaced with one that fails the test: the pre-pass must make no
 * network call of any kind.
 */

const FIXTURES = path.join(__dirname, 'fixtures', 'pdf')
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)))

const fetchSpy = vi.fn(() => {
  throw new Error('the pre-pass must not make network calls')
})

beforeEach(() => {
  fetchSpy.mockClear()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

describe('runFinancialsPrepass', () => {
  it('reads a combined PDF and finds its statement pages', async () => {
    const pdf = await buildFinancialPdf([coverLetter(), incomeStatement(2025), balanceSheet(2025), notes(), ...taxReturn(2025, 4)])
    const result = await runFinancialsPrepass(pdf)

    expect(result).toMatchObject({ encrypted: false, pageCount: 8, failure: null })
    expect(result.classification.kind).toBe('combined')
    expect(result.classification.statementPages).toEqual({ income_statement: [2], balance_sheet: [3] })
    expect(result.classification.pages.slice(4).every((p) => p.class === 'tax_return')).toBe(true)
    expect(result.classification.headingYears).toEqual([2025])
    expect(result.classification.comparativeYears).toEqual([2024])
  })

  it('puts a label and its figures, drawn in separate columns, back on one line', async () => {
    const pdf = await buildFinancialPdf([trustProfitAndLoss(2025)])
    const result = await runFinancialsPrepass(pdf)
    expect(result.classification.kind).toBe('pnl_only')
    expect(result.classification.entity?.abns).toEqual(['33114847696'])
  })

  it('reads a signed PDF encrypted with an owner password, tax return first', async () => {
    const result = await runFinancialsPrepass(fixture('signed-owner-password.pdf'))

    expect(result.encrypted).toBe(true)
    expect(result.failure).toBeNull()
    expect(result.classification.kind).toBe('combined')
    expect(result.classification.statementPages).toEqual({ income_statement: [5], balance_sheet: [6] })
    expect(result.classification.pages.slice(0, 3).map((p) => p.class)).toEqual([
      'tax_return',
      'tax_return',
      'tax_return',
    ])
    expect(result.classification.headingYears).toEqual([2025])
  })

  it('reports a PDF that needs a password to open, without throwing', async () => {
    const result = await runFinancialsPrepass(fixture('needs-open-password.pdf'))
    expect(result).toMatchObject({ encrypted: true, failure: 'password_protected' })
    expect(result.classification.kind).toBe('unknown')
  })

  it('reports a PDF with no text layer', async () => {
    const result = await runFinancialsPrepass(await buildImageOnlyPdf())
    expect(result.failure).toBe('no_text_layer')
    expect(result.classification.kind).toBe('unknown')
  })

  it('reports bytes that are not a PDF', async () => {
    const result = await runFinancialsPrepass(new TextEncoder().encode('not a pdf at all'))
    expect(result).toMatchObject({ encrypted: false, failure: 'unreadable', pageCount: 0 })
  })

  it('refuses more pages than the cap before reading any text', async () => {
    const doc = await PDFDocument.create()
    for (let i = 0; i <= MAX_FINANCIALS_PAGES; i++) doc.addPage([100, 100])
    const result = await runFinancialsPrepass(await doc.save())
    expect(result).toMatchObject({ failure: 'too_long', pageCount: MAX_FINANCIALS_PAGES + 1 })
  })

  it("does not detach the caller's buffer", async () => {
    const pdf = await buildFinancialPdf([incomeStatement(2025)])
    const length = pdf.byteLength
    await runFinancialsPrepass(pdf)
    expect(pdf.byteLength).toBe(length)
  })
})

describe('isEncryptedPdf', () => {
  it('tells owner-password PDFs from plain ones', async () => {
    expect(await isEncryptedPdf(fixture('signed-owner-password.pdf'))).toBe(true)
    expect(await isEncryptedPdf(await buildFinancialPdf([incomeStatement(2025)]))).toBe(false)
  })
})
