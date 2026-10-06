import { describe, it, expect } from 'vitest'
import { documentStatusBadge, missingRequiredCategories } from '../status'

/** The client's document-status badge. */

describe('documentStatusBadge', () => {
  it('names the required categories with no file', () => {
    expect(documentStatusBadge('in_progress', ['historical_financials', 'integrated_client_account'])).toEqual({
      label: 'Missing: current financials',
      variant: 'warning',
    })
    expect(documentStatusBadge('in_progress', []).label).toBe(
      'Missing: current financials, last 4 years financials, ATO account CSV',
    )
  })

  it('reads complete when everything required is there, whatever the stored status says', () => {
    expect(documentStatusBadge('in_progress', ['current_financials', 'historical_financials', 'integrated_client_account'])).toEqual({
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
    expect(missingRequiredCategories(['trust_deed', 'current_financials', 'historical_financials'])).toEqual([
      'integrated_client_account',
    ])
  })
})
