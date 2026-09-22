import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'fs'
import { join } from 'path'
import { ClientDetailsForm } from '../ClientDetailsForm'
import { resetAbrConfiguredProbe } from '@/lib/abr/browser'
import { parseAbnDetails, parseMatchingNames } from '@/lib/abr/parse'

/**
 * Step 1 of intake, and what a register pick does to it.
 *
 * The behaviour worth pinning is the side effect: picking a company here saves
 * its ABN and ACN against the client, so the company step opens filled in
 * rather than empty. That happens in both modes, by different routes — with the
 * create call when creating, as a partial write afterwards when editing — and
 * it is only safe while the pick is dropped the moment somebody edits the name
 * by hand, or a client renamed after a pick gets filed against another
 * company's ABN. All of it is asserted below.
 *
 * Plain DOM assertions, as the rest of the component suites here do.
 */

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  resetAbrConfiguredProbe()
})

function fixture(name: string): string {
  return readFileSync(
    join(__dirname, '..', '..', '..', '..', 'lib', 'abr', '__tests__', 'fixtures', `${name}.txt`),
    'utf8',
  )
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * ABR proxy routes plus the client endpoints. Returns the spy.
 *
 * Takes fetch's own parameter tuple, so recorded calls carry the request body
 * and not just the URL — what was sent is the whole point of these tests.
 */
function mockRoutes(abnFixture = 'abn_details_company') {
  const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    if (url.startsWith('/api/abr/status')) return json({ configured: true })
    if (url.startsWith('/api/abr/search')) {
      return json(parseMatchingNames(fixture('matching_names_multi')))
    }
    if (url.startsWith('/api/abr/abn')) {
      return json({ details: parseAbnDetails(fixture(abnFixture)) })
    }
    if (url.startsWith('/api/admin/clients')) {
      return json({ id: 'cl_1', name: 'x', email: 'x@y.com' }, 201)
    }
    if (url.startsWith('/api/portal/company-details')) return json({ success: true })
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function nameField(): HTMLInputElement {
  return screen.getByLabelText('Client / Company Name') as HTMLInputElement
}

/** The body of the call to an endpoint, parsed. */
function bodySentTo(fetchMock: ReturnType<typeof mockRoutes>, prefix: string) {
  const call = fetchMock.mock.calls.find(([url]) => String(url).startsWith(prefix))
  if (!call) throw new Error(`${prefix} was never called`)
  return JSON.parse(String(call[1]?.body))
}

function submittedBody(fetchMock: ReturnType<typeof mockRoutes>) {
  return bodySentTo(fetchMock, '/api/admin/clients')
}

function calledWith(fetchMock: ReturnType<typeof mockRoutes>, prefix: string) {
  return fetchMock.mock.calls.some(([url]) => String(url).startsWith(prefix))
}

/** Search, pick the first match, and wait for the field to take the value. */
async function pickFirstMatch(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.type(nameField(), 'Whitlock')
  await waitFor(() => expect(screen.getByRole('listbox')).not.toBeNull())
  await user.click(screen.getByText(label))
  await waitFor(() => expect(nameField().value).toBe(label))
}

describe('ClientDetailsForm — creating a client', () => {
  it('sends the picked ABN and ACN with the create call', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    render(<ClientDetailsForm clientId={null} initialName="" initialEmail="" />)

    await pickFirstMatch(user, 'Whitlock Civil Pty Ltd')
    await user.type(screen.getByLabelText('Email Address'), 'dean@whitlockcivil.com.au')
    await user.click(screen.getByRole('button', { name: /create & continue/i }))

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/clients/cl_1/intake'))
    expect(submittedBody(fetchMock).companyDetails).toEqual({
      companyName: 'Whitlock Civil Pty Ltd',
      abnNumber: '53004085616',
      acnNumber: '004085616',
    })
  })

  it('tells you what else is going to be saved', async () => {
    // A silent side effect on a create is not something to discover two steps
    // later on the company form.
    const user = userEvent.setup()
    mockRoutes()
    render(<ClientDetailsForm clientId={null} initialName="" initialEmail="" />)

    await pickFirstMatch(user, 'Whitlock Civil Pty Ltd')
    // Exact strings, not patterns: the ABN contains the ACN as a substring.
    expect(screen.getByText('53004085616')).not.toBeNull()
    expect(screen.getByText('004085616')).not.toBeNull()
  })

  it('drops the pick once the name is edited by hand', async () => {
    // Otherwise a client renamed after a pick is filed against the ABN of the
    // company that was picked, which is a wrong record nobody would notice.
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    render(<ClientDetailsForm clientId={null} initialName="" initialEmail="" />)

    await pickFirstMatch(user, 'Whitlock Civil Pty Ltd')
    await user.clear(nameField())
    await user.type(nameField(), 'Whitlock Earthmoving')

    await user.type(screen.getByLabelText('Email Address'), 'dean@whitlockcivil.com.au')
    await user.click(screen.getByRole('button', { name: /create & continue/i }))

    await waitFor(() => expect(replace).toHaveBeenCalled())
    const body = submittedBody(fetchMock)
    expect(body.companyDetails).toBeUndefined()
    expect(body.name).toBe('Whitlock Earthmoving')
    expect(screen.queryByText('53004085616')).toBeNull()
  })

  it('sends name and email alone when the register was never used', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    render(<ClientDetailsForm clientId={null} initialName="" initialEmail="" />)

    await user.type(nameField(), 'Whitlock Earthmoving')
    await user.type(screen.getByLabelText('Email Address'), 'dean@whitlockcivil.com.au')
    await user.click(screen.getByRole('button', { name: /create & continue/i }))

    await waitFor(() => expect(replace).toHaveBeenCalled())
    expect(submittedBody(fetchMock)).toEqual({
      name: 'Whitlock Earthmoving',
      email: 'dean@whitlockcivil.com.au',
    })
  })

  it('puts a picked trust’s own name in the field, trustee prefix gone', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes('abn_details_trust')
    render(<ClientDetailsForm clientId={null} initialName="" initialEmail="" />)

    await user.type(nameField(), 'Whitlock')
    await waitFor(() => expect(screen.getByRole('listbox')).not.toBeNull())
    await user.click(screen.getByText('Whitlock Civil Pty Ltd'))
    await waitFor(() => expect(nameField().value).toBe('Smith Family Trust'))

    await user.type(screen.getByLabelText('Email Address'), 'dean@whitlockcivil.com.au')
    await user.click(screen.getByRole('button', { name: /create & continue/i }))

    await waitFor(() => expect(replace).toHaveBeenCalled())
    expect(submittedBody(fetchMock).companyDetails).toEqual({
      trustName: 'Smith Family Trust',
      abnNumber: '74653091178',
    })
  })
})

describe('ClientDetailsForm — editing an existing client', () => {
  it('saves the name, then the register fields as a separate partial write', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    render(
      <ClientDetailsForm clientId="cl_1" initialName="Whitlock" initialEmail="dean@whitlock.com.au" />,
    )

    await pickFirstMatch(user, 'Whitlock Civil Pty Ltd')
    await user.click(screen.getByRole('button', { name: /save details/i }))

    await waitFor(() => expect(calledWith(fetchMock, '/api/portal/company-details')).toBe(true))

    // The client row still only ever takes a name and an email.
    expect(bodySentTo(fetchMock, '/api/admin/clients/cl_1')).toEqual({
      name: 'Whitlock Civil Pty Ltd',
      email: 'dean@whitlock.com.au',
    })

    expect(bodySentTo(fetchMock, '/api/portal/company-details')).toEqual({
      clientId: 'cl_1',
      companyName: 'Whitlock Civil Pty Ltd',
      abnNumber: '53004085616',
      acnNumber: '004085616',
    })
  })

  it('never sends a phone or email on that write — no register carries them', async () => {
    // The company record holds contact details this step knows nothing about.
    // Sending keys for them is what would blank them.
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    render(
      <ClientDetailsForm clientId="cl_1" initialName="Whitlock" initialEmail="dean@whitlock.com.au" />,
    )

    await pickFirstMatch(user, 'Whitlock Civil Pty Ltd')
    await user.click(screen.getByRole('button', { name: /save details/i }))

    await waitFor(() => expect(calledWith(fetchMock, '/api/portal/company-details')).toBe(true))
    const body = bodySentTo(fetchMock, '/api/portal/company-details')
    expect(body).not.toHaveProperty('phoneNumber')
    expect(body).not.toHaveProperty('emailAddress')
    expect(body).not.toHaveProperty('trustName')
  })

  it('touches the company record only when the register was actually used', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    render(
      <ClientDetailsForm clientId="cl_1" initialName="Whitlock" initialEmail="dean@whitlock.com.au" />,
    )

    await user.clear(nameField())
    await user.type(nameField(), 'Whitlock Earthmoving')
    await user.click(screen.getByRole('button', { name: /save details/i }))

    await waitFor(() => expect(calledWith(fetchMock, '/api/admin/clients/cl_1')).toBe(true))
    expect(calledWith(fetchMock, '/api/portal/company-details')).toBe(false)
  })

  it('says the name was saved when only the second write failed', async () => {
    // The name is already stored by then, so reporting a blanket failure would
    // send somebody back to redo a save that worked.
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0])
      if (url.startsWith('/api/abr/status')) return json({ configured: true })
      if (url.startsWith('/api/abr/search')) {
        return json(parseMatchingNames(fixture('matching_names_multi')))
      }
      if (url.startsWith('/api/abr/abn')) {
        return json({ details: parseAbnDetails(fixture('abn_details_company')) })
      }
      if (url.startsWith('/api/portal/company-details')) return json({ error: 'nope' }, 500)
      return json({ id: 'cl_1', name: 'x', email: 'x@y.com' })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <ClientDetailsForm clientId="cl_1" initialName="Whitlock" initialEmail="dean@whitlock.com.au" />,
    )

    await pickFirstMatch(user, 'Whitlock Civil Pty Ltd')
    await user.click(screen.getByRole('button', { name: /save details/i }))

    await waitFor(() =>
      expect(screen.getByText(/name saved\. the abn could not be saved/i)).not.toBeNull(),
    )
  })
})
