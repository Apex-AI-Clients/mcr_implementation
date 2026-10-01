import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientTable } from '../ClientTable'
import type { ClientSummary } from '@/types/app'

/**
 * The client list and the Archive share one table. On the client list rows are
 * archived — never deleted; in the Archive they are made clients again or
 * deleted permanently. Synthetic data only.
 */

const refresh = vi.fn()
const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh }),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const CLIENT: ClientSummary = {
  id: 'cl_1',
  name: 'Sample Trading',
  email: 'accounts@example.test',
  status: 'in_progress',
  docsReceived: 2,
  docsTotal: 8,
  atoAdminConfirmed: false,
  hasAccountantDetails: false,
  lastActivity: null,
  createdAt: '2026-09-01T00:00:00.000Z',
}

const ARCHIVED: ClientSummary = {
  ...CLIENT,
  archivedAt: '2026-10-01T02:30:00.000Z',
  archivedReason: 'lead_deleted',
}

function mockFetch() {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function calls(fetchMock: ReturnType<typeof mockFetch>) {
  return (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(([url, init]) => [
    url,
    init?.method,
  ])
}

describe('ClientTable — the client list', () => {
  it('archives a row instead of deleting it', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch()
    render(<ClientTable clients={[CLIENT]} />)

    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Archive: Sample Trading' }))

    const dialog = screen.getByRole('dialog', { name: 'Archive this client?' })
    expect(dialog.textContent).toContain('Nothing is deleted')
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(calls(fetchMock)).toEqual([['/api/admin/clients/cl_1/archive', 'POST']])
  })

  it('links a row to the client page', () => {
    render(<ClientTable clients={[CLIENT]} />)
    expect(screen.getByRole('link', { name: 'View Sample Trading' }).getAttribute('href')).toBe(
      '/clients/cl_1',
    )
  })
})

describe('ClientTable — the Archive', () => {
  it('shows when and why each file was archived, and links to its Archive page', () => {
    render(<ClientTable clients={[ARCHIVED]} mode="archived" />)

    expect(screen.getByRole('columnheader', { name: 'Archived' })).toBeTruthy()
    expect(screen.getByText('Its lead was deleted')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View Sample Trading' }).getAttribute('href')).toBe(
      '/sbr/archive/cl_1',
    )
  })

  it('makes a file a client again', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch()
    render(<ClientTable clients={[ARCHIVED]} mode="archived" />)

    await user.click(screen.getByRole('button', { name: 'Make client again: Sample Trading' }))
    const dialog = screen.getByRole('dialog', { name: 'Make this a client again?' })
    await user.click(within(dialog).getByRole('button', { name: 'Make client again' }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(calls(fetchMock)).toEqual([['/api/admin/clients/cl_1/restore', 'POST']])
  })

  it('deletes a file permanently, after saying it cannot be undone', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch()
    render(<ClientTable clients={[ARCHIVED]} mode="archived" />)

    await user.click(screen.getByRole('button', { name: 'Delete permanently: Sample Trading' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete permanently?' })
    expect(dialog.textContent).toContain('cannot be undone')
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(calls(fetchMock)).toEqual([['/api/admin/clients/cl_1', 'DELETE']])
  })

  it('offers restore and permanent delete for a selection', async () => {
    const user = userEvent.setup()
    render(
      <ClientTable clients={[ARCHIVED, { ...ARCHIVED, id: 'cl_2', name: 'Other' }]} mode="archived" />,
    )
    await user.click(screen.getByLabelText('Select all clients'))

    expect(screen.getByRole('button', { name: 'Make client again selected' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete permanently selected' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Archive selected' })).toBeNull()
  })

  it('says so when the Archive is empty', () => {
    render(<ClientTable clients={[]} mode="archived" />)
    expect(screen.getByText('Nothing in the Archive.')).toBeTruthy()
  })
})

describe('ClientTable — clicking a row', () => {
  it('opens the file from anywhere on the row — the Archive page for an archived one', async () => {
    const user = userEvent.setup()
    render(<ClientTable clients={[ARCHIVED]} mode="archived" />)

    await user.click(screen.getByText('accounts@example.test'))
    expect(push).toHaveBeenCalledWith('/sbr/archive/cl_1')
  })

  it('opens the client page from a row on the client list', async () => {
    const user = userEvent.setup()
    render(<ClientTable clients={[CLIENT]} />)

    await user.click(screen.getByText('Sample Trading'))
    expect(push).toHaveBeenCalledWith('/clients/cl_1')
  })

  it('leaves the checkbox and the action buttons to do their own thing', async () => {
    const user = userEvent.setup()
    mockFetch()
    render(<ClientTable clients={[ARCHIVED]} mode="archived" />)

    await user.click(screen.getByLabelText('Select Sample Trading'))
    await user.click(screen.getByRole('button', { name: 'Delete permanently: Sample Trading' }))

    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Delete permanently?' })).toBeTruthy()
  })
})
