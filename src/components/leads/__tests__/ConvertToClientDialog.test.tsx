import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeadsPageClient } from '../LeadsPageClient'
import { LeadsStoreProvider, type LeadsPersistence } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import { EMPTY_FILTERS } from '@/lib/leads/filter'
import type { Lead, LeadSubmission } from '@/types/leads'

/**
 * Conversion, driven through the real list so the whole path is exercised:
 * stage select → the lead's enquiries read → confirmation → POST → store
 * update → toast. Since 0052 an enquiry, not the lead, becomes the file.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/leads',
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Opening the dialog reads the lead's enquiries; a case that sends nothing
// still needs that answered. Cases that check what is sent stub their own.
beforeEach(() => {
  mockFetch(201, { id: 'client-1', leadLinked: true })
})

const LEAD: Lead = {
  id: 'ld_1',
  name: 'Dean Whitlock',
  email: 'dean@whitlockcivil.example.com.au',
  phone: '0407552118',
  debtMin: 100_000,
  debtMax: 124_999,
  entityType: 'company',
  message: null,
  preferredCallTime: null,
  state: 'QLD',
  stage: 'prospect',
  source: 'google_form',
  sourceLabel: null,
  entityTypeLabel: null,
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

function enquiry(overrides: Partial<LeadSubmission> = {}): LeadSubmission {
  return {
    id: 'sub_1',
    leadId: 'ld_1',
    receivedAt: '2026-08-26T01:00:00.000Z',
    afterClose: false,
    convertedClientId: null,
    name: 'Dean Whitlock',
    email: 'dean@whitlockcivil.example.com.au',
    phone: '0407552118',
    debtMin: 100_000,
    debtMax: 124_999,
    state: 'QLD',
    metaStateRaw: null,
    metaStateOptions: null,
    entityType: 'company',
    message: null,
    preferredCallTime: null,
    source: 'google_form',
    metaFormId: null,
    metaAdId: null,
    metaCampaignName: null,
    metaAdName: null,
    ...overrides,
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * The lead's enquiries for the GET the dialog makes on opening; `status` and
 * `body` for everything else (the create request). Returns the spy, so a
 * caller can assert on what was actually sent.
 */
function mockFetch(status: number, body: unknown, enquiries: LeadSubmission[] = [enquiry()]) {
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith('/enquiries') ? json(200, { enquiries }) : json(status, body),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** The create requests sent, as [url, init]. */
function creates(fetchMock: ReturnType<typeof mockFetch>) {
  return (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url === '/api/admin/clients')
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

/** Opens conversion on a lead with two or more enquiries: the pick step comes first. */
async function pickEnquiry(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(stageSelect(), 'client')
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByRole('button', { name: 'Continue' })
  return dialog
}

async function openConversion(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(stageSelect(), 'client')
  const dialog = await screen.findByRole('dialog')
  // The enquiries are read first; the form follows.
  await within(dialog).findByLabelText('Lead name')
  return dialog
}

/**
 * Fill in the company details. None of them is required to convert; these
 * cases just want a realistic form to send.
 */
async function fillRequired(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
) {
  // Synthetic numbers that pass their check digits: the company's own ABN is
  // 11 + its ACN. Pasted, not typed: these cases are about what happens after
  // Convert, and typing re-renders the whole dialog on every keystroke, which
  // under a full parallel run took them past the timeout.
  for (const [label, value] of [
    ['Company name', 'Whitlock Civil Pty Ltd'],
    ['ACN', '123456780'],
    ['Company ABN', '11123456780'],
  ] as const) {
    await user.click(within(dialog).getByLabelText(label))
    await user.paste(value)
  }
}

/**
 * For the cases built on openAndFill: they render the leads table and the
 * full conversion dialog, then drive it. Comfortably inside this alone, but
 * a full parallel run on a laptop has taken them past the 20s default.
 */
const SLOW = { timeout: 60_000 }

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
      'dean@whitlockcivil.example.com.au',
    )
    expect(within(dialog).getByRole('button', { name: 'Convert' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it("starts the company phone and email as the lead's own, editable", async () => {
    const user = userEvent.setup()
    renderList()

    const dialog = await openConversion(user)
    const phone = within(dialog).getByLabelText('Company phone (optional)') as HTMLInputElement
    const email = within(dialog).getByLabelText('Company email (optional)') as HTMLInputElement
    expect(phone.value).toBe('0407 552 118')
    expect(email.value).toBe('dean@whitlockcivil.example.com.au')

    await user.clear(email)
    await user.type(email, 'accounts@whitlockcivil.example.com.au')
    expect(email.value).toBe('accounts@whitlockcivil.example.com.au')
  })

  it('reads the enquiries but creates nothing until Convert is pressed', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(201, { id: 'client-1', leadLinked: true })
    renderList()

    await openConversion(user)
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/leads/ld_1/enquiries')
    expect(creates(fetchMock)).toHaveLength(0)
    expect(stageSelect().value).toBe('prospect')
  })

  it('converts with nothing filled in — no field is required', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(201, { id: 'client-1', leadLinked: true })
    renderList()

    const dialog = await openConversion(user)
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))

    const calls = () => fetchMock.mock.calls as unknown as [string, RequestInit][]
    await waitFor(() => expect(calls().some(([url]) => url === '/api/admin/clients')).toBe(true))
    const [, init] = calls().find(([url]) => url === '/api/admin/clients')!
    const sent = JSON.parse(init.body as string)
    expect(sent.name).toBe('Dean Whitlock')
    expect(sent.email).toBe('dean@whitlockcivil.example.com.au')
    expect(sent.companyDetails).toMatchObject({ companyName: '', acnNumber: '', abnNumber: '' })
    expect(within(dialog).queryByText('Enter the company name.')).toBeNull()
  })

  it('converts a trustee with no company or trust details', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(201, { id: 'client-1', leadLinked: true })
    renderList()

    const dialog = await openConversion(user)
    await user.selectOptions(within(dialog).getByLabelText('Entity type'), 'trust')
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))

    const calls = () => fetchMock.mock.calls as unknown as [string, RequestInit][]
    await waitFor(() => expect(calls().some(([url]) => url === '/api/admin/clients')).toBe(true))
    const [, init] = calls().find(([url]) => url === '/api/admin/clients')!
    expect(JSON.parse(init.body as string).companyDetails).toMatchObject({
      entityType: 'trust',
      trustName: '',
      trustAbnNumber: '',
    })
  })

  it("falls back to the lead's own name and email when those boxes are cleared", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(201, { id: 'client-1', leadLinked: true })
    renderList()

    const dialog = await openConversion(user)
    await user.clear(within(dialog).getByLabelText('Lead name'))
    await user.clear(within(dialog).getByLabelText('Email'))
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))

    const calls = () => fetchMock.mock.calls as unknown as [string, RequestInit][]
    await waitFor(() => expect(calls().some(([url]) => url === '/api/admin/clients')).toBe(true))
    const [, init] = calls().find(([url]) => url === '/api/admin/clients')!
    const sent = JSON.parse(init.body as string)
    expect(sent.name).toBe('Dean Whitlock')
    expect(sent.email).toBe('dean@whitlockcivil.example.com.au')
  })

  it('offers Company and Trust, and shows the Trust section for both — optional for a company', async () => {
    const user = userEvent.setup()
    renderList()

    const dialog = await openConversion(user)
    const select = within(dialog).getByLabelText('Entity type') as HTMLSelectElement
    expect([...select.options].map((option) => option.textContent)).toEqual(['Company', 'Trust'])
    expect(within(dialog).getByLabelText('Trust name')).toBeTruthy()
    expect(within(dialog).getByLabelText('Trust ABN')).toBeTruthy()
    expect(within(dialog).getByText(/Fill it in if the company acts as trustee of a trust/)).toBeTruthy()

    await user.selectOptions(select, 'trust')
    expect(within(dialog).getByLabelText('Trust name')).toBeTruthy()
    expect(within(dialog).queryByText(/Fill it in if the company acts as trustee of a trust/)).toBeNull()
  })

  it('converts a Company with no trust, and sends a trust typed for one', SLOW, async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(201, { id: 'client-1' })
    renderList()

    const dialog = await openAndFill(user)
    await user.type(within(dialog).getByLabelText('Trust name'), 'Whitlock Family Trust')
    await user.type(within(dialog).getByLabelText('Trust ABN'), '51824753556')
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))

    const calls = () => fetchMock.mock.calls as unknown as [string, RequestInit][]
    await waitFor(() => expect(calls().some(([url]) => url === '/api/admin/clients')).toBe(true))
    const [, init] = calls().find(([url]) => url === '/api/admin/clients')!
    expect(JSON.parse(init.body as string).companyDetails).toMatchObject({
      entityType: 'company',
      abnNumber: '11123456780',
      trustName: 'Whitlock Family Trust',
      trustAbnNumber: '51824753556',
    })
  })

  it('does not check the numbers typed — they are sent as they are', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(201, { id: 'client-1', leadLinked: true })
    renderList()

    const dialog = await openConversion(user)
    await user.type(within(dialog).getByLabelText('ACN'), '12345')
    await user.type(within(dialog).getByLabelText('Trust ABN'), '11123456780')
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))

    const calls = () => fetchMock.mock.calls as unknown as [string, RequestInit][]
    await waitFor(() => expect(calls().some(([url]) => url === '/api/admin/clients')).toBe(true))
    const [, init] = calls().find(([url]) => url === '/api/admin/clients')!
    expect(JSON.parse(init.body as string).companyDetails).toMatchObject({
      acnNumber: '12345',
      trustAbnNumber: '11123456780',
    })
  })

  it('puts the trust straight under the company ABN, before the registered office', async () => {
    const user = userEvent.setup()
    renderList()

    const dialog = await openConversion(user)
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const companyAbn = within(dialog).getByLabelText('Company ABN')
    const trust = within(dialog).getByRole('group', { name: 'Trust' })
    const registered = within(dialog).getByLabelText('Registered office (optional)')

    expect(follows(companyAbn, trust)).toBe(true)
    expect(follows(trust, registered)).toBe(true)
    expect(within(trust).getByLabelText('Trust name')).toBeTruthy()
    expect(within(trust).getByLabelText('Trust ABN')).toBeTruthy()
  })

  it('has an "Enter manually" checkbox for each section', async () => {
    const user = userEvent.setup()
    renderList()

    const dialog = await openConversion(user)
    await user.selectOptions(within(dialog).getByLabelText('Entity type'), 'trust')
    const boxes = within(dialog).getAllByLabelText("Enter manually (don’t search ABN Lookup)")
    expect(boxes).toHaveLength(2)
    await user.click(boxes[1])
    expect((boxes[0] as HTMLInputElement).checked).toBe(false)
    expect((boxes[1] as HTMLInputElement).checked).toBe(true)
  })

  it("moves a trust's ABN out of the company ABN, and offers the trustee type", async () => {
    const user = userEvent.setup()
    renderList()

    const dialog = await openConversion(user)
    await user.type(within(dialog).getByLabelText('ACN'), '123456780')
    await user.type(within(dialog).getByLabelText('Company ABN'), '51824753556')
    await user.click(within(dialog).getByRole('button', { name: 'Move to trust ABN' }))

    expect((within(dialog).getByLabelText('Company ABN') as HTMLInputElement).value).toBe('')
    expect(within(dialog).getByText(/Moved to the trust ABN/)).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: /^Switch to/ }))
    expect((within(dialog).getByLabelText('Trust ABN') as HTMLInputElement).value).toBe(
      '51824753556',
    )
  })

  it('sends a trustee with both ABNs kept apart', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(201, { id: 'client-1' })
    renderList()

    const dialog = await openConversion(user)
    await user.selectOptions(within(dialog).getByLabelText('Entity type'), 'trust')
    await user.type(within(dialog).getByLabelText('Company name'), 'Whitlock Holdings Pty Ltd')
    await user.type(within(dialog).getByLabelText('ACN'), '123456780')
    await user.type(within(dialog).getByLabelText('Trust name'), 'Whitlock Family Trust')
    await user.type(within(dialog).getByLabelText('Trust ABN'), '51824753556')
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))

    const calls = () => fetchMock.mock.calls as unknown as [string, RequestInit][]
    await waitFor(() => expect(calls().some(([url]) => url === '/api/admin/clients')).toBe(true))
    const [, init] = calls().find(([url]) => url === '/api/admin/clients')!
    expect(JSON.parse(init.body as string).companyDetails).toMatchObject({
      entityType: 'trust',
      companyName: 'Whitlock Holdings Pty Ltd',
      acnNumber: '123456780',
      abnNumber: '',
      trustName: 'Whitlock Family Trust',
      trustAbnNumber: '51824753556',
    })
  })

  it('links to the ACN and ABN registers in a new tab, opening a typed ABN directly', async () => {
    const user = userEvent.setup()
    renderList()

    const dialog = await openConversion(user)
    const asic = within(dialog).getByRole('link', {
      name: 'Check or find an ACN (opens in a new tab)',
    })
    // The company ABN's link; the trust ABN has its own further down.
    const [abr] = within(dialog).getAllByRole('link', {
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

    await user.type(within(dialog).getByLabelText('Company ABN'), '51 824 753 556')
    expect(abr.getAttribute('href')).toBe('https://abr.business.gov.au/ABN/View?abn=51824753556')
  })

  it('sends the details with the client so intake opens filled in', SLOW, async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(201, { id: 'client-1' })
    renderList()

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))

    await waitFor(() => expect(creates(fetchMock)).toHaveLength(1))
    const [, init] = creates(fetchMock)[0]
    const sent = JSON.parse(init.body as string)
    expect(sent.companyDetails).toMatchObject({
      entityType: 'company',
      companyName: 'Whitlock Civil Pty Ltd',
      acnNumber: '123456780',
      abnNumber: '11123456780',
      trustAbnNumber: '',
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

  it('creates the file, moves the lead to client and offers a link', SLOW, async () => {
    const user = userEvent.setup()
    mockFetch(201, { id: 'client-1', leadLinked: true })
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

  it('says so when the enquiry already has a client file, creating nothing more', SLOW, async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(409, { error: 'This enquiry already has a client file', clientId: 'client-9' })
    renderList()

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))

    expect(await within(dialog).findByText('This enquiry already has a client file')).toBeTruthy()
    expect(creates(fetchMock)).toHaveLength(1)
    expect(stageSelect().value).toBe('prospect')
  })

  it('reports a failure and allows a retry when nothing was created', SLOW, async () => {
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

  it('says so, and offers no retry, when the file was created but the lead was not updated', SLOW, async () => {
    const user = userEvent.setup()
    // The file is created, but the route does not say the lead was updated.
    const fetchMock = mockFetch(201, { id: 'client-1' })
    renderList()

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
    expect(creates(fetchMock)).toHaveLength(1)

    // The lead is left visibly unconverted rather than quietly marked done.
    expect(stageSelect().value).toBe('prospect')
  })
})

/**
 * The route links the enquiry and its lead in the same request that creates
 * the file, so nothing is sent after it for a reload to get between.
 */
describe('ConvertToClientDialog: an enquiry becomes the file (0052)', () => {
  it('sends the enquiry id with the create request, and nothing after it', SLOW, async () => {
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
    renderList()

    const dialog = await openAndFill(user)
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const sent = creates(fetchMock)
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0][1].body as string)).toMatchObject({ enquiryId: 'sub_1' })
    expect(JSON.parse(sent[0][1].body as string)).not.toHaveProperty('leadId')
    // Nothing after the create.
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/admin/clients')
    expect(stageSelect().value).toBe('client')
  })

  it('asks which enquiry first, starting on the newest without a file, then fills in what it said', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(201, { id: 'client-2', leadLinked: true }, [
      enquiry({ id: 'sub_2', receivedAt: '2026-10-05T01:00:00.000Z', name: 'Dean W', phone: '0400000002', source: 'facebook' }),
      enquiry({ id: 'sub_1', convertedClientId: 'client-1' }),
    ])
    renderList()

    let dialog = await pickEnquiry(user)
    expect((within(dialog).getAllByRole('radio')[0] as HTMLInputElement).checked).toBe(true)
    expect((within(dialog).getAllByRole('radio')[1] as HTMLInputElement).disabled).toBe(true)
    expect(within(dialog).getByText('Already has a client file')).toBeTruthy()
    expect(within(dialog).queryByLabelText('Lead name')).toBeNull()
    expect(creates(fetchMock)).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
    dialog = await screen.findByRole('dialog')
    await within(dialog).findByLabelText('Lead name')
    expect((within(dialog).getByLabelText('Lead name') as HTMLInputElement).value).toBe('Dean W')
    expect(within(dialog).getByText('This lead already has 1 client file.', { exact: false })).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))
    await waitFor(() => expect(creates(fetchMock)).toHaveLength(1))
    expect(JSON.parse(creates(fetchMock)[0][1].body as string)).toMatchObject({ enquiryId: 'sub_2', name: 'Dean W' })
  })

  it('lets staff pick between two enquiries without files, never one that has a file', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(201, { id: 'client-3', leadLinked: true }, [
      enquiry({ id: 'sub_3', receivedAt: '2026-10-05T01:00:00.000Z', name: 'Newest Name' }),
      enquiry({ id: 'sub_2', receivedAt: '2026-09-05T01:00:00.000Z', name: 'Older Name' }),
      enquiry({ id: 'sub_1', convertedClientId: 'client-1' }),
    ])
    renderList()

    let dialog = await pickEnquiry(user)
    const radios = within(dialog).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((r) => r.value)).toEqual(['sub_3', 'sub_2', 'sub_1'])
    expect(radios[0].checked).toBe(true)
    expect(radios[2].disabled).toBe(true)

    await user.click(radios[1])
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
    dialog = await screen.findByRole('dialog')
    expect(((await within(dialog).findByLabelText('Lead name')) as HTMLInputElement).value).toBe('Older Name')

    // Change goes back to the pick step, keeping what was picked.
    await user.click(within(dialog).getByRole('button', { name: 'Change' }))
    dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByRole('radio', { checked: true }) as HTMLInputElement).value).toBe('sub_2')
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
    dialog = await screen.findByRole('dialog')
    await within(dialog).findByLabelText('Lead name')

    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))
    await waitFor(() => expect(creates(fetchMock)).toHaveLength(1))
    expect(JSON.parse(creates(fetchMock)[0][1].body as string)).toMatchObject({ enquiryId: 'sub_2' })
  })

  it('goes straight to the form when the lead has one enquiry', async () => {
    const user = userEvent.setup()
    mockFetch(201, { id: 'client-1', leadLinked: true })
    renderList()

    const dialog = await openConversion(user)
    expect(within(dialog).queryByRole('radio', { name: /enquiry/i })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Continue' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Change' })).toBeNull()
  })

  it('offers nothing to convert when every enquiry already has its file', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(201, { id: 'client-9', leadLinked: true }, [
      enquiry({ id: 'sub_1', convertedClientId: 'client-1' }),
    ])
    renderList()

    await user.selectOptions(stageSelect(), 'client')
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/Every enquiry from this lead already has a client file/)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Convert' })).toBeNull()
    expect(within(dialog).queryByLabelText('Lead name')).toBeNull()
    expect(creates(fetchMock)).toHaveLength(0)
  })
})
