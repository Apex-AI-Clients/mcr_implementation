import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { cvlEnabled, isCvlPath } from '../flag'
import { homeFor } from '@/lib/lastWorkspace'
import { ClientTable } from '@/components/admin/ClientTable'
import type { ClientSummary } from '@/types/app'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }))

/** CVL switched off (NEXT_PUBLIC_CVL_ENABLED not "true"): nothing shows it exists. Synthetic data. */

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

const off = () => vi.stubEnv('NEXT_PUBLIC_CVL_ENABLED', '')

describe('the CVL switch', () => {
  it('is on only for "true"', () => {
    vi.stubEnv('NEXT_PUBLIC_CVL_ENABLED', 'true')
    expect(cvlEnabled()).toBe(true)
    for (const v of ['', 'false', '1', 'TRUE']) {
      vi.stubEnv('NEXT_PUBLIC_CVL_ENABLED', v)
      expect(cvlEnabled(), v).toBe(false)
    }
  })

  it('knows the CVL pages and API, and nothing else', () => {
    for (const p of ['/cvl', '/cvl/abc/forms/509', '/cvl/settings', '/api/admin/cvl/convert', '/api/admin/cvl/case-1/preview']) expect(isCvlPath(p), p).toBe(true)
    for (const p of ['/cvlx', '/clients/abc', '/sbr/archive', '/api/admin/clients', '/api/admin/clients/abc/asic-extract']) expect(isCvlPath(p), p).toBe(false)
  })

  it('never opens the app on CVL while it is off', () => {
    off()
    expect(homeFor('cvl')).toBe('/leads')
    expect(homeFor('sbr')).toBe('/sbr')
  })

  it('shows no Workflow column in the Archive while it is off', () => {
    off()
    const archived: ClientSummary = {
      id: 'cl_1', name: 'Sample Trading', email: 'a@example.test', status: 'in_progress', docsReceived: 0, docsTotal: 5,
      atoAdminConfirmed: false, hasAccountantDetails: false, lastActivity: null, createdAt: '2026-10-01T00:00:00Z',
      archivedAt: '2026-10-02T00:00:00Z', archivedReason: 'client_deleted', workflow: 'cvl',
    }
    render(<ClientTable clients={[archived]} mode="archived" />)
    expect(screen.queryByRole('columnheader', { name: 'Workflow' })).toBeNull()
    expect(screen.queryByText('CVL')).toBeNull()
  })
})
