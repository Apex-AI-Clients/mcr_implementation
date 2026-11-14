import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DebtInput } from '../DebtInput'
import { LeadsStoreProvider, type LeadsPersistence } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import type { Lead } from '@/types/leads'

/**
 * The leads table's debt cell: a typed debt as sent, a dropdown debt as its
 * range (migration 0053). Synthetic data only.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/leads',
}))

afterEach(cleanup)

const LEAD = {
  id: 'ld_1',
  name: 'Test Person',
  email: 'test@example.test',
  phone: '0400000001',
  debtMin: 100_000,
  debtMax: 124_999,
  debtText: null,
  state: 'QLD',
  entityType: null,
  message: null,
  preferredCallTime: null,
  stage: 'lead',
  source: 'website',
  sourceLabel: null,
  entityTypeLabel: null,
  company: null,
  nextStep: null,
  stageSince: '2026-11-01T00:00:00.000Z',
  lastActionAt: '2026-11-01T00:00:00.000Z',
  lastEnquiryAt: '2026-11-01T00:00:00.000Z',
  enquiryCount: 1,
  latestEnquirySource: null,
  reenquiredAfterCloseAt: null,
  reenquiryDismissedAt: null,
  reenquiryDismissedBy: null,
  convertedClientId: null,
  metaFormId: null,
  metaAdId: null,
  metaAdgroupId: null,
  metaPageId: null,
  metaCampaignId: null,
  metaCampaignName: null,
  metaAdName: null,
  metaAccountId: null,
  metaStateRaw: null,
  metaStateOptions: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
} as Lead

function renderCell(lead: Lead, persistence: LeadsPersistence = {}) {
  return render(
    <ToastProvider>
      <LeadsStoreProvider author="Tester" initialLeads={[lead]} persistence={persistence}>
        <DebtInput lead={lead} />
      </LeadsStoreProvider>
    </ToastProvider>,
  )
}

describe('DebtInput — what the leads table shows (0053)', () => {
  it('shows a typed amount in full, as typed, not rounded to "$200k"', () => {
    renderCell({ ...LEAD, debtMin: 200_000, debtMax: 200_000, debtText: '200,000' })
    const cell = screen.getByRole('button', { name: 'Edit debt for Test Person' })
    expect(cell.textContent).toContain('$200,000')
    expect(cell.textContent).toContain('as typed')
    expect(cell.textContent).not.toContain('$200k')
  })

  it('shows typed text that is not an amount exactly as sent', () => {
    renderCell({ ...LEAD, debtMin: null, debtMax: null, debtText: 'about two hundred grand' })
    const cell = screen.getByRole('button', { name: 'Edit debt for Test Person' })
    expect(cell.textContent).toContain('about two hundred grand')
    expect(cell.textContent).toContain('as typed')
  })

  it('shows a dropdown debt as its range, with no hint', () => {
    renderCell(LEAD)
    const cell = screen.getByRole('button', { name: 'Edit debt for Test Person' })
    expect(cell.textContent).toBe('$100k – $125k')
  })

  it("replaces the lead's typed words with staff's figure", async () => {
    const user = userEvent.setup()
    const updateLead = vi.fn(async () => {})
    renderCell({ ...LEAD, debtMin: null, debtMax: null, debtText: 'about two hundred grand' }, { updateLead })
    await user.click(screen.getByRole('button', { name: 'Edit debt for Test Person' }))
    await user.type(screen.getByLabelText('Debt for Test Person'), '200000{Enter}')
    await waitFor(() => expect(updateLead).toHaveBeenCalledTimes(1))
    expect(updateLead).toHaveBeenCalledWith({
      leadId: 'ld_1',
      patch: { debtMin: 200_000, debtMax: 200_000, debtText: null },
    })
  })
})
