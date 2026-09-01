import { describe, it, expect } from 'vitest'
import { WORKSPACES, workspaceForPath } from '../workspaces'

/**
 * `workspaceForPath` decides both whether AdminSidebar renders at all and which
 * nav it shows, so the prefix matching is worth pinning down.
 */

describe('WORKSPACES', () => {
  it('lists CRM first — it comes first in the workflow', () => {
    expect(WORKSPACES.map((w) => w.id)).toEqual(['leads', 'sbr'])
  })

  it('names the workspaces CRM and SBR', () => {
    expect(WORKSPACES.map((w) => w.name)).toEqual(['CRM', 'SBR'])
  })

  it('gives SBR a sidebar and CRM a top bar', () => {
    // AdminSidebar and WorkspaceTopBar both key off this, so exactly one of
    // them renders for any workspace route.
    const chrome = Object.fromEntries(WORKSPACES.map((w) => [w.id, w.chrome]))
    expect(chrome).toEqual({ leads: 'topbar', sbr: 'sidebar' })
  })

  it('only gives a sidebar to a workspace with more than one nav item', () => {
    for (const workspace of WORKSPACES) {
      if (workspace.nav.length <= 1) expect(workspace.chrome).toBe('topbar')
    }
  })

  it('gives the SBR workspace Dashboard and Clients', () => {
    const sbr = WORKSPACES.find((w) => w.id === 'sbr')!
    expect(sbr.nav.map((n) => [n.label, n.href])).toEqual([
      ['Dashboard', '/sbr'],
      ['Clients', '/clients'],
    ])
  })

  it('gives the CRM workspace Leads', () => {
    const leads = WORKSPACES.find((w) => w.id === 'leads')!
    expect(leads.nav.map((n) => [n.label, n.href])).toEqual([['Leads', '/leads']])
  })
})

describe('workspaceForPath', () => {
  it('returns null for the chooser — no sidebar on "/"', () => {
    expect(workspaceForPath('/')).toBeNull()
  })

  it.each([
    ['/leads', 'leads'],
    ['/leads/ld_01', 'leads'],
    ['/sbr', 'sbr'],
    ['/clients', 'sbr'],
    ['/clients/abc-123', 'sbr'],
    ['/clients/abc-123/outcome-prediction', 'sbr'],
    ['/clients/new/intake', 'sbr'],
  ])('maps %s to the %s workspace', (pathname, expected) => {
    expect(workspaceForPath(pathname)?.id).toBe(expected)
  })

  it.each(['/leadstuff', '/sbrx', '/clientsomething'])(
    'does not match %s on a partial segment',
    (pathname) => {
      expect(workspaceForPath(pathname)).toBeNull()
    },
  )

  it.each(['/login', '/settings', '/unknown'])('returns null for %s', (pathname) => {
    expect(workspaceForPath(pathname)).toBeNull()
  })
})
