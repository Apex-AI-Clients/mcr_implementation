// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { readPdfPageLines } from '@/lib/pdf/pageLines'
import { extractFinancialStatementFromPdf } from '../extractFromPdf'
import { runFinancialsPrepass } from '../prepass'
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
 * The extraction call, with the model replaced: what is SENT (pages, prompt)
 * and what is KEPT from the answer. SYNTHETIC PDFs and figures only; no
 * network — fetch is a stub that records the request.
 */

const IS = { income: { sales: 120000 }, cogs: {}, expenses: {}, totals: { totalIncome: 120000 } }
const BS = {
  currentAssets: {},
  nonCurrentAssets: {},
  currentLiabilities: {},
  nonCurrentLiabilities: {},
  equity: {},
  totals: { totalAssets: 65000, totalLiabilities: 40000, netAssets: 25000 },
}
const NO_IS = { income: {}, cogs: {}, expenses: {}, totals: {} }
const NO_BS = { ...BS, totals: {} }

interface Column {
  sourceColumn: string
  financialYear: number
  periodEndDate: string
  incomeStatementPresent: boolean
  balanceSheetPresent: boolean
  incomeStatement: unknown
  balanceSheet: unknown
}

const column = (over: Partial<Column> = {}): Column => ({
  sourceColumn: 'primary',
  financialYear: 2025,
  periodEndDate: '2025-06-30',
  incomeStatementPresent: true,
  balanceSheetPresent: true,
  incomeStatement: IS,
  balanceSheet: BS,
  ...over,
})

let requests: Array<{ prompt: string; pdf: Uint8Array }> = []

function modelReturns(statements: Column[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body)
      const [text, file] = body.messages[0].content
      const base64 = file.file.file_data.replace('data:application/pdf;base64,', '')
      requests.push({ prompt: text.text, pdf: new Uint8Array(Buffer.from(base64, 'base64')) })
      return new Response(
        JSON.stringify({
          model: 'test-model',
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                tool_calls: [
                  {
                    type: 'function',
                    function: { name: 'submit_extracted_financials', arguments: JSON.stringify({ statements }) },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      )
    }),
  )
}

async function extract(pdf: Uint8Array, sourceFilename = 'synthetic.pdf') {
  const prepass = await runFinancialsPrepass(pdf)
  return extractFinancialStatementFromPdf({ pdfBytes: pdf, sourceFilename, prepass })
}

beforeEach(() => {
  requests = []
  process.env.OPENROUTER_API_KEY = 'test-key'
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('what is sent', () => {
  it('sends only the statement pages of an unencrypted bundle', async () => {
    modelReturns([column(), column({ sourceColumn: 'comparative', financialYear: 2024, periodEndDate: '2024-06-30' })])
    const pdf = await buildFinancialPdf([coverLetter(), incomeStatement(2025), balanceSheet(2025), notes(), ...taxReturn(2025, 6)])
    const result = await extract(pdf)

    const sent = await readPdfPageLines(requests[0].pdf, 500)
    expect(sent.pageCount).toBe(2)
    expect(sent.pages.flat().join(' ')).not.toMatch(/tax return|Tax file number/i)
    expect(result.selection.mode).toBe('statement_pages')
    expect(requests[0].prompt).toContain('cut down to the statement pages only')
    expect(requests[0].prompt).toContain('financialYear MUST be 2025')
  })

  it('sends an encrypted file whole, naming the statement pages — the tax return pages are never named', async () => {
    modelReturns([column()])
    const pdf = new Uint8Array(readFileSync(path.join(__dirname, 'fixtures', 'pdf', 'signed-owner-password.pdf')))
    const result = await extract(pdf)

    expect(Buffer.from(requests[0].pdf).equals(Buffer.from(pdf))).toBe(true)
    expect(result.selection.mode).toBe('named_pages_whole_file')
    expect(requests[0].prompt).toContain('the Income Statement is on page 5 and the Balance Sheet is on page 6')
    expect(requests[0].prompt).not.toMatch(/on pages? [1-3]\b/)
  })

  it('keeps the base prompt word for word, ahead of the document context', async () => {
    modelReturns([column()])
    const { FINANCIALS_EXTRACTION_PROMPT } = await import('../../ai/prompts')
    await extract(await buildFinancialPdf([incomeStatement(2025), balanceSheet(2025)]))
    expect(requests[0].prompt.startsWith(FINANCIALS_EXTRACTION_PROMPT)).toBe(true)
  })
})

describe('what is kept', () => {
  it('keeps both halves of a combined statement', async () => {
    modelReturns([column()])
    const result = await extract(await buildFinancialPdf([incomeStatement(2025), balanceSheet(2025)]))
    expect(result.statements).toHaveLength(1)
    expect(result.statements[0].present).toEqual({ income_statement: true, balance_sheet: true })
  })

  it('drops balance sheet figures the model returned for a P&L-only file', async () => {
    modelReturns([column()])
    const result = await extract(await buildFinancialPdf([trustProfitAndLoss(2025)]), '2024-2025_PROFIT_AND_LOSS.pdf')
    expect(result.statements[0].present).toEqual({ income_statement: true, balance_sheet: false })
    expect(result.statements[0].warnings.map((w) => w.kind)).toContain('presence_mismatch')
    expect(requests[0].prompt).toContain('balanceSheetPresent to false')
  })

  it('drops an empty column with a document warning instead of failing the file', async () => {
    modelReturns([
      column(),
      column({ sourceColumn: 'comparative', financialYear: 2024, periodEndDate: '2024-06-30', incomeStatement: NO_IS, balanceSheet: NO_BS }),
    ])
    const result = await extract(await buildFinancialPdf([incomeStatement(2025), balanceSheet(2025)]))
    expect(result.statements.map((s) => s.sourceColumn)).toEqual(['primary'])
    expect(result.documentWarnings.map((w) => w.kind)).toContain('presence_mismatch')
  })

  it('still fails a file where no column has anything real', async () => {
    modelReturns([column({ incomeStatement: NO_IS, balanceSheet: NO_BS })])
    await expect(extract(await buildFinancialPdf([incomeStatement(2025), balanceSheet(2025)]))).rejects.toThrow(/empty extraction/)
  })

  it('moves a column the model put in the wrong year to the heading year', async () => {
    modelReturns([column({ financialYear: 2024, periodEndDate: '2024-06-30' })])
    const result = await extract(await buildFinancialPdf([incomeStatement(2025), balanceSheet(2025)]))
    expect(result.statements[0]).toMatchObject({ financialYear: 2025, periodEndDate: '2025-06-30' })
    expect(result.statements[0].warnings.map((w) => w.kind)).toContain('year_mismatch')
  })

  it('reports a filename that names a different year from the headings', async () => {
    modelReturns([column()])
    const result = await extract(await buildFinancialPdf([incomeStatement(2025), balanceSheet(2025)]), 'Accounts 2023.pdf')
    expect(result.documentWarnings.map((w) => w.kind)).toContain('filename_year_conflict')
    expect(result.statements[0].financialYear).toBe(2025)
  })
})
