import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { LeadTable } from '../LeadTable'
import { LeadsStoreProvider } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import type { Lead } from '@/types/leads'

/** The notes column on the leads table. Synthetic data only. */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/leads' }))

afterEach(() => cleanup())

const LEAD = {
  id: 'lead-1',
  name: 'Test Person',
  email: 'test.person@example.test',
  phone: '0400000001',
  debtMin: 100_000,
  debtMax: 124_999,
  state: 'NSW',
  metaStateRaw: null,
  metaStateOptions: null,
  entityType: null,
  message: null,
  preferredCallTime: null,
  source: 'manual',
  sourceLabel: null,
  company: null,
  stage: 'non_proceeding',
  createdAt: '2026-10-01T00:00:00Z',
  lastEnquiryAt: '2026-10-01T00:00:00Z',
  lastActionAt: null,
  nextStep: null,
  enquiryCount: 1,
  latestEnquirySource: null,
  convertedClientId: null,
} as unknown as Lead

const NOTES = [
  { body: 'Went with another adviser.', author: 'Staff One', createdAt: '2026-10-20T01:00:00Z' },
  { body: 'Called twice, no answer.', author: 'Staff Two', createdAt: '2026-10-10T01:00:00Z' },
]

function table(notes?: Record<string, typeof NOTES>) {
  return render(
    <ToastProvider>
      <LeadsStoreProvider author="Tester">
        <LeadTable
          leads={[LEAD]}
          filtered={false}
          onResetFilters={() => {}}
          onRequestConvert={() => {}}
          selectedIds={new Set()}
          onToggleLead={() => {}}
          onToggleAll={() => {}}
          onRequestDelete={() => {}}
          notes={notes}
        />
      </LeadsStoreProvider>
    </ToastProvider>,
  )
}

describe('the notes column', () => {
  it('shows an icon with the count, and the notes newest first on hover', () => {
    table({ 'lead-1': NOTES })
    const header = screen.getByRole('columnheader', { name: 'Notes' })
    const headers = screen.getAllByRole('columnheader')
    // Just before Stage, and one cell per header.
    expect(headers[headers.indexOf(header) + 1].textContent).toBe('Stage')
    expect(within(screen.getAllByRole('row')[1]).getAllByRole('cell')).toHaveLength(headers.length)

    const icon = screen.getAllByLabelText('2 notes')[0]
    fireEvent.mouseEnter(icon.parentElement!)
    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toContain('Went with another adviser.')
    expect(tip.textContent!.indexOf('Went with another adviser.')).toBeLessThan(tip.textContent!.indexOf('Called twice, no answer.'))
  })

  it('shows a dash for a lead without notes', () => {
    table({})
    expect(screen.getByRole('columnheader', { name: 'Notes' })).toBeTruthy()
    expect(screen.queryByLabelText(/notes?$/)).toBeNull()
  })

  it('does not exist without notes', () => {
    table(undefined)
    expect(screen.queryByRole('columnheader', { name: 'Notes' })).toBeNull()
  })
})

describe('the notes tooltip', () => {
  it('lists every note as a bullet, with its date and author', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...NOTES[0], body: `Note ${i}` }))
    table({ 'lead-1': many })
    fireEvent.mouseEnter(screen.getAllByLabelText('9 notes')[0].parentElement!)
    const items = within(screen.getByRole('tooltip')).getAllByRole('listitem')
    expect(items).toHaveLength(9)
    expect(items[0].textContent).toBe('20 Oct · Staff OneNote 0')
    expect(items[8].textContent).toContain('Note 8')
  })
})

describe('a lead with long unbroken text', () => {
  it('cuts a malformed phone, so the row cannot widen the table', () => {
    const phone = '9'.repeat(35)
    render(
      <ToastProvider>
        <LeadsStoreProvider author="Tester">
          <LeadTable
            leads={[{ ...LEAD, phone }]}
            filtered={false}
            onResetFilters={() => {}}
            onRequestConvert={() => {}}
            selectedIds={new Set()}
            onToggleLead={() => {}}
            onToggleAll={() => {}}
            onRequestDelete={() => {}}
          />
        </LeadsStoreProvider>
      </ToastProvider>,
    )
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell')
    expect(cells.find((cell) => cell.hasAttribute('title'))!.className).toContain('truncate')
  })
})

describe('the message column', () => {
  it('shows an icon with the message on hover, and a dash without one', () => {
    const message = 'Please call after 5pm about the ATO debt.'
    render(
      <ToastProvider>
        <LeadsStoreProvider author="Tester">
          <LeadTable
            leads={[{ ...LEAD, message }, { ...LEAD, id: 'lead-2', message: null }]}
            filtered={false}
            onResetFilters={() => {}}
            onRequestConvert={() => {}}
            selectedIds={new Set()}
            onToggleLead={() => {}}
            onToggleAll={() => {}}
            onRequestDelete={() => {}}
          />
        </LeadsStoreProvider>
      </ToastProvider>,
    )
    const icons = screen.getAllByLabelText('Message')
    // One in the table row; the card layout keeps its own one-line preview.
    expect(icons).toHaveLength(1)
    fireEvent.mouseEnter(icons[0].parentElement!)
    expect(screen.getByRole('tooltip').textContent).toBe(message)
  })
})
