import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/** "Complete" on each CVL form and "Unlock forms" (18 Nov 2026). Synthetic. */

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.resetModules()
const { CompleteFormButton, LockedFillButton, UnlockFormsButton } = await import('../FormCompletion')

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
beforeEach(() => {
  refresh.mockClear()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('CVL form completion', () => {
  it('Complete marks that form complete and refreshes the page', async () => {
    render(<CompleteFormButton caseId="case-1" form="507a" subject="company" label="Form 507 Part A — The company" />)
    await userEvent.click(screen.getByRole('button', { name: 'Mark Form 507 Part A — The company complete' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/admin/cvl/case-1/forms/completion')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ form: '507a', subject: 'company' })
  })

  it('says why when it cannot be saved', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Could not mark it complete: the database is not ready for it yet (migration 0063).' }), { status: 503 }))
    render(<CompleteFormButton caseId="case-1" form="509" subject="company" label="Form 509" />)
    await userEvent.click(screen.getByRole('button', { name: /complete/ }))
    expect(await screen.findByText(/migration 0063/)).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('Unlock forms asks first, then unlocks every form', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<UnlockFormsButton caseId="case-1" count={2} />)
    await userEvent.click(screen.getByRole('button', { name: /Unlock forms/ }))
    expect(fetchMock).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /Unlock forms/ }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0]).toEqual(['/api/admin/cvl/case-1/forms/completion', { method: 'DELETE' }])
  })

  it('a completed form’s Fill in is off, and says who completed it', () => {
    render(<LockedFillButton by="Casey" at="2026-11-18T00:00:00Z" />)
    const fill = screen.getByText('Fill in').closest('[aria-disabled]')!
    expect(fill.getAttribute('aria-disabled')).toBe('true')
    expect(fill.getAttribute('title')).toMatch(/^Completed by Casey on 18 Nov 2026\. Unlock the forms to edit it\.$/)
    expect(fill.closest('a')).toBeNull()
  })
})
