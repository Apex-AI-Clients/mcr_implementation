import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeadsPageClient } from '../LeadsPageClient'
import { LeadsStoreProvider, type LeadsPersistence } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import { EMPTY_FILTERS } from '@/lib/leads/filter'
import type { Lead } from '@/types/leads'

/**
 * Conversion, driven through the real list so the whole path is exercised:
 * stage select → confirmation → POST → store update → toast.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/leads',
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const LEAD: Lead = {
  id: 'ld_1',
  name: 'Dean Whitlock',
  email: 'dean@whitlockcivil.com.au',
  phone: '0407552118',
  debtMin: 100_000,
  debtMax: 124_999,
  entityType: 'company',
  message: null,
  preferredCallTime: null,
  state: 'QLD',
  stage: 'prospect',
  source: 'google_form',
  company: null,
  nextStep: null,
  stageSince: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  lastActionAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  lastEnquiryAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
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
  createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  updatedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
}

/** Returns the spy, so a caller can assert on what was actually sent. */
function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderList(persistence?: LeadsPersistence) {
  return render(
    <ToastProvider>
      <LeadsStoreProvider
        initialLeads={[LEAD]}
        initialActivities={[]}
        author="Gabby"
        persistence={persistence}
      >
        {/* The list renders the page the server sent; the store supplies the
            optimistic overlay on top of it. */}
        <LeadsPageClient
          filters={EMPTY_FILTERS}
          leads={[LEAD]}
          total={1}
          page={1}
          pageCount={1}
          pageSize={10}
        />
      </LeadsStoreProvider>
    </ToastProvider>,
  )
}

function stageSelect(): HTMLSelectElement {
  return within(screen.getByRole('table')).getByLabelText(
    'Stage for Dean Whitlock',
  ) as HTMLSelectElement
}

async function openConversion(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(stageSelect(), 'client')
  return screen.findByRole('dialog')
}

/**
 * Fill in what conversion now requires.
 *
 * Name and email arrive pre-filled from the lead; the company details do not,
 * and without them Convert refuses — which is the whole point of the form, and
 * is asserted on its own below.
 */
async function fillRequired(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
) {
  await user.type(within(dialog).getByLabelText('Name of company'), 'Whitlock Civil Pty Ltd')
  await user.type(within(dialog).getByLabelText('ACN number'), '123456789')
  await user.type(within(dialog).getByLabelText('ABN number'), '12345678901')
}

/** Open the dialog and complete it, for the cases that are about what
 *  happens after Convert rather than about the form itself. */
async function openAndFill(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await openConversion(user)
  await fillRequired(user, dialog)
  return dialog
}

describe('ConvertToClientDialog', () => {
  it('names the person and says what will happen', async () => {
    const user = userEvent.setup()
    renderList()

    const dialog = await openConversion(user)
    expect(
      within(dialog).getByText(/These details start Dean Whitlock's intake/),
    ).toBeTruthy()
    // Name and email come across from the lead already filled in.
    expect((within(dialog).getByLabelText('Email') as HTMLInputElement).value).toBe(
      'dean@whitlockcivil.com.au',
    )
    expect(within(dialog).getByRole('button', { name: 'Convert' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('does not touch the API until Convert is pressed', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderList()

    await openConversion(user)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(stageSelect().value).toBe('prospect')
  })

  it('refuses to convert until the intake details are filled in', async () => {
    // The gate. A client file used to be created knowing only a name and an
    // email, leaving somebody to find the ACN afterwards.
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderList()

    const dialog = await openConversion(user)
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))

    expect(within(dialog).getByText('Enter the company name.')).toBeTruthy()
    expect(within(dialog).getByText('Enter the ACN.')).toBeTruthy()
    expect(within(dialog).getByText('Enter the ABN.')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(stageSelect().value).toBe('prospect')
  })

  it('asks a trust for its name instead of an ACN', async () => {
    // Demanding both of every client would mean "N/A" on every conversion,
    // and that junk would auto-fill the intake form.
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn())
    renderList()

    const dialog = await openConversion(user)
    await user.selectOptions(within(dialog).getByLabelText('Entity type'), 'trust')
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))

    expect(within(dialog).getByText('Enter the trust name.')).toBeTruthy()
    expect(within(dialog).queryByText('Enter the ACN.')).toBeNull()
    expect(within(dialog).queryByText('Enter the company name.')).toBeNull()
  })

  it('links to the ACN and ABN registers in a new tab, opening a typed ABN directly', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn())
    renderList()

    const dialog = await openConversion(user)
    const asic = within(dialog).getByRole('link', {
      name: 'Check or find an ACN (opens in a new tab)',
    })
    const abr = within(dialog).getByRole('link', {
      name: 'Check or find an ABN (opens in a new tab)',
    })

    expect(asic.getAttribute('href')).toBe(
      'https://connectonline.asic.gov.au/RegistrySearch/faces/landing/SearchRegisters.jspx',
    )
    expect(abr.getAttribute('href')).toBe('https://abr.business.gov.au/')
    for (const link of [asic, abr]) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    }

    await user.type(within(dialog).getByLabelText('ABN number'), '51 824 753 556')
    expect(abr.getAttribute('href')).toBe('https://abr.business.gov.au/ABN/View?abn=51824753556')
  })

  it('sends the details with the client so intake opens filled in', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(201, { id: 'client-1' })
    renderList()

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const sent = JSON.parse(init.body as string)
    expect(sent.companyDetails).toMatchObject({
      companyName: 'Whitlock Civil Pty Ltd',
      acnNumber: '123456789',
      abnNumber: '12345678901',
    })
  })

  it('leaves the stage alone when cancelled', async () => {
    const user = userEvent.setup()
    renderList()

    const dialog = await openConversion(user)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(stageSelect().value).toBe('prospect')
  })

  it('creates the file, moves the lead to client and offers a link', async () => {
    const user = userEvent.setup()
    mockFetch(201, { id: 'client-1' })
    renderList()

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(stageSelect().value).toBe('client')

    const toast = screen.getByRole('status')
    expect(within(toast).getByText('Client file created.')).toBeTruthy()
    expect(within(toast).getByRole('link', { name: 'Open client file' })).toHaveProperty(
      'href',
      expect.stringContaining('/clients/client-1'),
    )
  })

  it('offers to link to the existing file on a 409 instead of showing a raw error', async () => {
    const user = userEvent.setup()
    mockFetch(409, { error: 'A client with this email already exists', clientId: 'client-9' })
    renderList()

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))

    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Link to existing file' })).toBeTruthy(),
    )
    // The route's own wording is never put in front of the user.
    expect(within(dialog).queryByText(/A client with this email already exists/)).toBeNull()
    expect(stageSelect().value).toBe('prospect')
  })

  it('links the lead to the existing file without creating a second one', async () => {
    const user = userEvent.setup()
    mockFetch(409, { error: 'exists', clientId: 'client-9' })
    renderList()

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))
    await user.click(await within(dialog).findByRole('button', { name: 'Link to existing file' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(stageSelect().value).toBe('client')
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('reports a failure and allows a retry when nothing was created', async () => {
    const user = userEvent.setup()
    mockFetch(500, { error: 'Failed to create client' })
    renderList()

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))

    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeTruthy(),
    )
    expect(within(dialog).getByText('Failed to create client')).toBeTruthy()
    expect(stageSelect().value).toBe('prospect')
  })

  it('says so, and offers no retry, when the file was created but the lead was not updated', async () => {
    const user = userEvent.setup()
    mockFetch(201, { id: 'client-1' })
    // The Stage 4 shape of this failure: the client file is created, then the
    // write that records it against the lead fails.
    renderList({
      conversion: async () => {
        throw new Error('lead update failed')
      },
    })

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))

    await waitFor(() =>
      expect(
        within(dialog).getByText(/Client file created, but this lead wasn.t updated/),
      ).toBeTruthy(),
    )

    // A second POST would create a duplicate client row, so there is no retry.
    expect(within(dialog).queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Convert' })).toBeNull()
    expect(within(dialog).getByRole('link', { name: /Open the client file/ })).toBeTruthy()
    expect(global.fetch).toHaveBeenCalledTimes(1)

    // The lead is left visibly unconverted rather than quietly marked done.
    expect(stageSelect().value).toBe('prospect')
  })
})

/**
 * The route now links the lead in the same request that creates the file. A
 * second request from the browser used to do it, and a page reload between the
 * two left a client file whose lead still said "lead" and still offered to
 * convert.
 */
describe('ConvertToClientDialog: the lead is linked by the create request', () => {
  it('sends the lead id with the create request, and nothing after it', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(201, {
      id: 'client-1',
      leadLinked: true,
      leadActivity: {
        id: '22222222-2222-4222-8222-222222222222',
        leadId: 'ld_1',
        type: 'stage_change',
        body: 'Converted to a client file in the restructuring workspace.',
        author: 'Gabby',
        createdAt: new Date().toISOString(),
      },
    })
    const conversion = vi.fn(async () => {})
    renderList({ conversion })

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/admin/clients')
    expect(JSON.parse(init.body as string).leadId).toBe('ld_1')
    // No second write for a reload to get between.
    expect(conversion).not.toHaveBeenCalled()
    expect(stageSelect().value).toBe('client')
  })

  it('still marks the lead itself when an older route did not', async () => {
    const user = userEvent.setup()
    mockFetch(201, { id: 'client-1' })
    const conversion = vi.fn(async () => {})
    renderList({ conversion })

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    expect(conversion).toHaveBeenCalledTimes(1)
    expect(stageSelect().value).toBe('client')
  })
})
