import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('unpdf/pdfjs', () => ({ getDocument: vi.fn(() => ({ promise: Promise.reject(new Error('no canvas in tests')), destroy: async () => {} })) }))
vi.mock('@/lib/forms/browserFill', () => ({ fillInBrowser: vi.fn() }))

import { CvlFormEditor } from '../CvlFormEditor'
import { entryMap } from '@/lib/cvl/entryMap'
import { entryState } from '@/lib/cvl/drafts'
import { prefillForm } from '@/lib/cvl/prefill'
import { formVersion } from '@/lib/forms/registry'
import { context } from '@/lib/cvl/__tests__/fixtures'
import { fillInBrowser } from '@/lib/forms/browserFill'

/**
 * Gabby's 24 Nov 2026 fixes on the Part B screen: Save / Download never left busy (an error, a slow
 * server), B14's reasons copied into B15's, B24's "Unsure" dates, and a completed form's banner.
 * Synthetic client file only.
 */

vi.setConfig({ testTimeout: 120_000 })

const PDF = () => new Response(new Uint8Array([37, 80, 68, 70]), { headers: { 'X-Cvl-Pages': '[1,2,3,4,5,6,7,8,9]' } })

beforeEach(() => {
  vi.mocked(fillInBrowser).mockReset()
  vi.mocked(fillInBrowser).mockRejectedValue(new Error('not in this test'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderPartB(locked: { at: string; completed: number } | null = null) {
  const map = formVersion('507b').map
  const prefill = prefillForm('507b', 'director:1', context())
  render(
    <CvlFormEditor
      caseId="case-1"
      clientId="cl_1"
      map={entryMap(map)}
      subject="director:1"
      subjects={[{ subject: 'director:1', label: 'Jordan Sample' }]}
      prefill={prefill}
      initial={entryState(map, prefill, null)}
      saved={null}
      locked={locked}
    />,
  )
}

const saveButton = () => screen.getByRole('button', { name: /^(Save|Saved)$/ })
const typeInto = (id: string, value: string) => fireEvent.change(document.getElementById(id)!, { target: { value } })

describe('Save and Download are never left busy', () => {
  it('a server error says so and gives Save back', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => (init?.method === 'PUT' ? new Response(JSON.stringify({ error: 'Database is down' }), { status: 500 }) : PDF())))
    renderPartB()
    typeInto('f-b1_phone', '0400 000 000')
    fireEvent.click(saveButton())
    expect(await screen.findByText('Database is down')).toBeTruthy()
    await waitFor(() => expect(saveButton().hasAttribute('disabled')).toBe(false))
    expect(saveButton().textContent).toBe('Save')
  })

  it('a server that never answers: after the time limit, a message and Save back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.stubGlobal(
      'fetch',
      vi.fn((_u: string, init?: RequestInit) =>
        init?.method === 'PUT'
          ? new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
          : Promise.resolve(PDF()),
      ),
    )
    renderPartB()
    typeInto('f-b1_phone', '0400 000 000')
    fireEvent.click(saveButton())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000)
    })
    expect(await screen.findByText('The server took too long to answer. Please try again.')).toBeTruthy()
    await waitFor(() => expect(saveButton().hasAttribute('disabled')).toBe(false))
  })

  it('Download with a preview that cannot be filled: a message, never a button left waiting', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    renderPartB()
    fireEvent.click(screen.getByRole('button', { name: /Download/ }))
    expect(await screen.findByText(/The PDF could not be prepared: The preview could not be filled\. Please try again\. Please try Download again\./)).toBeTruthy()
    expect(screen.queryByText('Preparing the PDF to download…')).toBeNull()
  })
})

describe('B14 → B15, B24 "Unsure", completed forms', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => PDF()))
  })

  it("B14's reasons copy into B15's as they are typed; once B15's are changed, copying stops and \"Copy from B14 again\" brings it back", async () => {
    renderPartB()
    typeInto('f-b14_reasons', 'Lost the main customer')
    expect((document.getElementById('f-b15_reasons') as HTMLTextAreaElement).value).toBe('Lost the main customer')
    typeInto('f-b14_reasons', 'Lost the main customer; costs rose')
    expect((document.getElementById('f-b15_reasons') as HTMLTextAreaElement).value).toBe('Lost the main customer; costs rose')
    expect(screen.queryByRole('button', { name: 'Copy from B14 again' })).toBeNull()

    typeInto('f-b15_reasons', 'Ceased when the lease ended')
    typeInto('f-b14_reasons', 'Lost the main customer; costs rose; ATO debt')
    expect((document.getElementById('f-b15_reasons') as HTMLTextAreaElement).value).toBe('Ceased when the lease ended')
    fireEvent.click(screen.getByRole('button', { name: 'Copy from B14 again' }))
    expect((document.getElementById('f-b15_reasons') as HTMLTextAreaElement).value).toBe('Lost the main customer; costs rose; ATO debt')
  })

  it('B24 dates start "Unsure" and switch either way', async () => {
    renderPartB()
    const groups = screen.getAllByRole('radiogroup', { name: 'Unsure or a date' })
    expect(groups).toHaveLength(8)
    expect(document.getElementById('f-b24_itr_start')).toBeNull()
    fireEvent.click(groups[0].querySelectorAll('input')[1])
    const input = document.getElementById('f-b24_itr_start') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2025-07-01' } })
    expect((document.getElementById('f-b24_itr_start') as HTMLInputElement).value).toBe('2025-07-01')
    fireEvent.click(groups[0].querySelectorAll('input')[0])
    expect(document.getElementById('f-b24_itr_start')).toBeNull()
    // Back to a date: the one typed before, shown DD/MM/YYYY.
    fireEvent.click(groups[0].querySelectorAll('input')[1])
    expect((document.getElementById('f-b24_itr_start') as HTMLInputElement).value).toBe('01/07/2025')
  })

  it('a completed form shows its banner, read-only, with no Save', () => {
    renderPartB({ at: '2026-11-20T00:00:00Z', completed: 3 })
    expect(screen.getByTestId('locked-banner').textContent).toContain('This form is completed and locked — Unlock to edit')
    expect(screen.queryByRole('button', { name: /^(Save|Saved)$/ })).toBeNull()
    expect((document.getElementById('f-b1_phone') as HTMLInputElement).closest('fieldset')!.disabled).toBe(true)
    expect(screen.getByRole('button', { name: /Unlock forms/ })).toBeTruthy()
  })
})
