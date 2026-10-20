import { describe, it, expect } from 'vitest'
import { documentStatusBadge, missingRequiredCategories } from '../status'

/** The client's document-status badge. */

describe('documentStatusBadge', () => {
  it('names the required categories with no file', () => {
    expect(documentStatusBadge('in_progress', ['integrated_client_account'])).toEqual({
      label: 'Missing: financial statements',
      variant: 'warning',
    })
    expect(documentStatusBadge('in_progress', []).label).toBe('Missing: financial statements, ATO account CSV')
  })

  it('reads complete when everything required is there, whatever the stored status says', () => {
    expect(documentStatusBadge('in_progress', ['financial_statements', 'integrated_client_account'])).toEqual({
      label: 'Complete',
      variant: 'success',
    })
  })

  it('keeps invited and complete as they are', () => {
    expect(documentStatusBadge('invited', []).label).toBe('Invited')
    expect(documentStatusBadge('complete', []).label).toBe('Complete')
  })
})

describe('missingRequiredCategories', () => {
  it('ignores optional categories', () => {
    expect(missingRequiredCategories(['trust_deed', 'financial_statements'])).toEqual(['integrated_client_account'])
  })

  it.each([['historical_financials'], ['current_financials']])(
    'counts a file uploaded under the older %s category as financial statements',
    (older) => {
      expect(missingRequiredCategories([older, 'integrated_client_account'])).toEqual([])
    },
  )
})
