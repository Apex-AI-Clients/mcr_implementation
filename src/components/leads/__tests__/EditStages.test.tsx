import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { EditStagesDialog } from '../EditStagesDialog'
import { LeadStagesProvider } from '../LeadStages'
import { LeadTable } from '../LeadTable'
import { LeadsStoreProvider } from '../LeadsStore'
import { LeadRecordHeader } from '../LeadRecordHeader'
import { ToastProvider } from '@/components/ui/Toast'
import type { Lead, StageSetting } from '@/types/leads'

/**
 * Edit stages (0055): rename any stage and reorder the tabs; and the record's
 * "All leads" going back to the list it was opened from. Synthetic data only.
 */

// Hoisted with the mock, so this file's router is the one the components get.
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
  usePathname: () => '/leads',
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => refresh.mockClear())

const row = (key: string, label: string, position: number): StageSetting => ({ key, label, position, hiddenAt: null }) as StageSetting
const STAGES: StageSetting[] = [
  row('lead', 'Lead', 0),
  row('prospect', 'Prospect', 1),
  row('client', 'Client', 2),
  row('unresponsive', 'Unresponsive', 3),
  row('do_not_contact', 'Do not contact again', 4),
  row('contact_in_30_days', 'Contact in 30 days', 5),
  row('non_proceeding', 'Non-proceeding – other', 6),
  row('converted', 'Converted', 7),
  row('custom_aaaa1111', 'Waiting on docs', 100),
]

function stubFetch() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const key = url.split('/').pop()!
      const { label } = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ stage: { key, label, position: 0, hiddenAt: null } }), { status: 200 })
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderPanel(onRequestDelete = vi.fn(), onSaved = vi.fn()) {
  render(
    <LeadStagesProvider initial={STAGES}>
      <EditStagesDialog open onClose={() => {}} onRequestDelete={onRequestDelete} onSaved={onSaved} />
    </LeadStagesProvider>,
  )
  return { onRequestDelete, onSaved }
}

const names = () => within(screen.getByRole('list', { name: 'Stages, in tab order' })).getAllByRole('textbox').map((i) => (i as HTMLInputElement).value)

describe('Edit stages', () => {
  it('lists every tab in order, by its tab name, with Delete only on stages staff added', () => {
    renderPanel()
    expect(names()).toEqual([
      'Leads', 'Prospects', 'Clients', 'Unresponsive', 'Do not contact again', 'Contact in 30 days', 'Non-proceeding – other', 'Converted', 'Waiting on docs',
    ])
    expect(screen.getAllByRole('button', { name: /^Delete / }).map((b) => b.getAttribute('aria-label'))).toEqual(['Delete Waiting on docs'])
    // Nothing changed yet: nothing to save.
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('saves a new order and a new name for a built-in stage, then re-reads the page', async () => {
    const fetchMock = stubFetch()
    const { onSaved } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Move Waiting on docs up' }))
    fireEvent.change(screen.getByDisplayValue('Clients'), { target: { value: 'Signed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    // Two saves in a row: given time under a busy test run.
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('1 stage renamed, tab order saved.'), { timeout: 5000 })
    const calls = fetchMock.mock.calls.map(([url, init]) => [url, init?.method, JSON.parse(String(init?.body))])
    expect(calls[0]).toEqual(['/api/admin/lead-stages/client', 'PATCH', { label: 'Signed' }])
    expect(calls[1][0]).toBe('/api/admin/lead-stages/order')
    expect(calls[1][2].keys.slice(-2)).toEqual(['custom_aaaa1111', 'converted'])
    expect(refresh).toHaveBeenCalled()
  })

  it('reorders by dragging a row onto another', () => {
    renderPanel()
    const items = within(screen.getByRole('list', { name: 'Stages, in tab order' })).getAllByRole('listitem')
    fireEvent.dragStart(items[8], { dataTransfer: { effectAllowed: '' } })
    fireEvent.dragOver(items[0])
    fireEvent.drop(items[0])
    expect(names()[0]).toBe('Waiting on docs')
    expect(names()[1]).toBe('Leads')
  })

  it('asks the page to delete a stage staff added', () => {
    const { onRequestDelete } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Waiting on docs' }))
    expect(onRequestDelete).toHaveBeenCalledWith('custom_aaaa1111')
  })

  it('refuses an empty name', async () => {
    renderPanel()
    fireEvent.change(screen.getByDisplayValue('Prospects'), { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/Every stage needs a name/)).toBeTruthy()
  })
})

describe('All leads goes back to the list the record was opened from', () => {
  const LEAD = {
    id: 'lead-1', name: 'Test Person', email: 'test@example.test', phone: '0400000001', debtMin: null, debtMax: null,
    state: 'NSW', metaStateRaw: null, metaStateOptions: null, entityType: null, message: null, preferredCallTime: null,
    source: 'manual', sourceLabel: null, company: null, stage: 'client', createdAt: '2026-10-01T00:00:00Z',
    lastEnquiryAt: '2026-10-01T00:00:00Z', lastActionAt: null, nextStep: null, enquiryCount: 1, latestEnquirySource: null,
    convertedClientId: null,
  } as unknown as Lead

  it('links each row to its record with the list’s address', () => {
    render(
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
            returnTo="/leads?tab=clients&page=2"
          />
        </LeadsStoreProvider>
      </ToastProvider>,
    )
    const links = screen.getAllByRole('link', { name: /Test Person/ })
    for (const link of links) expect(link.getAttribute('href')).toBe('/leads/lead-1?from=%2Fleads%3Ftab%3Dclients%26page%3D2')
  })

  it('sends "All leads" back there from the record', () => {
    render(<LeadRecordHeader lead={LEAD} backHref="/leads?tab=clients" />)
    expect(screen.getByRole('link', { name: 'All leads' }).getAttribute('href')).toBe('/leads?tab=clients')
  })
})
