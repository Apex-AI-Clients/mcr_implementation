import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CompanyIdentityFields } from '../CompanyIdentityFields'
import { resetAbrConfiguredProbe } from '@/lib/abr/browser'
import type { AbrEntityDetails } from '@/lib/abr/types'
import type { CompanyIdentity } from '@/lib/clients/identity'

/**
 * The company fields' free ABN Lookup by ACN: with a whole ACN and an empty
 * company ABN, the register is asked whether the company has an ABN of its own.
 *
 * Synthetic: ACN 123 456 780, whose only candidate ABN is 11 123 456 780.
 * Nothing here talks to the register.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetAbrConfiguredProbe()
})

const ACN = '123456780'
const ABN = '11123456780'

function details(overrides: Partial<AbrEntityDetails> = {}): AbrEntityDetails {
  return {
    abn: ABN,
    abnStatus: 'Active',
    status: 'active',
    abnStatusEffectiveFrom: '2015-01-12',
    acn: ACN,
    entityName: 'SAMPLE TRADING PTY LTD',
    entityTypeCode: 'PRV',
    entityTypeName: 'Australian Private Company',
    state: 'VIC',
    postcode: '3000',
    ...overrides,
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockRoutes(abn: () => Response, configured = true) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/abr/status')) return json({ configured })
    if (url.startsWith('/api/abr/abn')) return abn()
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function abnCalls(fetchMock: ReturnType<typeof mockRoutes>) {
  return fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/abr/abn'))
}

function Harness({ manual = false }: { manual?: boolean }) {
  const [values, setValues] = useState<CompanyIdentity>({
    companyName: '',
    acnNumber: '',
    abnNumber: '',
  })
  const [companyManual, setCompanyManual] = useState(manual)
  return (
    <CompanyIdentityFields
      idPrefix="t"
      values={values}
      companyManual={companyManual}
      trustee={false}
      canMoveToTrust={false}
      errors={{}}
      disabled={false}
      onField={(field, value) => setValues((current) => ({ ...current, [field]: value }))}
      onManual={setCompanyManual}
      onPick={vi.fn()}
      onAsicChoice={vi.fn()}
      onMoveToTrust={vi.fn()}
    />
  )
}

function field(label: string) {
  return screen.getByLabelText(label) as HTMLInputElement
}

/** Past the debounce, with the lookup answered. */
const WAIT = { timeout: 3_000 }

describe('CompanyIdentityFields — ABN Lookup by ACN', () => {
  it('offers the ABN the register has for this ACN, and uses it on click', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes(() => json({ details: details() }))
    render(<Harness />)

    await user.type(field('ACN'), '123 456 780')
    const offer = await screen.findByRole('button', { name: 'Use ABN 11 123 456 780' }, WAIT)
    expect(abnCalls(fetchMock).map(([input]) => String(input))).toEqual([`/api/abr/abn?abn=${ABN}`])

    await user.click(offer)
    expect(field('Company ABN').value).toBe(ABN)
    expect(screen.queryByRole('button', { name: /Use ABN/ })).toBeNull()
  })

  it('says a cancelled ABN was cancelled, with the date, and lets staff use it anyway', async () => {
    const user = userEvent.setup()
    mockRoutes(() =>
      json({
        details: details({
          status: 'cancelled',
          abnStatus: 'Cancelled',
          abnStatusEffectiveFrom: '2024-03-11',
        }),
      }),
    )
    render(<Harness />)

    await user.type(field('ACN'), ACN)
    expect(
      await screen.findByText('ABN 11 123 456 780 was cancelled on 11 March 2024.', undefined, WAIT),
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Use it anyway' }))
    expect(field('Company ABN').value).toBe(ABN)
  })

  it('says when the register has no ABN for this ACN', async () => {
    const user = userEvent.setup()
    mockRoutes(() => json({ error: 'The ABR has no entity for that ABN.' }, 404))
    render(<Harness />)

    await user.type(field('ACN'), ACN)
    expect(
      await screen.findByText(
        'No ABN registered for this ACN (normal for trustee companies)',
        undefined,
        WAIT,
      ),
    ).toBeTruthy()
  })

  it('ignores a record whose ACN is not this one', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes(() => json({ details: details({ acn: '000000019' }) }))
    render(<Harness />)

    await user.type(field('ACN'), ACN)
    await waitFor(() => expect(abnCalls(fetchMock)).toHaveLength(1), WAIT)
    expect(await screen.findByText(/No ABN registered for this ACN/, undefined, WAIT)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Use ABN/ })).toBeNull()
  })

  it('asks once per ACN, however often it is retyped', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes(() => json({ details: details() }))
    render(<Harness />)

    await user.type(field('ACN'), ACN)
    await screen.findByRole('button', { name: /Use ABN/ }, WAIT)
    await user.clear(field('ACN'))
    await user.type(field('ACN'), ACN)
    await screen.findByRole('button', { name: /Use ABN/ }, WAIT)

    expect(abnCalls(fetchMock)).toHaveLength(1)
  })

  it('never asks with "Enter manually" ticked', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes(() => json({ details: details() }))
    render(<Harness manual />)

    await user.type(field('ACN'), ACN)
    await new Promise((resolve) => setTimeout(resolve, 900))

    expect(abnCalls(fetchMock)).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Use ABN/ })).toBeNull()
  })

  it('never asks once a company ABN is typed', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes(() => json({ details: details() }))
    render(<Harness />)

    await user.type(field('Company ABN'), ABN)
    await user.type(field('ACN'), ACN)
    await new Promise((resolve) => setTimeout(resolve, 900))

    expect(abnCalls(fetchMock)).toHaveLength(0)
  })

  it('never asks when the deployment has no ABR registration', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRoutes(() => json({ details: details() }), false)
    render(<Harness />)

    await user.type(field('ACN'), ACN)
    await new Promise((resolve) => setTimeout(resolve, 900))

    expect(abnCalls(fetchMock)).toHaveLength(0)
  })
})
