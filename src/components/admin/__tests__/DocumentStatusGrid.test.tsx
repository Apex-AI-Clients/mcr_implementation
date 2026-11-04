import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { DocumentStatusGrid } from '../DocumentStatusGrid'
import type { DocumentRecord } from '@/types/app'

/** The documents cards on the SBR and CVL client pages (one component for both). Synthetic data. */

afterEach(cleanup)

const activityStatement: DocumentRecord = {
  id: 'doc-1',
  clientId: 'cl_1',
  filePath: 'documents/cl_1/doc-1.csv',
  originalFilename: 'activity-statement.csv',
  fileType: 'text/csv',
  fileSizeBytes: 2048,
  docCategory: 'integrated_client_account',
  status: 'uploaded',
  uploadedAt: '2026-11-01T00:00:00Z',
}

const analysisLink = () => screen.queryByRole('link', { name: /Lodgement Compliance Analysis/ })

describe('DocumentStatusGrid: the ATO activity statement card', () => {
  it.each([
    ['SBR', undefined],
    ['CVL', '/cvl/cl_1'],
  ])('%s: no Lodgement Compliance Analysis button until an activity statement is uploaded', (_, basePath) => {
    render(<DocumentStatusGrid documents={[]} clientId="cl_1" basePath={basePath} />)
    expect(analysisLink()).toBeNull()
  })

  it.each([
    ['SBR', undefined, '/clients/cl_1/lodgement-compliance-analysis'],
    ['CVL', '/cvl/cl_1', '/cvl/cl_1/lodgement-compliance-analysis'],
  ])('%s: the button shows once one is uploaded', (_, basePath, href) => {
    render(<DocumentStatusGrid documents={[activityStatement]} clientId="cl_1" basePath={basePath} />)
    expect(analysisLink()?.getAttribute('href')).toBe(href)
  })
})
