import { describe, expect, it } from 'vitest'
import { clientBase, clientFileHref, sharedPageRedirect, workspaceOf } from '../workspace'

/** Which workspace a client file is in, and where its pages are (migration 0039). Synthetic ids. */

describe('workspaceOf', () => {
  it('reads cvl as CVL and anything else as SBR', () => {
    expect(workspaceOf({ workflow: 'cvl' })).toBe('cvl')
    expect(workspaceOf({ workflow: 'sbr' })).toBe('sbr')
    expect(workspaceOf({ workflow: null })).toBe('sbr')
    expect(workspaceOf({})).toBe('sbr')
    expect(workspaceOf({ workflow: 'something else' })).toBe('sbr')
  })
})

describe('clientBase and clientFileHref', () => {
  it('puts SBR files under /clients and CVL files under /cvl', () => {
    expect(clientBase('cl_1')).toBe('/clients/cl_1')
    expect(clientBase('cl_1', 'cvl')).toBe('/cvl/cl_1')
  })

  it('opens an archived file in the Archive, whichever workspace it was in', () => {
    expect(clientFileHref({ id: 'cl_1', workflow: 'cvl' })).toBe('/cvl/cl_1')
    expect(clientFileHref({ id: 'cl_1', workflow: 'sbr' })).toBe('/clients/cl_1')
    expect(clientFileHref({ id: 'cl_1', workflow: 'cvl', archivedAt: '2026-10-01T00:00:00Z' })).toBe('/sbr/archive/cl_1')
  })
})

describe('sharedPageRedirect', () => {
  const open = { removed_at: null }
  const sbr = { id: 'cl_1', archived_at: null, workflow: 'sbr', cvl_cases: null }
  const cvl = { id: 'cl_1', archived_at: null, workflow: 'cvl', cvl_cases: open }
  const both = { id: 'cl_1', archived_at: null, workflow: 'sbr', cvl_cases: open }

  it('leaves a page in its own workspace alone', () => {
    expect(sharedPageRedirect(sbr, 'sbr', '/financials-comparison')).toBeNull()
    expect(sharedPageRedirect(cvl, 'cvl', '/financials-comparison')).toBeNull()
  })

  it('sends a page in the other workspace to the same page there', () => {
    expect(sharedPageRedirect(cvl, 'sbr', '/director-penalty-notices')).toBe('/cvl/cl_1/director-penalty-notices')
    expect(sharedPageRedirect(sbr, 'cvl', '/ato-accounts/a1')).toBe('/clients/cl_1/ato-accounts/a1')
  })

  it('leaves a file in both alone in either workspace (migration 0047)', () => {
    expect(sharedPageRedirect(both, 'sbr', '/intake')).toBeNull()
    expect(sharedPageRedirect(both, 'cvl', '/intake')).toBeNull()
    // Read as an array of one, as some queries return it.
    expect(sharedPageRedirect({ ...both, cvl_cases: [open] }, 'cvl')).toBeNull()
  })

  it('keeps a file archived from SBR in CVL, and one removed from CVL in SBR', () => {
    const archivedFromSbr = { ...both, archived_at: '2026-10-01T00:00:00Z' }
    expect(sharedPageRedirect(archivedFromSbr, 'cvl')).toBeNull()
    expect(sharedPageRedirect(archivedFromSbr, 'sbr', '/intake')).toBe('/cvl/cl_1/intake')
    const removedFromCvl = { ...both, cvl_cases: { removed_at: '2026-10-01T00:00:00Z' } }
    expect(sharedPageRedirect(removedFromCvl, 'sbr')).toBeNull()
    expect(sharedPageRedirect(removedFromCvl, 'cvl', '/intake')).toBe('/clients/cl_1/intake')
  })

  it('sends a file in neither to the Archive from either workspace', () => {
    const archived = { ...cvl, archived_at: '2026-10-01T00:00:00Z', cvl_cases: { removed_at: '2026-10-01T00:00:00Z' } }
    expect(sharedPageRedirect(archived, 'cvl')).toBe('/sbr/archive/cl_1')
    expect(sharedPageRedirect(archived, 'sbr')).toBe('/sbr/archive/cl_1')
  })
})
