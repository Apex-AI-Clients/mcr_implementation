// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Starting the reading of scanned statements (POST scan-read): it runs on the
 * server after the response, so leaving the page does not stop it; coming
 * back never starts a file again while its reading is running. Synthetic.
 */

const afterCalls: (() => Promise<void>)[] = []
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (fn: () => Promise<void>) => afterCalls.push(fn),
}))
vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn(() => ({})) }))
vi.mock('@/lib/auth/staff', () => ({ requireStaffUser: vi.fn(async () => ({ id: 'staff' })) }))
vi.mock('@/lib/printed/store', () => ({
  READER_VERSION: 'v1',
  loadFinancialDocuments: vi.fn(async () => [
    { id: 'fy23', file_path: 'c/fy23.pdf' },
    { id: 'fy24', file_path: 'c/fy24.pdf' },
    { id: 'fy25', file_path: 'c/fy25.pdf' },
  ]),
  loadStoredReads: vi.fn(async () => new Map([
    ['fy23', { read: { status: 'scan_pending' } }],
    ['fy24', { read: { status: 'scan_pending' } }],
    ['fy25', { read: { status: 'read' } }],
  ])),
}))
const jobs = new Map<string, { status: string; createdAt: string } | null>()
const runScanJob = vi.fn(async () => {})
vi.mock('@/lib/scan/job', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scan/jobState')>()
  return {
    closeDeadScanJobs: vi.fn(async () => {}),
    latestScanJob: vi.fn(async (_s: unknown, documentId: string) => jobs.get(documentId) ?? null),
    scanJobAlive: actual.scanJobAlive,
    runScanJob: (...args: unknown[]) => runScanJob(...(args as [])),
  }
})

const { POST } = await import('../scan-read/route')
const call = () => POST(new NextRequest('http://localhost/api/admin/clients/c1/scan-read', { method: 'POST' }), { params: Promise.resolve({ id: 'c1' }) })

beforeEach(() => {
  afterCalls.length = 0
  jobs.clear()
  runScanJob.mockClear()
})

describe('POST scan-read', () => {
  it('starts every file still waiting, after the response (it keeps going if the page is left)', async () => {
    const res = await call()
    expect(await res.json()).toEqual({ started: 2 })
    expect(runScanJob).not.toHaveBeenCalled()
    await afterCalls[0]()
    expect(runScanJob.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      expect.objectContaining({ documentId: 'fy23' }),
      expect.objectContaining({ documentId: 'fy24' }),
    ])
  })

  it('coming back while a file is being read does not start it again: only the one still waiting', async () => {
    jobs.set('fy23', { status: 'running', createdAt: new Date().toISOString() })
    const res = await call()
    expect(await res.json()).toEqual({ started: 1 })
    await afterCalls[0]()
    expect(runScanJob.mock.calls.map((c) => ((c as unknown[])[1] as { documentId: string }).documentId)).toEqual(['fy24'])
  })

  it('a reading that stopped long ago (the server ended it) is started again', async () => {
    jobs.set('fy23', { status: 'running', createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
    jobs.set('fy24', { status: 'running', createdAt: new Date().toISOString() })
    expect(await (await call()).json()).toEqual({ started: 1 })
  })
})
