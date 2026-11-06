import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))

import { ArchivedClientActions } from '../ArchivedClientActions'

/** Make client again returns the file to its own workspace (migration 0039). Synthetic data. */

afterEach(() => {
  cleanup()
  push.mockClear()
  vi.unstubAllGlobals()
})

async function restore(workflow?: 'sbr' | 'cvl') {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })))
  render(<ArchivedClientActions clientId="cl_1" clientName="Sample Trading" clientEmail="a@example.test" workflow={workflow} />)
  await userEvent.setup().click(screen.getByRole('button', { name: /Make client again/ }))
  await waitFor(() => expect(push).toHaveBeenCalled())
  return push.mock.calls[0][0]
}

describe('ArchivedClientActions — Make client again', () => {
  it('opens an SBR file on the SBR client page', async () => {
    expect(await restore('sbr')).toBe('/clients/cl_1')
  })

  it('opens a CVL file on the CVL client page', async () => {
    expect(await restore('cvl')).toBe('/cvl/cl_1')
  })
})

describe('ArchivedClientActions — Delete permanently', () => {
  it('is offered for a file in neither workspace', () => {
    render(<ArchivedClientActions clientId="cl_1" clientName="Sample Trading" clientEmail="a@example.test" />)
    expect((screen.getByRole('button', { name: /Delete permanently/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('is held back while the file is still in CVL (archived from SBR only), saying why', () => {
    render(<ArchivedClientActions clientId="cl_1" clientName="Sample Trading" clientEmail="a@example.test" inCvl />)
    expect((screen.getByRole('button', { name: /Delete permanently/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/not available while the file is still in CVL/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /Make client again/ }) as HTMLButtonElement).disabled).toBe(false)
  })
})
