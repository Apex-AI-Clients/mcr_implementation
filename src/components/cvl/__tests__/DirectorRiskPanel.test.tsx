import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import { DirectorRiskPanel } from '../DirectorRiskPanel'
import type { DirectorRiskData } from '@/lib/cvl/directorRiskStore'

/** The director's personal risk panel. Synthetic figures only. */

afterEach(() => cleanup())

const RISK: DirectorRiskData = {
  issued: [{ directorName: 'Jordan Sample', removable: 10000, stays: 5000.5, deadline: '2026-11-10', daysLeft: 7, types: ['paygw', 'gst'] }],
  potential: [
    { type: 'paygw', onTime: 0, late: 8200, items: [{ period: 'Period ending 31/03/2025', amount: 8200, reportedOn: '2025-09-01', dueOn: '2025-04-28', daysLate: 126, how: 'Original activity statement', late: true }] },
    { type: 'gst', onTime: 2971.56, late: 2000, items: [] },
    { type: 'sgc', onTime: 0, late: 0, items: [] },
  ],
  activityStatement: { label: 'Activity statement 001', analysedAt: '2026-10-01T00:00:00Z' },
  sgAccounts: [],
  loans: [{ label: 'FY2025', receivable: 40000, payable: null, receivableLines: [], payableLines: [] }],
  totalAtoDebt: 178600.55,
  accounts: [{ label: 'Activity statement 001', balance: 178600.55, balanceDate: '2026-09-30' }],
}

describe('DirectorRiskPanel', () => {
  it('shows the ATO debt, what stays with the director, and what was reported late', () => {
    render(<DirectorRiskPanel clientId="cl_1" risk={RISK} />)
    expect(screen.getByText('$178,601')).toBeTruthy()
    // Stays (issued notices) and late across PAYG withholding, GST and SGC.
    expect(screen.getByText('$5,001')).toBeTruthy()
    expect(screen.getByText('$10,200')).toBeTruthy()
  })

  it('lists each director’s notices with the deadline, and each tax by when it was reported', () => {
    render(<DirectorRiskPanel clientId="cl_1" risk={RISK} />)
    const issued = screen.getByRole('heading', { name: 'Issued director penalty notices' }).parentElement as HTMLElement
    expect(within(issued).getByText('Jordan Sample')).toBeTruthy()
    expect(within(issued).getByText(/Deadline .* · 7 days left/)).toBeTruthy()
    const potential = screen.getByRole('heading', { name: 'What a notice could still cover' }).parentElement as HTMLElement
    expect(within(potential).getByText('PAYG withholding')).toBeTruthy()
    expect(within(potential).getByText('$8,200.00')).toBeTruthy()
    expect(within(potential).getByText('$2,971.56')).toBeTruthy()
    expect(within(potential).getByText(/No superannuation guarantee account on file/)).toBeTruthy()
  })

  it('says where every amount comes from', () => {
    const { container } = render(<DirectorRiskPanel clientId="cl_1" risk={RISK} />)
    const amounts = container.querySelectorAll('[data-sourced]')
    expect(amounts.length).toBeGreaterThan(8)
    expect(container.querySelectorAll('[data-sourced="missing"]')).toHaveLength(0)
  })

  it('says so when there are no notices or loan lines, and is never advice', () => {
    render(<DirectorRiskPanel clientId="cl_1" risk={{ ...RISK, issued: [], loans: [] }} />)
    expect(screen.getByText(/None on file/)).toBeTruthy()
    expect(screen.getByText(/No loan account lines confirmed/)).toBeTruthy()
    expect(screen.getByText(/Not advice/)).toBeTruthy()
  })
})
