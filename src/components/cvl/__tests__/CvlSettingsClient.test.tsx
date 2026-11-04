import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CvlSettingsClient } from '../CvlSettingsClient'
import { LODGEMENT_DEFAULTS, readCvlSettings } from '@/lib/cvl/settings'

/** The CVL settings page: Form 509's lodgement details and Part A's External Administrator. */

afterEach(() => cleanup())

describe('CvlSettingsClient', () => {
  it('has two sections, Form 509 lodgement details and the External Administrator, with nothing to confirm and no Form 509 placements', () => {
    render(<CvlSettingsClient initial={readCvlSettings([])} />)
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Form 509 lodgement details',
      'External Administrator (Form 507 Part A)',
    ])
    // The External Administrator asks for exactly Part A's boxes.
    const ea = screen.getByRole('heading', { name: 'External Administrator (Form 507 Part A)' }).closest('section') as HTMLElement
    expect(within(ea).getAllByRole('textbox').map((i) => (i.closest('div')?.querySelector('label')?.textContent ?? ''))).toEqual([
      'Organisation',
      'ASIC Registered Liquidator number (if applicable)',
      'Name of External Administrator',
      'Contact person',
      'Phone number during business hours',
      'Address (office, building or level)',
      'Street/Unit number and name',
      'Suburb/City',
      'State/Territory',
      'Postcode',
    ])
    expect(within(ea).getByRole('button', { name: /Fill from MCR’s ASIC extract/ })).toBeTruthy()
    expect(screen.queryByText(/where each amount goes/i)).toBeNull()
    expect(screen.queryByText(/to be confirmed/i)).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /Confirmed/ })).toBeNull()
    expect(screen.queryByText(/Gabby/)).toBeNull()
  })

  it('shows Form 509’s lodgement details with their starting values, and saves them as changed', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(readCvlSettings([]))))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup({ delay: null })
    render(<CvlSettingsClient initial={readCvlSettings([])} />)
    const section = screen.getByRole('heading', { name: 'Form 509 lodgement details' }).closest('section') as HTMLElement
    expect((within(section).getByLabelText('Firm/organisation') as HTMLInputElement).value).toBe(LODGEMENT_DEFAULTS.firm)
    expect((within(section).getByLabelText('Telephone number') as HTMLInputElement).value).toBe(LODGEMENT_DEFAULTS.phone)

    const phone = within(section).getByLabelText('Telephone number')
    await user.clear(phone)
    await user.type(phone, '02 0000 0000')
    await user.click(within(section).getByRole('button', { name: 'Save' }))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/cvl/settings')
    expect(JSON.parse(String(init?.body))).toMatchObject({ key: 'lodgement', value: { ...LODGEMENT_DEFAULTS, phone: '02 0000 0000' } })
    vi.unstubAllGlobals()
  })
})
