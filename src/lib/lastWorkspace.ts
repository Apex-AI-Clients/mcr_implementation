/**
 * The workspace a staff member used last, so opening the app (`/`) goes back
 * to it; Leads when there is none (Gabby, 22 Oct). Set by proxy.ts on every
 * page inside a workspace.
 *
 * Kept apart from workspaces.ts, which pulls in the nav icons, so the proxy
 * stays small. A test holds the two to the same routes.
 */

export const LAST_WORKSPACE_COOKIE = 'mcr_last_workspace'

/** Where each workspace opens, by its id in workspaces.ts. */
export const WORKSPACE_HOMES = { leads: '/leads', sbr: '/sbr' } as const

export type LastWorkspace = keyof typeof WORKSPACE_HOMES

const PREFIXES: Array<[string, LastWorkspace]> = [
  ['/leads', 'leads'],
  ['/sbr', 'sbr'],
  ['/clients', 'sbr'],
]

/** The workspace a page belongs to, or null (the root, login, intake …). */
export function lastWorkspaceForPath(pathname: string): LastWorkspace | null {
  const match = PREFIXES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  return match ? match[1] : null
}

/** Where `/` sends someone: their last workspace, else Leads. */
export function homeFor(cookieValue: string | undefined): string {
  return cookieValue && cookieValue in WORKSPACE_HOMES ? WORKSPACE_HOMES[cookieValue as LastWorkspace] : WORKSPACE_HOMES.leads
}
