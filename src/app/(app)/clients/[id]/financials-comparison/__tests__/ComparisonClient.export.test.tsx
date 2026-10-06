import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { computeFinancialsComparison } from '@/lib/financials/computeComparison'
import type { ExtractedFinancialStatement, FinancialsComparison } from '@/lib/financials/types'

/**
 * What the comparison page puts in an export. SYNTHETIC figures.
 *
 * ExportPdfButton leaves out everything marked .no-print, so these tests check
 * the marker: statement checks are left out unless asked for, and a run's
 * transient errors are never in it.
 */

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
}))
const { ComparisonClient } = await import('../ComparisonClient')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  refresh.mockReset()
})

function statement(year: number, sales: number): ExtractedFinancialStatement {
  return {
    financialYear: year,
    periodEndDate: `${year}-06-30`,
    sourceFilename: `synthetic ${year}.pdf`,
    sourceColumn: 'primary',
    incomeStatement: { income: { sales }, cogs: {}, expenses: {}, totals: { totalIncome: sales, profitBeforeTax: sales / 10 } },
    balanceSheet: {
      currentAssets: {},
      nonCurrentAssets: {},
      currentLiabilities: {},
      nonCurrentLiabilities: {},
      equity: {},
      totals: { totalAssets: sales, netAssets: sales / 2 },
    },
    rawExtraction: [],
    warnings: [],
  }
}

const comparison: FinancialsComparison = {
  ...computeFinancialsComparison([statement(2024, 100_000), statement(2025, 120_000)]),
  checks: [
    {
      kind: 'not_statements',
      severity: 'warning',
      financialYear: null,
      statement: null,
      message: 'deed.pdf: does not look like financial statements.',
      documentIds: [],
    },
  ],
}

function renderPage() {
  return render(
    <ComparisonClient
      clientId="client-1"
      clientName="Synthetic Client"
      initialComparison={comparison}
      initialAiSummary={null}
      initialGeneratedAt={null}
      initialExtraction={{ extractedCount: 2, documentCount: 2, hasUnextracted: false }}
      initialJobId={null}
      coverage={{ columns: [], rows: { income_statement: [], balance_sheet: [] } }}
      initialStaleSince={null}
    />,
  )
}

const checksWrapper = () => screen.getByRole('button', { name: /Statement checks/ }).closest('.rounded-lg')!.parentElement!

describe('export contents', () => {
  it('leaves the statement checks out of the PDF unless "Include checks in PDF" is ticked', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(checksWrapper().className).toContain('no-print')

    await user.click(screen.getByRole('checkbox', { name: 'Include checks in PDF' }))
    expect(checksWrapper().className ?? '').not.toContain('no-print')
  })

  it('never puts a start error in the export, and looks for a run that did start', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Re-run comparison' }))
    const banner = await screen.findByText(/Could not confirm the comparison started/)
    expect(banner.className).toContain('no-print')
    expect(refresh).toHaveBeenCalled()
  })
})
