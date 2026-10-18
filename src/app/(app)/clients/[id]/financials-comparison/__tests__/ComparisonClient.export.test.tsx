import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { computeFinancialsComparison } from '@/lib/financials/computeComparison'
import type { StatementCoverage } from '@/lib/financials/coverage'
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

const missing = { status: 'missing' as const, filename: null, documentId: null }
const own = { status: 'own' as const, filename: 'SYNTH_statements_2025.pdf', documentId: 'd1' }
const coverage: StatementCoverage = {
  columns: [{ key: 'fy2025', label: 'FY2025', financialYear: 2025, kind: 'annual', extra: false }],
  rows: { income_statement: [own], balance_sheet: [missing] },
}

const fileRow = {
  documentId: 'd1',
  filename: 'SYNTH_statements_2025.pdf',
  annualYears: [2025],
  comparativeYears: [],
  currentPeriodYear: null,
  currentPeriodLabel: null,
  usage: 'used' as const,
  note: 'Annual, compared for FY2025.',
  override: null,
  overridePending: false,
}

function renderPage({ showDiagnostics = true, withCoverage = false, withFiles = false } = {}) {
  return render(
    <ComparisonClient
      clientId="client-1"
      clientName="Synthetic Client"
      initialComparison={comparison}
      initialAiSummary={null}
      initialGeneratedAt={null}
      initialExtraction={{ extractedCount: 2, documentCount: 2, hasUnextracted: false }}
      initialJobId={null}
      coverage={withCoverage ? coverage : { columns: [], rows: { income_statement: [], balance_sheet: [] } }}
      files={withFiles ? [fileRow] : []}
      overrideYears={[2027, 2026, 2025]}
      initialStaleSince={null}
      showDiagnostics={showDiagnostics}
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

describe('diagnostics (SHOW_FINANCIALS_DIAGNOSTICS)', () => {
  it('shows "Statements on file" and the statement checks when enabled', () => {
    renderPage({ showDiagnostics: true, withCoverage: true })
    expect(screen.getByText('Statements on file')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Statement checks/ })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Include checks in PDF' })).toBeTruthy()
  })

  it('hides them in production (flag off), keeping the coverage table', () => {
    renderPage({ showDiagnostics: false, withCoverage: true, withFiles: true })
    // The coverage table, where a file's year and type are changed, shows everywhere.
    expect(screen.getByText('Statements on file')).toBeTruthy()
    // The per-file list does not.
    expect(screen.queryByRole('columnheader', { name: 'Read as' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Statement checks/ })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Include checks in PDF' })).toBeNull()
    // The comparison itself is still there.
    expect(screen.getByText('Income Statement')).toBeTruthy()
  })
})

describe('year and type from the coverage table', () => {
  it('opens a file from its cell, changes it, and reads that file again', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/period')
        ? new Response(JSON.stringify({ ok: true }), { status: 200 })
        : new Response(JSON.stringify({ jobId: 'job-1' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPage({ showDiagnostics: false, withCoverage: true, withFiles: true })

    await user.click(screen.getByRole('button', { name: /SYNTH_statements_2025\.pdf/ }))
    expect(screen.getByText('Detected: FY2025 annual')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Change' }))
    await user.selectOptions(screen.getByLabelText('Financial year for SYNTH_statements_2025.pdf'), '2026')
    await user.click(screen.getByRole('button', { name: 'Save and read again' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/financials-comparison/start'))).toBe(true))
    const period = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/period'))!
    expect(String(period[0])).toBe('/api/admin/clients/client-1/financial-statements/d1/period')
    const start = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/financials-comparison/start'))! as unknown as [string, RequestInit]
    expect(JSON.parse(start[1].body as string)).toEqual({ mode: 'full', documentIds: ['d1'] })
  })
})
