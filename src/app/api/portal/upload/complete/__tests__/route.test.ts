// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/auth/staff', () => ({ requireStaffUser: vi.fn() }))
vi.mock('@/lib/storage/upload', () => ({
  getStoredObjectInfo: vi.fn(async () => ({ size: 1000, contentType: 'application/pdf' })),
  removeFromStorage: vi.fn(),
}))
vi.mock('@/lib/clients/status', () => ({ recomputeClientStatus: vi.fn() }))
vi.mock('@/lib/dpn/store', () => ({
  DPN_CATEGORY: 'director_penalty_notices',
  clearNoneIssued: vi.fn(),
  readAndStoreNotice: vi.fn(),
}))
vi.mock('@/lib/analysis/autoRun', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analysis/autoRun')>()),
  scheduleClientAnalysis: vi.fn(async () => ({ jobId: 'job-1', started: true })),
}))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { clearNoneIssued, readAndStoreNotice } from '@/lib/dpn/store'
import { scheduleClientAnalysis } from '@/lib/analysis/autoRun'
import { getStoredObjectInfo } from '@/lib/storage/upload'
import { POST } from '../route'

/**
 * Upload completion: a director penalty notice is read straight away, and the
 * client's analyses are scheduled to run in the background.
 */

const DOCUMENT = { id: 'doc-1', client_id: 'client-1', file_path: 'client-1/a.pdf' }

function request(category: string) {
  return new NextRequest('http://localhost/api/portal/upload/complete', {
    method: 'POST',
    body: JSON.stringify({ client_id: 'client-1', path: 'client-1/a.pdf', filename: 'a.pdf', doc_category: category }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireStaffUser).mockResolvedValue({ id: 'staff-1' } as never)
  const single = vi.fn(async () => ({ data: DOCUMENT, error: null }))
  vi.mocked(getSupabaseServerClient).mockReturnValue({
    from: () => ({ insert: () => ({ select: () => ({ single }) }) }),
  } as never)
})

describe('POST /api/portal/upload/complete', () => {
  it('reads a DPN and clears "none issued" on upload', async () => {
    const response = await POST(request('director_penalty_notices'))
    expect(response.status).toBe(201)
    expect(clearNoneIssued).toHaveBeenCalledWith(expect.anything(), 'client-1')
    expect(readAndStoreNotice).toHaveBeenCalledWith(expect.anything(), DOCUMENT)
  })

  it('leaves other categories alone', async () => {
    await POST(request('trust_deed'))
    expect(clearNoneIssued).not.toHaveBeenCalled()
    expect(readAndStoreNotice).not.toHaveBeenCalled()
    expect(scheduleClientAnalysis).not.toHaveBeenCalled()
  })

  it.each([['financial_statements'], ['integrated_client_account'], ['director_penalty_notices']])(
    'schedules the analysis after a %s upload',
    async (category) => {
      // The account category takes CSVs only.
      if (category === 'integrated_client_account') {
        vi.mocked(getStoredObjectInfo).mockResolvedValueOnce({ size: 1000, contentType: 'text/csv' } as never)
      }
      await POST(request(category))
      expect(scheduleClientAnalysis).toHaveBeenCalledWith(expect.anything(), 'client-1', expect.any(Function))
    },
  )

  it('still records the upload when the read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(readAndStoreNotice).mockRejectedValue(new Error('boom'))
    const response = await POST(request('director_penalty_notices'))
    expect(response.status).toBe(201)
  })
})
