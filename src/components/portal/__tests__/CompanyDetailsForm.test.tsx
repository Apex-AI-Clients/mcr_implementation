import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CompanyDetailsForm, type CompanyDetails } from '../CompanyDetailsForm'
import type { AsicExtract } from '@/lib/asic/types'

/**
 * The intake company step, and the ASIC fields on it.
 *
 * This is where a client converted before the upload existed gets their
 * registered office, principal place of business and directors — typed, or
 * filled from the extract PDF. SYNTHETIC data throughout.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const EXTRACT_DATE = '2026-09-23T14:07:38+10:00'

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
  extractedAt: EXTRACT_DATE,
  warnings: [],
}

/** A client converted before the ASIC fields existed. */
const BEFORE: CompanyDetails = {
  id: 'cd_1',
  clientId: 'cl_1',
  companyName: 'Older Client Pty Ltd',
  acnNumber: '123456780',
  abnNumber: '11123456780',
  trustName: '',
  phoneNumber: '0390000000',
  emailAddress: 'accounts@example.test',
}

/** One whose fields came from an extract at conversion, saved unchanged. */
const FROM_EXTRACT: CompanyDetails = {
  ...BEFORE,
  registeredOfficeAddress: EXTRACT.registeredOffice,
  principalPlaceOfBusiness: EXTRACT.principalPlaceOfBusiness,
  directors: EXTRACT.directors,
  asicExtractDate: EXTRACT_DATE,
  companyDetailsSource: 'asic_pdf',
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

function mockRoutes() {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async (input) => {
      const url = String(input)
      if (url.startsWith('/api/asic/extract-pdf')) return json(200, { extract: EXTRACT })
      if (url.startsWith('/api/portal/company-details')) return json(200, { success: true })
      return json(503, { error: 'not configured', configured: false })
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function field(label: string) {
  return screen.getByLabelText(label) as HTMLInputElement
}

function pdf() {
  return new File([new TextEncoder().encode('%PDF-1.7\n')], 'extract.pdf', {
    type: 'application/pdf',
  })
}

/** Save, and return the body sent to the company-details route. */
async function save(user: ReturnType<typeof userEvent.setup>, fetchMock: ReturnType<typeof mockRoutes>) {
  await user.click(screen.getByRole('button', { name: 'Save Details' }))
  const sent = () =>
    fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/portal/company-details'))
  await waitFor(() => expect(sent().length).toBeGreaterThan(0))
  const [, init] = sent()[sent().length - 1]
  return JSON.parse(init?.body as string)
}

describe('CompanyDetailsForm — a client converted before the ASIC fields existed', () => {
  it('shows the new fields empty and editable, with the upload', () => {
    mockRoutes()
    render(<CompanyDetailsForm clientId="cl_1" initial={BEFORE} />)

    expect(field(REGISTERED).value).toBe('')
    expect(field(PRINCIPAL).value).toBe('')
    expect(screen.getByRole('group', { name: 'Director' })).toBeTruthy()
    expect(screen.getByRole('button', { name: UPLOAD })).toBeTruthy()
    expect(screen.queryByText(/From ASIC extract/)).toBeNull()
  })

  it('fills the addresses and directors, asks about a different company name, and leaves phone and email alone', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    render(<CompanyDetailsForm clientId="cl_1" initial={BEFORE} />)

    await user.upload(field(UPLOAD), pdf())
    await waitFor(() => expect(field(REGISTERED).value).toBe(EXTRACT.registeredOffice))

    expect(field('Director 2 name').value).toBe('Raj Example')
    // A filled box is compared, never overwritten without asking.
    expect(field('Company name').value).toBe('Older Client Pty Ltd')
    expect(
      screen.getByRole('group', { name: 'The ASIC extract has a different value' }).textContent,
    ).toContain('ASIC: Sample Trading Pty Ltd / Form: Older Client Pty Ltd')
    expect(screen.getAllByText('Matches ASIC extract')).toHaveLength(2)
    expect(screen.getByText(/Filled from ASIC extract dated 23 September 2026/)).toBeTruthy()

    expect(await save(user, fetchMock)).toEqual({
      clientId: 'cl_1',
      entityType: 'company',
      companyName: 'Older Client Pty Ltd',
      acnNumber: '123456780',
      abnNumber: '11123456780',
      trustName: '',
      trustAbnNumber: '',
      phoneNumber: '0390000000',
      emailAddress: 'accounts@example.test',
      registeredOfficeAddress: EXTRACT.registeredOffice,
      principalPlaceOfBusiness: EXTRACT.principalPlaceOfBusiness,
      directors: EXTRACT.directors,
      asicExtractDate: EXTRACT_DATE,
      companyDetailsSource: 'asic_pdf',
    })
    // Saved: the banner gives way to the line a saved record carries.
    expect(await screen.findByText('From ASIC extract as at 23 September 2026')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Undo fill' })).toBeNull()
  })

  it('asks before using an extract for a different ACN', async () => {
    const user = userEvent.setup()
    mockRoutes()
    render(<CompanyDetailsForm clientId="cl_1" initial={{ ...BEFORE, acnNumber: '000000019' }} />)

    await user.upload(field(UPLOAD), pdf())

    expect((await screen.findByRole('alertdialog')).textContent).toContain(
      'This extract is for Sample Trading Pty Ltd, ACN 123 456 780 — not the ACN on this form.',
    )
    expect(field(REGISTERED).value).toBe('')
    expect(field('ACN').value).toBe('000000019')
  })

  it("saves fields typed by hand as 'manual', with a year-only date of birth", async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    render(<CompanyDetailsForm clientId="cl_1" initial={BEFORE} />)

    await user.type(field(PRINCIPAL), '1 Typed Street')
    await user.click(screen.getByRole('button', { name: 'Add director' }))
    await user.type(field('Director 1 name'), 'Typed Person')
    await user.type(field('Director 1 date of birth'), '1970')

    expect(await save(user, fetchMock)).toMatchObject({
      registeredOfficeAddress: '',
      principalPlaceOfBusiness: '1 Typed Street',
      directors: [{ name: 'Typed Person', dateOfBirth: '1970' }],
      asicExtractDate: null,
      companyDetailsSource: 'manual',
    })
  })

  it('still saves with a date of birth it cannot read, without the date', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    render(<CompanyDetailsForm clientId="cl_1" initial={BEFORE} />)

    await user.click(screen.getByRole('button', { name: 'Add director' }))
    await user.type(field('Director 1 name'), 'Typed Person')
    await user.type(field('Director 1 date of birth'), 'March 1970')

    expect((await save(user, fetchMock)).directors).toEqual([
      { name: 'Typed Person', dateOfBirth: null },
    ])
  })
})

describe('CompanyDetailsForm — a record that came from an extract', () => {
  it('opens with its addresses, directors and where they came from', () => {
    mockRoutes()
    render(<CompanyDetailsForm clientId="cl_1" initial={FROM_EXTRACT} />)

    expect(field(REGISTERED).value).toBe(EXTRACT.registeredOffice)
    expect(field('Director 1 name').value).toBe('Jane Sample')
    expect(field('Director 1 date of birth').value).toBe('14/03/1970')
    expect(screen.getByRole('group', { name: 'Directors' })).toBeTruthy()
    expect(screen.getByText('From ASIC extract as at 23 September 2026')).toBeTruthy()
  })

  it("stays 'asic_pdf' when something else on the form is edited", async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    render(<CompanyDetailsForm clientId="cl_1" initial={FROM_EXTRACT} />)

    await user.clear(field('Company phone'))
    await user.type(field('Company phone'), '0391111111')

    expect(await save(user, fetchMock)).toMatchObject({
      phoneNumber: '0391111111',
      directors: EXTRACT.directors,
      asicExtractDate: EXTRACT_DATE,
      companyDetailsSource: 'asic_pdf',
    })
  })

  it("becomes 'asic_pdf_edited', keeping the extract's date, when an address is changed", async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    render(<CompanyDetailsForm clientId="cl_1" initial={FROM_EXTRACT} />)

    await user.clear(field(PRINCIPAL))
    await user.type(field(PRINCIPAL), '9 New Street')

    expect(screen.getByText('From ASIC extract as at 23 September 2026, edited')).toBeTruthy()
    expect(await save(user, fetchMock)).toMatchObject({
      principalPlaceOfBusiness: '9 New Street',
      asicExtractDate: EXTRACT_DATE,
      companyDetailsSource: 'asic_pdf_edited',
    })
  })

  it('sends an empty list, not nothing, when every director is removed', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    render(<CompanyDetailsForm clientId="cl_1" initial={FROM_EXTRACT} />)

    await user.click(screen.getByRole('button', { name: 'Remove director 2' }))
    await user.click(screen.getByRole('button', { name: 'Remove director 1' }))

    const body = await save(user, fetchMock)
    expect(body.directors).toEqual([])
    expect(body.companyDetailsSource).toBe('asic_pdf_edited')
  })

  it('adopts a record that arrives after the form mounted', () => {
    mockRoutes()
    const { rerender } = render(<CompanyDetailsForm clientId="cl_1" initial={null} />)
    expect(field(REGISTERED).value).toBe('')

    rerender(<CompanyDetailsForm clientId="cl_1" initial={FROM_EXTRACT} />)

    expect(field(REGISTERED).value).toBe(EXTRACT.registeredOffice)
    expect(field('Director 2 name').value).toBe('Raj Example')
  })
})

describe('CompanyDetailsForm — company and trust', () => {
  /** A company acting as trustee, with no ABN of its own. Synthetic. */
  const TRUSTEE: CompanyDetails = {
    ...BEFORE,
    entityType: 'trust',
    abnNumber: '',
    trustName: 'Sample Family Trust',
    trustAbnNumber: '51824753556',
  }

  it('opens a trustee record with its Trust section filled', () => {
    mockRoutes()
    render(<CompanyDetailsForm clientId="cl_1" initial={TRUSTEE} />)

    expect((screen.getByLabelText('Entity type') as HTMLSelectElement).value).toBe('trust')
    expect(field('Trust name').value).toBe('Sample Family Trust')
    expect(field('Trust ABN').value).toBe('51824753556')
    expect(field('Company ABN (if the company has its own)').value).toBe('')
  })

  it('opens an older record, saved before entity types, as a Company with an empty, optional Trust section', () => {
    mockRoutes()
    render(<CompanyDetailsForm clientId="cl_1" initial={BEFORE} />)

    expect((screen.getByLabelText('Entity type') as HTMLSelectElement).value).toBe('company')
    expect(field('Trust name').value).toBe('')
    expect(screen.getByText(/Fill it in if the company acts as trustee of a trust/)).toBeTruthy()
  })

  it('saves both ABNs apart, with the entity type', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    render(<CompanyDetailsForm clientId="cl_1" initial={TRUSTEE} />)

    await user.clear(field('Company phone'))
    expect(await save(user, fetchMock)).toMatchObject({
      entityType: 'trust',
      abnNumber: '',
      trustName: 'Sample Family Trust',
      trustAbnNumber: '51824753556',
    })
  })

  it('saves with nothing checked — blank or unusual values go through as typed', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    render(<CompanyDetailsForm clientId="cl_1" initial={TRUSTEE} />)

    await user.clear(field('Company name'))
    await user.clear(field('ACN'))
    await user.clear(field('Trust name'))
    // The company's own ABN (11 + its ACN) typed as the trust's.
    await user.clear(field('Trust ABN'))
    await user.type(field('Trust ABN'), '11123456780')

    expect(await save(user, fetchMock)).toMatchObject({
      companyName: '',
      acnNumber: '',
      trustName: '',
      trustAbnNumber: '11123456780',
    })
  })
})
