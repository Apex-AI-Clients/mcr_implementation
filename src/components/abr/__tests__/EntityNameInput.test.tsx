import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'fs'
import { join } from 'path'
import { EntityNameInput } from '../EntityNameInput'
import { resetAbrConfiguredProbe } from '@/lib/abr/browser'
import { parseAbnDetails, parseMatchingNames } from '@/lib/abr/parse'
import type { AbrPrefill } from '@/lib/abr/types'

/**
 * The name field that searches the register as you type.
 *
 * Two things carry the weight here and both are asserted below: a deployment
 * with no ABR registration gets the plain field it always had, and a value the
 * register filled in is still just text somebody can type over. ABR is often
 * stale for these companies — a prefill that could not be corrected would be
 * worse than no prefill.
 *
 * Driven against the committed fixtures, through the same parsers the routes
 * use, so nothing here talks to the register.
 *
 * Plain DOM assertions rather than jest-dom matchers, as the rest of the
 * component suites here do — the matchers are not loaded.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetAbrConfiguredProbe()
})

function fixture(name: string): string {
  return readFileSync(
    join(__dirname, '..', '..', '..', 'lib', 'abr', '__tests__', 'fixtures', `${name}.txt`),
    'utf8',
  )
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface RouteOptions {
  configured?: boolean
  search?: () => Response
  abn?: () => Response
  acns?: () => Response
}

/** Stands in for the proxy routes. Returns the spy for call assertions. */
function mockRoutes({ configured = true, search, abn, acns }: RouteOptions = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/abr/status')) return json({ configured })
    if (url.startsWith('/api/abr/search')) {
      return search ? search() : json(parseMatchingNames(fixture('matching_names_multi')))
    }
    if (url.startsWith('/api/abr/acns')) {
      // The company fixture's ACN, and the trust's lack of one.
      return acns ? acns() : json({ acns: { '53004085616': '004085616', '74653091178': '' } })
    }
    if (url.startsWith('/api/abr/abn')) {
      return abn ? abn() : json({ details: parseAbnDetails(fixture('abn_details_company')) })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Mirrors how the conversion dialog holds the value: state the field edits. */
function Harness({ onPick = vi.fn() }: { onPick?: (prefill: AbrPrefill) => void }) {
  const [value, setValue] = useState('')
  return (
    <EntityNameInput
      id="company-name"
      label="Name of company"
      value={value}
      disabled={false}
      onChange={setValue}
      onPick={(prefill) => {
        if (typeof prefill.companyName === 'string') setValue(prefill.companyName)
        onPick(prefill)
      }}
    />
  )
}

/** Search, then the ACN batch, both behind the debounce — slower than one request. */
const ACN_WAIT = { timeout: 4_000 }

function field(): HTMLInputElement {
  return screen.getByLabelText('Name of company') as HTMLInputElement
}

describe('EntityNameInput — no ABR registration', () => {
  it('is an ordinary text field, and never calls the register', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes({ configured: false })
    render(<Harness />)

    // Wait for the probe to settle, so this is not just passing early.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    await user.type(field(), 'Whitlock Civil')
    expect(field().value).toBe('Whitlock Civil')
    expect(field().getAttribute('role')).toBeNull()

    // Only the status probe. Nothing was searched.
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('/api/abr/status'))).toBe(
      true,
    )
  })
})

describe('EntityNameInput — searching', () => {
  it('does not search until there is enough to go on', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    render(<Harness />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    await user.type(field(), 'Wh')
    await new Promise((resolve) => setTimeout(resolve, 600))

    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/abr/search'))).toBe(
      false,
    )
  })

  it('debounces — a typed word is one request, not one per keystroke', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    render(<Harness />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    await user.type(field(), 'Whitlock')
    await waitFor(() => expect(screen.getByRole('listbox')).not.toBeNull())

    const searches = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith('/api/abr/search'),
    )
    expect(searches).toHaveLength(1)
  })

  it('shows the register’s own text alongside the tidied name', async () => {
    const user = userEvent.setup()
    mockRoutes()
    render(<Harness />)

    await user.type(field(), 'Whitlock')
    await waitFor(() => expect(screen.getByRole('listbox')).not.toBeNull())

    // Tidied, which is what would go in the field…
    expect(screen.getByText('Whitlock Civil Pty Ltd')).not.toBeNull()
    // …and the raw register entry, which is what staff are checking.
    expect(screen.getByText('WHITLOCK CIVIL PTY LTD')).not.toBeNull()
  })

  it('shows the ACN next to the ABN once the register answers', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes()
    render(<Harness />)

    await user.type(field(), 'Whitlock')
    // Two requests chained behind the typing debounce, so more than the default wait.
    await waitFor(() => expect(screen.getByText('ACN 004085616')).not.toBeNull(), ACN_WAIT)
    expect(screen.getByText('ABN 53004085616')).not.toBeNull()

    // One batch for the whole page of results, not one request per row.
    const batches = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/abr/acns'))
    expect(batches).toHaveLength(1)
  })

  it('shows no ACN on a row the register has none for', async () => {
    const user = userEvent.setup()
    mockRoutes()
    render(<Harness />)

    await user.type(field(), 'Whitlock')
    // Two requests chained behind the typing debounce, so more than the default wait.
    await waitFor(() => expect(screen.getByText('ACN 004085616')).not.toBeNull(), ACN_WAIT)
    // Only the company has one; the trust row (and the rest) show none.
    expect(screen.getAllByText(/^ACN /)).toHaveLength(1)
  })

  it('marks each row as looking up its ACN until the answer arrives', async () => {
    const user = userEvent.setup()
    let answer: (response: Response) => void = () => {}
    const held = new Promise<Response>((resolve) => {
      answer = resolve
    })
    mockRoutes({ acns: () => held as unknown as Response })
    render(<Harness />)

    await user.type(field(), 'Whitlock')
    // The rows are up straight away, each saying its ACN is on the way…
    await waitFor(() => expect(screen.getByText('Whitlock Civil Pty Ltd')).not.toBeNull(), ACN_WAIT)
    expect(screen.getAllByLabelText('Looking up ACN').length).toBeGreaterThan(0)

    // …and once it lands, the placeholder becomes the ACN on the company row,
    // and goes from every other row — the trust has none, and the rest were
    // not answered, which is finished too.
    answer(json({ acns: { '53004085616': '004085616', '74653091178': '' } }))
    await waitFor(() => expect(screen.getByText('ACN 004085616')).not.toBeNull(), ACN_WAIT)
    expect(screen.queryAllByLabelText('Looking up ACN')).toHaveLength(0)
  })

  it('stops showing the placeholder when the ACN lookup fails', async () => {
    const user = userEvent.setup()
    mockRoutes({ acns: () => json({ error: 'down' }, 502) })
    render(<Harness />)

    await user.type(field(), 'Whitlock')
    await waitFor(() => expect(screen.getByText('Whitlock Civil Pty Ltd')).not.toBeNull(), ACN_WAIT)
    await waitFor(() => expect(screen.queryAllByLabelText('Looking up ACN')).toHaveLength(0), ACN_WAIT)
  })

  it('still lists the matches when the ACN lookup fails', async () => {
    const user = userEvent.setup()
    mockRoutes({ acns: () => json({ error: 'down' }, 502) })
    render(<Harness />)

    await user.type(field(), 'Whitlock')
    await waitFor(() => expect(screen.getByText('Whitlock Civil Pty Ltd')).not.toBeNull(), ACN_WAIT)
    expect(screen.queryByText(/^ACN /)).toBeNull()
  })

  it('flags a cancelled ABN on the row it belongs to', async () => {
    const user = userEvent.setup()
    mockRoutes()
    render(<Harness />)

    await user.type(field(), 'Whitlock')
    await waitFor(() => expect(screen.getByRole('listbox')).not.toBeNull())

    expect(screen.getByText('Cancelled')).not.toBeNull()
  })
})

describe('EntityNameInput — picking a match', () => {
  it('fills the fields the register can answer for', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    mockRoutes()
    render(<Harness onPick={onPick} />)

    await user.type(field(), 'Whitlock')
    await waitFor(() => expect(screen.getByRole('listbox')).not.toBeNull())
    await user.click(screen.getByText('Whitlock Civil Pty Ltd'))

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1))
    expect(onPick.mock.calls[0][0]).toEqual({
      companyName: 'Whitlock Civil Pty Ltd',
      abnNumber: '53004085616',
      acnNumber: '004085616',
      entityType: 'company',
    })
  })

  it('never offers a value for phone or email — they are not on the register', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    mockRoutes()
    render(<Harness onPick={onPick} />)

    await user.type(field(), 'Whitlock')
    await waitFor(() => expect(screen.getByRole('listbox')).not.toBeNull())
    await user.click(screen.getByText('Whitlock Civil Pty Ltd'))

    await waitFor(() => expect(onPick).toHaveBeenCalled())
    expect(onPick.mock.calls[0][0]).not.toHaveProperty('phoneNumber')
    expect(onPick.mock.calls[0][0]).not.toHaveProperty('emailAddress')
  })

  it('closes the list and leaves the filled value fully editable', async () => {
    const user = userEvent.setup()
    mockRoutes()
    render(<Harness />)

    await user.type(field(), 'Whitlock')
    await waitFor(() => expect(screen.getByRole('listbox')).not.toBeNull())
    await user.click(screen.getByText('Whitlock Civil Pty Ltd'))

    await waitFor(() => expect(field().value).toBe('Whitlock Civil Pty Ltd'))
    expect(screen.queryByRole('listbox')).toBeNull()

    // The register is often wrong about exactly this — a trading name that is
    // not the registered one. Typing over it has to just work.
    await user.clear(field())
    await user.type(field(), 'Whitlock Earthmoving')
    expect(field().value).toBe('Whitlock Earthmoving')
    expect(field().readOnly).toBe(false)
  })

  it('strips the trustee prefix when the match is a trust', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    mockRoutes({ abn: () => json({ details: parseAbnDetails(fixture('abn_details_trust')) }) })
    render(<Harness onPick={onPick} />)

    await user.type(field(), 'Whitlock')
    await waitFor(() => expect(screen.getByRole('listbox')).not.toBeNull())
    await user.click(screen.getByText('Whitlock Civil Pty Ltd'))

    await waitFor(() => expect(onPick).toHaveBeenCalled())
    expect(onPick.mock.calls[0][0]).toEqual({
      trustName: 'Smith Family Trust',
      abnNumber: '74653091178',
      entityType: 'trust',
    })
  })
})

describe('EntityNameInput — when the register is no help', () => {
  it('says a company it has never heard of is still yours to type in', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    mockRoutes({ search: () => json(parseMatchingNames(fixture('matching_names_empty'))) })
    render(<Harness onPick={onPick} />)

    await user.type(field(), 'Whitlock')

    // Not ABR's own "No matching names found", which reads as a full stop.
    await waitFor(() => expect(screen.getByText(/type the details in yourself/i)).not.toBeNull())
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(field().value).toBe('Whitlock')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('lets an unlisted company be typed in full, with the list open and ignored', async () => {
    // The question this answers: nothing about the field requires a pick. A
    // company the register does not carry is entered exactly as every company
    // was entered before this field could search at all.
    const user = userEvent.setup()
    const onPick = vi.fn()
    mockRoutes()
    render(<Harness onPick={onPick} />)

    await user.type(field(), 'Whitlock')
    await waitFor(() => expect(screen.getByRole('listbox')).not.toBeNull())

    await user.type(field(), ' Excavations Unit Trust')
    expect(field().value).toBe('Whitlock Excavations Unit Trust')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('shows the route’s message when the register is down, and blocks nothing', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    mockRoutes({
      search: () => json({ error: "The Australian Business Register didn't answer." }, 502),
    })
    render(<Harness onPick={onPick} />)

    await user.type(field(), 'Whitlock')

    await waitFor(() => expect(screen.getByText(/didn't answer/i)).not.toBeNull())
    expect(field().value).toBe('Whitlock')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('survives a thrown fetch without taking the field with it', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith('/api/abr/status')) return json({ configured: true })
        throw new TypeError('Failed to fetch')
      }),
    )
    render(<Harness onPick={onPick} />)

    await user.type(field(), 'Whitlock')

    await waitFor(() => expect(screen.getByText(/enter the details by hand/i)).not.toBeNull())
    expect(field().value).toBe('Whitlock')
    expect(onPick).not.toHaveBeenCalled()
  })
})
