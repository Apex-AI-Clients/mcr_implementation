import { describe, it, expect } from 'vitest'
import { archiveReasonLabel, archiveUpdate, clientHref, restoreUpdate } from '../archive'

const AT = new Date('2026-10-01T02:30:00.000Z')

describe('archiveUpdate / restoreUpdate', () => {
  it('sets the time, who and why together', () => {
    expect(archiveUpdate('lead_deleted', 'Gabby', AT)).toEqual({
      archived_at: '2026-10-01T02:30:00.000Z',
      archived_by: 'Gabby',
      archived_reason: 'lead_deleted',
      updated_at: '2026-10-01T02:30:00.000Z',
    })
  })

  it('clears all three on restore', () => {
    expect(restoreUpdate(AT)).toEqual({
      archived_at: null,
      archived_by: null,
      archived_reason: null,
      updated_at: '2026-10-01T02:30:00.000Z',
    })
  })
})

describe('archiveReasonLabel', () => {
  it('words both reasons', () => {
    expect(archiveReasonLabel('client_deleted')).toBe('Archived from the client file')
    expect(archiveReasonLabel('lead_deleted')).toBe('Its lead was deleted')
  })

  it('says nothing for a missing or unknown reason', () => {
    expect(archiveReasonLabel(null)).toBeNull()
    expect(archiveReasonLabel(undefined)).toBeNull()
    expect(archiveReasonLabel('something_else')).toBeNull()
  })
})

describe('clientHref', () => {
  it('sends an archived file to the Archive, and an active one to the client page', () => {
    expect(clientHref({ id: 'cl_1', archivedAt: '2026-10-01T00:00:00.000Z' })).toBe(
      '/sbr/archive/cl_1',
    )
    expect(clientHref({ id: 'cl_1', archivedAt: null })).toBe('/clients/cl_1')
    expect(clientHref({ id: 'cl_1' })).toBe('/clients/cl_1')
  })
})
