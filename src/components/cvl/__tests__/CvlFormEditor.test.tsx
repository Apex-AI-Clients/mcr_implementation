import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
// The preview's drawing is pdf.js on a canvas, which jsdom has not got.
vi.mock('unpdf/pdfjs', () => ({ getDocument: vi.fn(() => ({ promise: Promise.reject(new Error('no canvas in tests')), destroy: async () => {} })) }))

import { CvlFormEditor } from '../CvlFormEditor'
import { entryMap } from '@/lib/cvl/entryMap'
import { entryState } from '@/lib/cvl/drafts'
import { prefillForm } from '@/lib/cvl/prefill'
import { formVersion } from '@/lib/forms/registry'
import { context } from '@/lib/cvl/__tests__/fixtures'

/** The Part B entry screen. Synthetic client file only. */

/** Answers the preview with a tiny PDF and the page each output page is, and records every call. */
function stubFetch(onPut?: Response) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PUT'
      ? (onPut ?? new Response(JSON.stringify({ ok: true, formVersion: '20220801', updatedAt: '2026-11-03T00:00:00Z', updatedBy: 'Casey' })))
      : new Response(new Uint8Array([37, 80, 68, 70]), { headers: { 'X-Cvl-Pages': '[1,2,3,4,5,6,7,8,9]', 'X-Cvl-Warnings': encodeURIComponent('["B14: Answer is longer than the lines"]') } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  stubFetch()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderPartB() {
  const map = formVersion('507b').map
  const prefill = prefillForm('507b', 'director:1', context())
  render(
    <CvlFormEditor
      caseId="case-1"
      clientId="cl_1"
      map={entryMap(map)}
      subject="director:1"
      subjects={[
        { subject: 'director:1', label: 'Jordan Sample' },
        { subject: 'director:2', label: 'Casey Example' },
      ]}
      prefill={prefill}
      initial={entryState(map, prefill, null)}
      saved={null}
    />,
  )
}

/** A question's section, by its heading's id (role queries over a form this size are slow). */
const section = (q: string) => document.getElementById(`q-${q}`)!.closest('section') as HTMLElement

describe('CvlFormEditor', () => {
  it('shows the form’s own question numbers, and each director’s Part B', () => {
    renderPartB()
    expect(within(section('B1')).getByLabelText('Name')).toHaveProperty('value', 'Jordan Sample')
    expect(screen.getByRole('link', { name: 'Casey Example' }).getAttribute('href')).toBe('/cvl/cl_1/forms/507b?subject=director%3A2')
  })

  it('starts every Yes/No at "No"', () => {
    renderPartB()
    const b2 = within(section('B2')).getByRole('radiogroup')
    expect((within(b2).getByLabelText('No') as HTMLInputElement).checked).toBe(true)
  })

  it('shows where a pre-filled answer came from until it is changed', async () => {
    const user = userEvent.setup({ delay: null })
    renderPartB()
    const b1 = section('B1')
    const name = within(b1).getByLabelText('Name')
    expect(within(name.parentElement as HTMLElement).queryByRole('button')).not.toBeNull()
    await user.type(name, ' Jr')
    expect(within(name.parentElement as HTMLElement).queryByRole('button')).toBeNull()
  })

  it('shows handwritten answers as written by hand, with nothing to type', () => {
    renderPartB()
    const b6 = section('B6')
    expect(within(b6).getAllByText(/Written by hand on the printout/).length).toBe(2)
    expect(within(b6).queryByLabelText('Password')).toBeNull()
  })

  it('saves the answers and the changed keys', async () => {
    const user = userEvent.setup({ delay: null })
    const fetchMock = stubFetch()
    renderPartB()
    await user.click(within(within(section('B2')).getByRole('radiogroup')).getByLabelText('Yes'))
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(true))
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT') as unknown as [string, RequestInit]
    expect(url).toBe('/api/admin/cvl/case-1/forms/507b')
    const body = JSON.parse(init.body as string)
    expect(body.subject).toBe('director:1')
    expect(body.answers.fields.b2).toBe('yes')
    expect(body.editedKeys).toEqual(['b2'])
    expect('b6_password' in body.answers.fields).toBe(false)
    expect(await screen.findByRole('button', { name: /Saved/ })).toBeTruthy()
  })

  it('fills the preview again with the answers on screen, with no warning boxes on the screen', async () => {
    const fetchMock = stubFetch()
    renderPartB()
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/admin/cvl/case-1/preview')).toBe(true), { timeout: 3000 })
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u) === '/api/admin/cvl/case-1/preview')!
    const body = JSON.parse(init!.body as string)
    expect(body).toMatchObject({ form: '507b', subject: 'director:1' })
    expect(body.answers.fields.b1_name).toBe('Jordan Sample')
    // Page tabs for each output page; the warnings are kept for the print page.
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^[1-9]$/ })).toHaveLength(9))
    expect(screen.queryByText('B14: Answer is longer than the lines')).toBeNull()
    expect(screen.queryByText(/Not set yet in CVL settings/)).toBeNull()
  })
})
