import { describe, it, expect } from 'vitest'
import { homeFor, lastWorkspaceForPath, WORKSPACE_HOMES } from '../lastWorkspace'
import { WORKSPACES, workspaceForPath } from '../workspaces'

/** Opening the app goes back to the last workspace used; Leads the first time. */

describe('last workspace', () => {
  it('opens on Leads when there is none, or an unknown one', () => {
    expect(homeFor(undefined)).toBe('/leads')
    expect(homeFor('elsewhere')).toBe('/leads')
  })

  it('goes back to the workspace used last', () => {
    expect(homeFor('sbr')).toBe('/sbr')
    expect(homeFor('leads')).toBe('/leads')
  })

  it('agrees with workspaces.ts on every route and home', () => {
    for (const path of ['/leads', '/leads/abc', '/sbr', '/sbr/archive', '/clients', '/clients/abc/outcome-prediction', '/', '/login', '/leadsx']) {
      expect(lastWorkspaceForPath(path)).toBe(workspaceForPath(path)?.id ?? null)
    }
    for (const workspace of WORKSPACES) expect(WORKSPACE_HOMES[workspace.id]).toBe(workspace.href)
  })
})
