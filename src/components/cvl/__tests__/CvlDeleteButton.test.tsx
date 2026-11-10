import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))

// A fresh copy: another test file's router mock must never be the one it calls.
vi.resetModules()
const { CvlDeleteButton } = await import('../CvlDeleteButton')

/** Delete on the CVL list and page: the file goes to the Archive, never destroyed in one click. Synthetic data. */

afterEach(() => {
  cleanup()
  push.mockClear()
  refresh.mockClear()
  vi.unstubAllGlobals()
})

describe('CvlDeleteButton', () => {
  it('asks first, then moves the file to the Archive and refreshes the list', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup({ delay: null })
    render(<CvlDeleteButton caseId="case-1" clientName="Sample Trading" compact />)

    await user.click(screen.getByRole('button', { name: 'Delete Sample Trading' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog').textContent).toContain('moves to the Archive (CVL tab)')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/cvl/case-1/remove', { method: 'POST' }))
    expect(refresh).toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('goes back to the CVL list when deleted from the file’s own page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }))))
    const user = userEvent.setup({ delay: null })
    render(<CvlDeleteButton caseId="case-1" clientName="Sample Trading" redirectTo="/cvl" />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/cvl'))
  })

  it('says so when the delete fails, and stays open', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Failed to archive client' }), { status: 500 })))
    const user = userEvent.setup({ delay: null })
    render(<CvlDeleteButton caseId="case-1" clientName="Sample Trading" compact />)
    await user.click(screen.getByRole('button', { name: 'Delete Sample Trading' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Failed to archive client')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
