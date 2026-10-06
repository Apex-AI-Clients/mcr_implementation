// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { readPdfPageLines } from '@/lib/pdf/pageLines'
import { FALLBACK_MAX_PAGES, bytesForSelection, selectPages } from '../pageSelection'
import { runFinancialsPrepass } from '../prepass'
import {
  balanceSheet,
  buildFinancialPdf,
  coverLetter,
  incomeStatement,
  invoice,
  notes,
  taxReturn,
} from './fixtures/statementPages'

/** Which pages reach the model. SYNTHETIC PDFs; see prepass.test.ts for the fixtures. */

const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.join(__dirname, 'fixtures', 'pdf', name)))

async function textOf(bytes: Uint8Array): Promise<string> {
  const { pages } = await readPdfPageLines(bytes, 500)
  return pages.map((lines) => lines.join('\n')).join('\n---\n')
}

describe('selectPages', () => {
  const found = { statementPages: { income_statement: [4], balance_sheet: [5, 6] } }
  const none = { statementPages: { income_statement: [], balance_sheet: [] } }

  it('sends only the statement pages of an unencrypted file', () => {
    expect(selectPages({ encrypted: false, pageCount: 20, classification: found })).toEqual({
      mode: 'statement_pages',
      sentPages: [4, 5, 6],
      statementPages: found.statementPages,
    })
  })

  it('sends an encrypted file whole, with its statement pages named', () => {
    const selection = selectPages({ encrypted: true, pageCount: 20, classification: found })
    expect(selection.mode).toBe('named_pages_whole_file')
    expect(selection.sentPages).toHaveLength(20)
    expect(selection.statementPages).toEqual(found.statementPages)
  })

  it('falls back to the first pages only when nothing was found in a long unencrypted file', () => {
    const selection = selectPages({ encrypted: false, pageCount: 20, classification: none })
    expect(selection.mode).toBe('first_pages_fallback')
    expect(selection.sentPages).toEqual(Array.from({ length: FALLBACK_MAX_PAGES }, (_, i) => i + 1))
  })

  it('sends a short or encrypted file whole when nothing was found', () => {
    expect(selectPages({ encrypted: false, pageCount: 3, classification: none }).mode).toBe('whole_file')
    expect(selectPages({ encrypted: true, pageCount: 20, classification: none }).mode).toBe('whole_file')
  })
})

describe('bytesForSelection', () => {
  it('cuts an unencrypted bundle down to its statements — the tax return never leaves', async () => {
    const pdf = await buildFinancialPdf([
      coverLetter(),
      incomeStatement(2025),
      balanceSheet(2025),
      notes(),
      ...taxReturn(2025, 4),
    ])
    const prepass = await runFinancialsPrepass(pdf)
    const selection = selectPages({ encrypted: false, pageCount: prepass.pageCount, classification: prepass.classification })
    const sent = await bytesForSelection(pdf, selection)

    const text = await textOf(sent)
    expect(text).toContain('Income Statement')
    expect(text).toContain('Balance Sheet')
    expect(text).not.toMatch(/tax return|Tax file number|Losses schedule|Dear Directors|Notes to the/i)
    expect((await readPdfPageLines(sent, 500)).pageCount).toBe(2)
  })

  it('finds statements after page 8, where the old first-8-pages trim cut them off', async () => {
    const front = Array.from({ length: 9 }, () => notes())
    const pdf = await buildFinancialPdf([...front, incomeStatement(2025), balanceSheet(2025)])
    const prepass = await runFinancialsPrepass(pdf)
    const selection = selectPages({ encrypted: false, pageCount: prepass.pageCount, classification: prepass.classification })
    expect(selection.sentPages).toEqual([10, 11])
    expect(await textOf(await bytesForSelection(pdf, selection))).toContain('Balance Sheet')
  })

  it('sends an encrypted file byte for byte', async () => {
    const pdf = fixture('signed-owner-password.pdf')
    const prepass = await runFinancialsPrepass(pdf)
    const selection = selectPages({ encrypted: prepass.encrypted, pageCount: prepass.pageCount, classification: prepass.classification })
    expect(selection.mode).toBe('named_pages_whole_file')
    expect(await bytesForSelection(pdf, selection)).toBe(pdf)
  })

  it('keeps the first-pages fallback for an unrecognised long file', async () => {
    const pdf = await buildFinancialPdf(Array.from({ length: 12 }, () => invoice()[0]))
    const prepass = await runFinancialsPrepass(pdf)
    const selection = selectPages({ encrypted: false, pageCount: prepass.pageCount, classification: prepass.classification })
    expect(selection.mode).toBe('first_pages_fallback')
    expect((await readPdfPageLines(await bytesForSelection(pdf, selection), 500)).pageCount).toBe(FALLBACK_MAX_PAGES)
  })
})
