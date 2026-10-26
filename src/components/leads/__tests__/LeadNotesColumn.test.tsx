import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { LeadTable } from '../LeadTable'
import { LeadsStoreProvider } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import { notesTooltip, NOTES_SHOWN } from '@/lib/leads/notes'
import type { Lead } from '@/types/leads'

/** The notes column on the Non-proceeding and Do not contact tabs. Synthetic data only. */

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

  it('does not exist on the other tabs', () => {
    table(undefined)
    expect(screen.queryByRole('columnheader', { name: 'Notes' })).toBeNull()
  })
})

describe('notesTooltip', () => {
  it('names the date and author of each note, and stops after a few', () => {
    expect(notesTooltip(NOTES)).toBe('20 Oct · Staff One\nWent with another adviser.\n\n10 Oct · Staff Two\nCalled twice, no answer.')
    const many = Array.from({ length: NOTES_SHOWN + 3 }, (_, i) => ({ ...NOTES[0], body: `Note ${i}` }))
    expect(notesTooltip(many).endsWith('…and 3 more on the record')).toBe(true)
  })
})
