import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { CvlFormEditor } from '../CvlFormEditor'
import { entryMap } from '@/lib/cvl/entryMap'
import { entryState } from '@/lib/cvl/drafts'
import { prefillForm } from '@/lib/cvl/prefill'
import { formVersion } from '@/lib/forms/registry'
import { context } from '@/lib/cvl/__tests__/fixtures'

/** The Part B entry screen. Synthetic client file only. */

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
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, formVersion: '20220801', updatedAt: '2026-10-29T00:00:00Z', updatedBy: 'Casey' })))
    vi.stubGlobal('fetch', fetchMock)
    renderPartB()
    await user.click(within(within(section('B2')).getByRole('radiogroup')).getByLabelText('Yes'))
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/admin/cvl/case-1/forms/507b')
    const body = JSON.parse(init.body as string)
    expect(body.subject).toBe('director:1')
    expect(body.answers.fields.b2).toBe('yes')
    expect(body.editedKeys).toEqual(['b2'])
    expect('b6_password' in body.answers.fields).toBe(false)
    expect(await screen.findByRole('button', { name: /Saved/ })).toBeTruthy()
  })
})
