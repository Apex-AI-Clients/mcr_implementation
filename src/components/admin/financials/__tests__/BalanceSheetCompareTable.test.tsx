import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { BalanceSheetCompareTable } from '../BalanceSheetCompareTable'
import { computeFinancialsComparison } from '@/lib/financials/computeComparison'
import type { ExtractedFinancialStatement } from '@/lib/financials/types'

/** The director / related-party loans block. Synthetic figures only. */

afterEach(cleanup)

function year(fy: number, receivable: number | null, payable: number | null): ExtractedFinancialStatement {
  return {
    financialYear: fy,
    periodEndDate: `${fy}-06-30`,
    sourceFilename: `${fy}.pdf`,
    sourceColumn: 'primary',
    incomeStatement: { income: {}, cogs: {}, expenses: {}, totals: {} },
    balanceSheet: {
      currentAssets: {},
      nonCurrentAssets: receivable === null ? {} : { directorRelatedLoansReceivable: receivable },
      currentLiabilities: {},
      nonCurrentLiabilities: payable === null ? {} : { directorRelatedLoansPayable: payable },
      equity: {},
      totals: {},
    },
    rawExtraction: [],
    warnings: [],
  }
}

describe('Director / Related Party Loans block', () => {
  it('shows the payable line under the receivable line, then the net account', () => {
    const comparison = computeFinancialsComparison([year(2023, 4_000, null), year(2026, null, 700_000)])
    render(<BalanceSheetCompareTable comparison={comparison} />)

    const block = screen.getByRole('heading', { name: 'Director / Related Party Loans' }).closest('div.mb-4') as HTMLElement
    const labels = within(block)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelector('td')?.textContent)
    expect(labels).toEqual([
      'Director/Related Party Loans Receivable',
      'Director/Related Party Loans Payable',
      'Director / related-party loan account (net)',
    ])
    expect(within(block).getByText('-$700,000')).toBeTruthy()

    // Both lines stay in their own sections of the table too.
    expect(screen.getAllByText('Director/Related Party Loans Payable')).toHaveLength(2)
  })
})
