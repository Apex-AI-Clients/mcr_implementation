import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { AsicExtractOnFile } from '../AsicExtractOnFile'

/** Whether the ASIC extract PDF is kept on the file, in one line. Synthetic. */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }))

describe('AsicExtractOnFile', () => {
  it('says the extract is on file, with its date and a link to open it', async () => {
    vi.stubGlobal('fetch', answer({ extract: { id: 'ex1', extractedAt: '2026-10-03', uploadedAt: '2026-11-05T02:00:00Z' } }))
    render(<AsicExtractOnFile clientId="c1" />)
    await waitFor(() => expect(screen.getByText(/ASIC extract on file, dated 3 October 2026/)).toBeTruthy())
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/api/admin/clients/c1/asic-extract/ex1')
  })

  it('says none is on file and what uploading it fills, with a link to upload it when given', async () => {
    vi.stubGlobal('fetch', answer({ extract: null }))
    render(<AsicExtractOnFile clientId="c1" uploadHref="/cvl/c1/intake" />)
    await waitFor(() => expect(screen.getByText(/No ASIC extract on file/)).toBeTruthy())
    expect(screen.getByText(/registration and appointment dates on the CVL forms/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Upload it' }).getAttribute('href')).toBe('/cvl/c1/intake')
  })

  it('asks again after a save', async () => {
    const fetchMock = answer({ extract: null })
    vi.stubGlobal('fetch', fetchMock)
    const { rerender } = render(<AsicExtractOnFile clientId="c1" refreshKey={0} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    rerender(<AsicExtractOnFile clientId="c1" refreshKey={1} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('never claims either way when the check fails', async () => {
    vi.stubGlobal('fetch', answer({ error: 'x' }, 500))
    render(<AsicExtractOnFile clientId="c1" />)
    await waitFor(() => expect(screen.getByText('Could not check whether the ASIC extract is on file.')).toBeTruthy())
  })
})
