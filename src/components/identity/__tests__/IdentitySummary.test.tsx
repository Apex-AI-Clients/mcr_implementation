import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IdentitySummary } from '../IdentitySummary'

/** The intake review's company / trust summary. Synthetic data only. */

afterEach(() => cleanup())

function valueOf(region: HTMLElement, label: string) {
  return within(region).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent
}

describe('IdentitySummary', () => {
  it('a Company: the company with its own ABN, and no trust', () => {
    render(
      <IdentitySummary
        details={{
          entityType: 'company',
          companyName: 'Sample Trading Pty Ltd',
          acnNumber: '123456780',
          abnNumber: '11123456780',
        }}
        onEdit={vi.fn()}
      />,
    )
    const company = screen.getByRole('region', { name: 'Company' })
    expect(valueOf(company, 'Company ABN')).toBe('11123456780')
    expect(screen.queryByRole('region', { name: 'Trust' })).toBeNull()
  })

  it('a trustee: "No ABN of its own" for the company, and the trust with its ABN', () => {
    render(
      <IdentitySummary
        details={{
          entityType: 'trust',
          companyName: 'Sample Holdings Pty Ltd',
          acnNumber: '123456780',
          abnNumber: '',
          trustName: 'Sample Family Trust',
          trustAbnNumber: '51824753556',
        }}
        onEdit={vi.fn()}
      />,
    )
    expect(valueOf(screen.getByRole('region', { name: 'Company' }), 'Company ABN')).toBe(
      'No ABN of its own',
    )
    const trust = screen.getByRole('region', { name: 'Trust' })
    expect(valueOf(trust, 'Trust name')).toBe('Sample Family Trust')
    expect(valueOf(trust, 'Trust ABN')).toBe('51824753556')
  })

  it('jumps back to the company step to edit', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    render(<IdentitySummary details={{ entityType: 'company' }} onEdit={onEdit} />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })
})
