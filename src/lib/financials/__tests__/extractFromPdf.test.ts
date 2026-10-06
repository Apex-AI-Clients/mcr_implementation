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
  lines?: unknown[]
  warnings?: unknown[]
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

describe('mapping corrections (separate-file trust)', () => {
  const line = (section: string, rawLabel: string, value: number | null, canonicalKey: string | null, isTotal = false) => ({
    section,
    rawLabel,
    value,
    canonicalKey,
    isTotal,
  })

  it('no longer asks for, or keeps, the "combined PDF expected" note', async () => {
    const { FINANCIALS_EXTRACTION_PROMPT } = await import('../../ai/prompts')
    expect(FINANCIALS_EXTRACTION_PROMPT).not.toMatch(/combined PDF expected/)

    modelReturns([
      column({
        balanceSheetPresent: false,
        balanceSheet: NO_BS,
        warnings: [{ kind: 'incomplete_current_period', message: 'P&L present but no Balance Sheet detected — combined PDF expected' }],
      }),
    ])
    const result = await extract(await buildFinancialPdf([trustProfitAndLoss(2025)]))
    expect(result.statements[0].warnings.map((w) => w.message).join(' ')).not.toMatch(/combined PDF expected/)
  })

  it("sets a trust's net profit after tax to its profit before tax", async () => {
    modelReturns([
      column({
        balanceSheetPresent: false,
        balanceSheet: NO_BS,
        // Consistent with the synthetic PDF, which prints "Net Profit 45,000 38,000".
        incomeStatement: { ...IS, totals: { totalIncome: 210000, profitBeforeTax: 45000, netProfitAfterTax: 33000 } },
        lines: [
          line('incomeTotals', 'Net Profit', 45000, 'totals.profitBeforeTax', true),
          line('appropriation', 'Less Prior Year Loss', 12000, null),
          line('incomeTotals', 'NET TRADING PROFIT/(LOSS) AFTER DEDUCTING LOSS', 33000, 'totals.netProfitAfterTax', true),
          line('appropriation', 'Distribution to Beneficiaries', 33000, null),
        ],
      }),
    ])
    // The heading "... ATF SAMPLE FAMILY TRUST" makes it a trust.
    const result = await extract(await buildFinancialPdf([trustProfitAndLoss(2025)]))
    const st = result.statements[0]
    expect(st.incomeStatement.totals.netProfitAfterTax).toBe(45000)
    expect(st.incomeStatement.appropriations).toEqual({ priorYearLossesApplied: 12000, distributions: 33000 })
    expect(st.incomeStatement.lines).toHaveLength(4)
  })

  it('takes totals printed in the wrong column from the line items, with one note for the file', async () => {
    // Labels the synthetic PDF does not print, so only the swap logic decides.
    const expenseLines = (a: number, b: number, printed: number) => [
      line('expenses', 'Sample Expense A', a, 'expenses.rent'),
      line('expenses', 'Sample Expense B', b, 'expenses.wagesAndSalaries'),
      line('expenses', 'Sample Expenses Total', printed, 'totals.totalExpenses', true),
    ]
    modelReturns([
      column({ incomeStatement: { ...IS, totals: { totalIncome: 120000, totalExpenses: 45000 } }, lines: expenseLines(40000, 20000, 45000) }),
      column({
        sourceColumn: 'comparative',
        financialYear: 2024,
        periodEndDate: '2024-06-30',
        incomeStatement: { ...IS, totals: { totalIncome: 110000, totalExpenses: 60000 } },
        lines: expenseLines(30000, 15000, 60000),
      }),
    ])
    const result = await extract(await buildFinancialPdf([incomeStatement(2025), balanceSheet(2025)]))
    expect(result.statements.map((st) => st.incomeStatement.totals.totalExpenses)).toEqual([60000, 45000])
    expect(result.documentWarnings.filter((w) => w.kind === 'swapped_totals')).toHaveLength(1)
  })

  it('keeps an annual statement annual even when the model calls it current-period', async () => {
    modelReturns([column({ sourceColumn: 'current_period' })])
    const result = await extract(await buildFinancialPdf([incomeStatement(2025, { comparative: false }), balanceSheet(2025, { comparative: false })]))
    expect(result.statements[0].sourceColumn).toBe('primary')
    expect(result.statements[0].warnings.map((w) => w.kind)).toContain('year_mismatch')
  })
})
