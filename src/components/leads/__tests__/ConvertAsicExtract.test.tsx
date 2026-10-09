import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConvertToClientDialog } from '../ConvertToClientDialog'
import { LeadsStoreProvider } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import { ASIC_PDF_MAX_BYTES, UPLOAD_MESSAGES } from '@/lib/asic/upload'
import type { AsicExtract } from '@/lib/asic/types'
import type { Lead } from '@/types/leads'

/**
 * The ASIC extract upload on the Convert to client dialog.
 *
 * The route is mocked with a SYNTHETIC extract — nobody real. What is under
 * test is what the dialog does with one: which fields it fills (the company's
 * only into empty boxes), which it must never touch (the lead's name, the
 * trust), the ACN question, undo, and what conversion then sends.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/leads',
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const LEAD = {
  id: 'ld_1',
  name: 'Dean Whitlock',
  email: 'dean@example.test',
  phone: '0400000001',
  entityType: 'company',
  stage: 'prospect',
  convertedClientId: null,
} as unknown as Lead

const EXTRACT: AsicExtract = {
  companyName: 'Sample Trading Pty Ltd',
  acn: '123456780',
  abn: '11123456780',
  status: 'Registered',
  registeredOffice: 'Unit 1, 10 Sample Road, North Melbourne VIC 3051',
  principalPlaceOfBusiness: 'Level 2, 20 Example Street, Sampleton NSW 2000',
  directors: [
    { name: 'Jane Sample', dateOfBirth: '1970-03-14' },
    { name: 'Raj Example', dateOfBirth: '1981-11-02' },
  ],
  extractType: 'current',
  extractedAt: '2026-09-23T14:07:38+10:00',
  warnings: [],
}

const REGISTERED = 'Registered office (optional)'
const PRINCIPAL = 'Principal place of business (optional)'
const UPLOAD = 'Upload ASIC extract (PDF)'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Answers the extract route and the create-client route; everything else (the register lookup) gets a 503. */
function mockRoutes(extract: { status: number; body: unknown } = { status: 200, body: { extract: EXTRACT } }) {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/asic/extract-pdf')) return json(extract.status, extract.body)
    if (url.startsWith('/api/admin/clients')) return json(201, { id: 'client-1' })
    return json(503, { error: 'not configured', configured: false })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function callsTo(fetchMock: ReturnType<typeof mockRoutes>, path: string) {
  return fetchMock.mock.calls.filter(([input]) => String(input).startsWith(path))
}

function pdf(size = 1024, type = 'application/pdf', name = 'extract.pdf') {
  const bytes = new Uint8Array(size)
  bytes.set(new TextEncoder().encode('%PDF-1.7\n'))
  return new File([bytes], name, { type })
}

function renderDialog() {
  render(
    <ToastProvider>
      <LeadsStoreProvider
        initialLeads={[LEAD]}
        initialActivities={[]}
        author="Gabby"
        persistence={{ markConverted: vi.fn(async () => {}) } as never}
      >
        <ConvertToClientDialog lead={LEAD} onClose={vi.fn()} />
      </LeadsStoreProvider>
    </ToastProvider>,
  )
  return screen.getByRole('dialog')
}

function field(dialog: HTMLElement, label: string) {
  return within(dialog).getByLabelText(label) as HTMLInputElement
}

async function uploadExtract(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, file = pdf()) {
  await user.upload(field(dialog, UPLOAD), file)
}

describe('Convert to client — labels', () => {
  it('calls the lead\'s name "Lead name", and has one client phone field', () => {
    mockRoutes()
    const dialog = renderDialog()

    expect(field(dialog, 'Lead name').value).toBe('Dean Whitlock')
    expect(within(dialog).queryByLabelText('Name')).toBeNull()
    expect(within(dialog).getAllByLabelText('Phone (optional)')).toHaveLength(1)
    // Exact, because other tests and staff both look for it by this name.
    expect(field(dialog, 'ACN')).toBeTruthy()
    expect(field(dialog, 'Company ABN')).toBeTruthy()
  })

  it('offers the upload, the two addresses and an empty director section', () => {
    mockRoutes()
    const dialog = renderDialog()

    expect(within(dialog).getByRole('button', { name: UPLOAD })).toBeTruthy()
    expect(field(dialog, REGISTERED).value).toBe('')
    expect(field(dialog, PRINCIPAL).value).toBe('')
    expect(within(dialog).getByRole('group', { name: 'Director' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Add director' })).toBeTruthy()
  })
})

describe('Convert to client — filling from an extract', () => {
  it('fills the addresses and one row per director, and says when the extract is from', async () => {
    const user = userEvent.setup()
    mockRoutes()
    const dialog = renderDialog()

    await uploadExtract(user, dialog)

    await waitFor(() => expect(field(dialog, REGISTERED).value).toBe(EXTRACT.registeredOffice))
    expect(field(dialog, PRINCIPAL).value).toBe(EXTRACT.principalPlaceOfBusiness)
    expect(field(dialog, 'Director 1 name').value).toBe('Jane Sample')
    expect(field(dialog, 'Director 1 date of birth').value).toBe('14/03/1970')
    expect(field(dialog, 'Director 2 name').value).toBe('Raj Example')
    expect(field(dialog, 'Director 2 date of birth').value).toBe('02/11/1981')
    expect(within(dialog).getByRole('group', { name: 'Directors' })).toBeTruthy()
    expect(within(dialog).getByRole('status').textContent).toContain(
      'Filled from ASIC extract dated 23 September 2026. Check the fields below.',
    )
  })

  it('fills an empty company name, ACN and ABN — and never the lead name', async () => {
    const user = userEvent.setup()
    mockRoutes()
    const dialog = renderDialog()

    await uploadExtract(user, dialog)
    await waitFor(() => expect(field(dialog, REGISTERED).value).not.toBe(''))

    expect(field(dialog, 'Lead name').value).toBe('Dean Whitlock')
    expect(field(dialog, 'Company name').value).toBe('Sample Trading Pty Ltd')
    expect(field(dialog, 'ACN').value).toBe('123456780')
    expect(field(dialog, 'Company ABN').value).toBe('11123456780')
    expect(within(dialog).getAllByText('Matches ASIC extract')).toHaveLength(3)
  })

  it('asks per field instead of overwriting a filled one — Use ASIC or Keep', async () => {
    const user = userEvent.setup()
    mockRoutes()
    const dialog = renderDialog()
    await user.type(field(dialog, 'Company name'), 'Sample Trading Co')
    await user.type(field(dialog, 'ACN'), '123456780')

    await uploadExtract(user, dialog)
    await waitFor(() => expect(field(dialog, REGISTERED).value).not.toBe(''))

    // Untouched until somebody chooses.
    expect(field(dialog, 'Company name').value).toBe('Sample Trading Co')
    const question = within(dialog).getByRole('group', {
      name: 'The ASIC extract has a different value',
    })
    expect(question.textContent).toContain('ASIC: Sample Trading Pty Ltd / Form: Sample Trading Co')

    await user.click(within(question).getByRole('button', { name: 'Use ASIC' }))
    expect(field(dialog, 'Company name').value).toBe('Sample Trading Pty Ltd')

    // Undo puts back what was typed, including the value Use ASIC replaced.
    await user.click(within(dialog).getByRole('button', { name: 'Undo fill' }))
    expect(field(dialog, 'Company name').value).toBe('Sample Trading Co')
  })

  it("keeps the form's value when told to", async () => {
    const user = userEvent.setup()
    mockRoutes()
    const dialog = renderDialog()
    await user.type(field(dialog, 'Company name'), 'Sample Trading Co')

    await uploadExtract(user, dialog)
    const question = await within(dialog).findByRole('group', {
      name: 'The ASIC extract has a different value',
    })
    await user.click(within(question).getByRole('button', { name: 'Keep' }))

    expect(field(dialog, 'Company name').value).toBe('Sample Trading Co')
    expect(within(dialog).getByText(/ASIC extract has/).textContent).toContain('Sample Trading Pty Ltd')
  })

  it('never fills the trust', async () => {
    const user = userEvent.setup()
    mockRoutes()
    const dialog = renderDialog()
    await user.selectOptions(field(dialog, 'Entity type'), 'trust')
    await user.type(field(dialog, 'Trust name'), 'Sample Family Trust')

    await uploadExtract(user, dialog)
    await waitFor(() => expect(field(dialog, REGISTERED).value).not.toBe(''))

    expect(field(dialog, 'Trust name').value).toBe('Sample Family Trust')
    expect(field(dialog, 'Trust ABN').value).toBe('')
  })

  it('an extract with no ABN leaves the company ABN alone and offers the trustee type', async () => {
    const user = userEvent.setup()
    mockRoutes({ status: 200, body: { extract: { ...EXTRACT, abn: null } } })
    const dialog = renderDialog()
    await user.type(field(dialog, 'Company ABN'), '51824753556')

    await uploadExtract(user, dialog)

    expect(
      await within(dialog).findByText(
        'No ABN on this extract. If this company is a trustee, add the trust below.',
      ),
    ).toBeTruthy()
    expect(field(dialog, 'Company ABN').value).toBe('51824753556')
    // Offered, not switched.
    expect(field(dialog, 'Entity type').value).toBe('company')

    await user.click(within(dialog).getByRole('button', { name: /^Switch to/ }))
    expect(field(dialog, 'Entity type').value).toBe('trust')
    expect(within(dialog).queryByText(/No ABN on this extract/)).toBeNull()
  })

  it('leaves every filled field editable', async () => {
    const user = userEvent.setup()
    mockRoutes()
    const dialog = renderDialog()
    await uploadExtract(user, dialog)
    await waitFor(() => expect(field(dialog, 'Director 1 name').value).toBe('Jane Sample'))

    await user.clear(field(dialog, REGISTERED))
    await user.type(field(dialog, REGISTERED), '1 Other Street')
    await user.clear(field(dialog, 'Director 2 date of birth'))
    await user.type(field(dialog, 'Director 2 date of birth'), '1981')

    expect(field(dialog, REGISTERED).value).toBe('1 Other Street')
    expect(field(dialog, 'Director 2 date of birth').value).toBe('1981')
  })

  it("shows the extract's warnings under the banner", async () => {
    const user = userEvent.setup()
    const warning = 'This is a Current & Historical extract. Only the current details were used.'
    mockRoutes({ status: 200, body: { extract: { ...EXTRACT, warnings: [warning] } } })
    const dialog = renderDialog()

    await uploadExtract(user, dialog)

    expect((await within(dialog).findByRole('status')).textContent).toContain(warning)
  })

  it('undoes the fill, putting back what was typed before', async () => {
    const user = userEvent.setup()
    mockRoutes()
    const dialog = renderDialog()
    await user.type(field(dialog, REGISTERED), '1 Typed Street')
    await user.click(within(dialog).getByRole('button', { name: 'Add director' }))
    await user.type(field(dialog, 'Director 1 name'), 'Typed Person')

    await uploadExtract(user, dialog)
    await waitFor(() => expect(field(dialog, 'Director 1 name').value).toBe('Jane Sample'))
    await user.click(within(dialog).getByRole('button', { name: 'Undo fill' }))

    expect(field(dialog, REGISTERED).value).toBe('1 Typed Street')
    expect(field(dialog, PRINCIPAL).value).toBe('')
    expect(field(dialog, 'Director 1 name').value).toBe('Typed Person')
    // The identity fields it filled go back to empty too.
    expect(field(dialog, 'Company name').value).toBe('')
    expect(field(dialog, 'ACN').value).toBe('')
    expect(field(dialog, 'Company ABN').value).toBe('')
    expect(within(dialog).queryByLabelText('Director 2 name')).toBeNull()
    expect(within(dialog).queryByRole('status')).toBeNull()
  })
})

describe('Convert to client — an extract for a different ACN', () => {
  it('asks before filling, and fills nothing until answered', async () => {
    const user = userEvent.setup()
    mockRoutes()
    const dialog = renderDialog()
    await user.type(field(dialog, 'ACN'), '000 000 019')

    await uploadExtract(user, dialog)

    const question = await within(dialog).findByRole('alertdialog')
    expect(question.textContent).toContain(
      'This extract is for Sample Trading Pty Ltd, ACN 123 456 780 — not the ACN on this form.',
    )
    expect(field(dialog, REGISTERED).value).toBe('')
    expect(within(dialog).queryByLabelText('Director 1 name')).toBeNull()
  })

  it('fills nothing on Cancel', async () => {
    const user = userEvent.setup()
    mockRoutes()
    const dialog = renderDialog()
    await user.type(field(dialog, 'ACN'), '000000019')
    await uploadExtract(user, dialog)

    const question = await within(dialog).findByRole('alertdialog')
    await user.click(within(question).getByRole('button', { name: 'Cancel' }))

    expect(within(dialog).queryByRole('alertdialog')).toBeNull()
    expect(field(dialog, REGISTERED).value).toBe('')
    expect(within(dialog).queryByRole('status')).toBeNull()
  })

  it("replaces the company details with the extract's when told to, and undo puts them back", async () => {
    const user = userEvent.setup()
    mockRoutes()
    const dialog = renderDialog()
    await user.type(field(dialog, 'Company name'), 'Other Co Pty Ltd')
    await user.type(field(dialog, 'ACN'), '000000019')
    await uploadExtract(user, dialog)

    const question = await within(dialog).findByRole('alertdialog')
    await user.click(
      within(question).getByRole('button', { name: /Replace company details with the extract/ }),
    )

    expect(field(dialog, REGISTERED).value).toBe(EXTRACT.registeredOffice)
    expect(field(dialog, 'Director 1 name').value).toBe('Jane Sample')
    expect(field(dialog, 'Company name').value).toBe('Sample Trading Pty Ltd')
    expect(field(dialog, 'ACN').value).toBe('123456780')
    expect(field(dialog, 'Company ABN').value).toBe('11123456780')

    await user.click(within(dialog).getByRole('button', { name: 'Undo fill' }))
    expect(field(dialog, 'Company name').value).toBe('Other Co Pty Ltd')
    expect(field(dialog, 'ACN').value).toBe('000000019')
  })

  it('warns when a different ACN is typed after the extract went in', async () => {
    // The upload is at the top of the form, so this is the usual order: the
    // question at upload time has nothing to compare with yet.
    const user = userEvent.setup()
    mockRoutes()
    const dialog = renderDialog()
    await uploadExtract(user, dialog)
    await waitFor(() => expect(field(dialog, REGISTERED).value).toBe(EXTRACT.registeredOffice))
    expect(within(dialog).queryByRole('alert')).toBeNull()

    // The extract filled the empty ACN; somebody then changes it.
    await user.clear(field(dialog, 'ACN'))
    await user.type(field(dialog, 'ACN'), '000 000 019')

    expect(within(dialog).getByRole('alert').textContent).toContain(
      'This extract is for Sample Trading Pty Ltd, ACN 123 456 780, which is not the ACN on this form.',
    )
    // Still the typed ACN, and the fill is still there to check or undo.
    expect(field(dialog, 'ACN').value).toBe('000 000 019')
    expect(field(dialog, REGISTERED).value).toBe(EXTRACT.registeredOffice)
  })

  it('does not warn when the ACN typed afterwards is the extract\'s own', async () => {
    const user = userEvent.setup()
    mockRoutes()
    const dialog = renderDialog()
    await uploadExtract(user, dialog)
    await waitFor(() => expect(field(dialog, REGISTERED).value).toBe(EXTRACT.registeredOffice))

    await user.clear(field(dialog, 'ACN'))
    await user.type(field(dialog, 'ACN'), '123 456 780')

    expect(within(dialog).queryByRole('alert')).toBeNull()
  })

  it('puts the upload first in the form, above the lead name', () => {
    mockRoutes()
    const dialog = renderDialog()
    const upload = within(dialog).getByRole('button', { name: UPLOAD })
    const leadName = field(dialog, 'Lead name')
    expect(
      upload.compareDocumentPosition(leadName) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('does not ask when the ACN matches, however it was spaced', async () => {
    const user = userEvent.setup()
    mockRoutes()
    const dialog = renderDialog()
    await user.type(field(dialog, 'ACN'), '123 456 780')

    await uploadExtract(user, dialog)

    await waitFor(() => expect(field(dialog, REGISTERED).value).toBe(EXTRACT.registeredOffice))
    expect(within(dialog).queryByRole('alertdialog')).toBeNull()
  })
})

describe('Convert to client — uploads that are refused', () => {
  it('refuses a file over 4 MB in the browser, without sending it', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    const dialog = renderDialog()

    await uploadExtract(user, dialog, pdf(ASIC_PDF_MAX_BYTES + 1))

    expect((await within(dialog).findByRole('alert')).textContent).toContain(UPLOAD_MESSAGES.tooLarge)
    expect(callsTo(fetchMock, '/api/asic/extract-pdf')).toHaveLength(0)
  })

  it('refuses a file that is not a PDF in the browser, without sending it', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const fetchMock = mockRoutes()
    const dialog = renderDialog()

    await uploadExtract(user, dialog, pdf(1024, 'image/png', 'scan.png'))

    expect((await within(dialog).findByRole('alert')).textContent).toContain(UPLOAD_MESSAGES.notPdf)
    expect(callsTo(fetchMock, '/api/asic/extract-pdf')).toHaveLength(0)
  })

  it("shows the route's own message, and fills nothing", async () => {
    const user = userEvent.setup()
    const message = 'This PDF has no readable text. Fill the fields in by hand.'
    mockRoutes({ status: 422, body: { error: message, reason: 'no_text' } })
    const dialog = renderDialog()

    await uploadExtract(user, dialog)

    expect((await within(dialog).findByRole('alert')).textContent).toContain(message)
    expect(field(dialog, REGISTERED).value).toBe('')
  })

  it('copes with an answer that is not JSON', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Request Entity Too Large</html>', { status: 413 })),
    )
    const dialog = renderDialog()

    await uploadExtract(user, dialog)

    expect((await within(dialog).findByRole('alert')).textContent).toContain(UPLOAD_MESSAGES.tooLarge)
  })
})

describe('Convert to client — directors by hand', () => {
  it('adds and removes rows', async () => {
    const user = userEvent.setup()
    mockRoutes()
    const dialog = renderDialog()

    await user.click(within(dialog).getByRole('button', { name: 'Add director' }))
    await user.click(within(dialog).getByRole('button', { name: 'Add director' }))
    await user.type(field(dialog, 'Director 1 name'), 'First Person')
    await user.type(field(dialog, 'Director 2 name'), 'Second Person')
    await user.click(within(dialog).getByRole('button', { name: 'Remove director 1' }))

    expect(field(dialog, 'Director 1 name').value).toBe('Second Person')
    expect(within(dialog).queryByLabelText('Director 2 name')).toBeNull()
  })

  it('still converts with a date of birth it cannot read, sending the director without it', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    const dialog = renderDialog()
    await user.click(within(dialog).getByRole('button', { name: 'Add director' }))
    await user.type(field(dialog, 'Director 1 name'), 'Jane Sample')
    await user.type(field(dialog, 'Director 1 date of birth'), '14 March 1970')

    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))

    await waitFor(() => expect(callsTo(fetchMock, '/api/admin/clients')).toHaveLength(1))
    const [[, init]] = callsTo(fetchMock, '/api/admin/clients') as [string, RequestInit][]
    expect(JSON.parse(init.body as string).companyDetails.directors).toEqual([
      { name: 'Jane Sample', dateOfBirth: null },
    ])
  })
})

describe('Convert to client — what conversion sends', () => {
  async function convert(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement,
    fetchMock: ReturnType<typeof mockRoutes>,
  ) {
    // Only into empty boxes: after an upload the extract has filled them.
    for (const [label, value] of [
      ['Company name', 'Sample Trading Pty Ltd'],
      ['ACN', '123456780'],
      ['Company ABN', '11123456780'],
    ]) {
      if (!field(dialog, label).value) await user.type(field(dialog, label), value)
    }
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))
    await waitFor(() => expect(callsTo(fetchMock, '/api/admin/clients')).toHaveLength(1))
    const [, init] = callsTo(fetchMock, '/api/admin/clients')[0]
    return JSON.parse(init?.body as string)
  }

  it("sends the extract's fields as 'asic_pdf' when saved as filled", async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    const dialog = renderDialog()
    await uploadExtract(user, dialog)
    await waitFor(() => expect(field(dialog, 'Director 1 name').value).toBe('Jane Sample'))

    const sent = await convert(user, dialog, fetchMock)

    expect(sent.name).toBe('Dean Whitlock')
    expect(sent.companyDetails).toMatchObject({
      companyName: 'Sample Trading Pty Ltd',
      registeredOfficeAddress: EXTRACT.registeredOffice,
      principalPlaceOfBusiness: EXTRACT.principalPlaceOfBusiness,
      directors: [
        { name: 'Jane Sample', dateOfBirth: '1970-03-14' },
        { name: 'Raj Example', dateOfBirth: '1981-11-02' },
      ],
      asicExtractDate: '2026-09-23T14:07:38+10:00',
      companyDetailsSource: 'asic_pdf',
    })
  })

  it("sends 'asic_pdf_edited', keeping the extract's date, when a filled field was changed", async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    const dialog = renderDialog()
    await uploadExtract(user, dialog)
    await waitFor(() => expect(field(dialog, 'Director 1 name').value).toBe('Jane Sample'))
    await user.click(within(dialog).getByRole('button', { name: 'Remove director 2' }))

    const sent = await convert(user, dialog, fetchMock)

    expect(sent.companyDetails.directors).toEqual([{ name: 'Jane Sample', dateOfBirth: '1970-03-14' }])
    expect(sent.companyDetails.asicExtractDate).toBe('2026-09-23T14:07:38+10:00')
    expect(sent.companyDetails.companyDetailsSource).toBe('asic_pdf_edited')
  })

  it("sends 'manual' for fields typed by hand, with a partial date of birth as ISO", async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    const dialog = renderDialog()
    await user.type(field(dialog, REGISTERED), '1 Typed Street')
    await user.click(within(dialog).getByRole('button', { name: 'Add director' }))
    await user.type(field(dialog, 'Director 1 name'), 'Typed Person')
    await user.type(field(dialog, 'Director 1 date of birth'), '03/1970')

    const sent = await convert(user, dialog, fetchMock)

    expect(sent.companyDetails).toMatchObject({
      registeredOfficeAddress: '1 Typed Street',
      directors: [{ name: 'Typed Person', dateOfBirth: '1970-03' }],
      asicExtractDate: null,
      companyDetailsSource: 'manual',
    })
  })

  it('converts with no upload and none of the new fields', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    const dialog = renderDialog()

    const sent = await convert(user, dialog, fetchMock)

    expect(callsTo(fetchMock, '/api/asic/extract-pdf')).toHaveLength(0)
    expect(sent.companyDetails).toMatchObject({
      registeredOfficeAddress: '',
      principalPlaceOfBusiness: '',
      directors: [],
      asicExtractDate: null,
      companyDetailsSource: null,
    })
  })
})
