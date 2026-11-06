/**
 * Which workspaces a client file is in, and where its pages live there.
 *
 * A file can be in SBR and CVL at the same time (migration 0047):
 *
 *   In SBR  clients.workflow = 'sbr' and not archived
 *   In CVL  its CVL case (cvl_cases) is not removed from CVL
 *
 * workflow 'cvl' marks a file that only ever was CVL (from a lead). Its
 * documents, details and analyses are keyed on the client, so the same
 * comparison, ATO account and DPN pages serve both workspaces, each under its
 * own path so staff stay in the workspace they are working in:
 *
 *   SBR  /clients/{id}/…
 *   CVL  /cvl/{id}/…
 *
 * The outcome prediction and the readiness checklist are SBR only.
 */

export type ClientWorkspace = 'sbr' | 'cvl'

export const CLIENT_WORKSPACES: readonly ClientWorkspace[] = ['sbr', 'cvl']

/** A stored workflow read safely: anything unknown is SBR, where every file started. 'cvl': a CVL-only file. */
export function workspaceOf(client: { workflow?: string | null }): ClientWorkspace {
  return client.workflow === 'cvl' ? 'cvl' : 'sbr'
}

/** The client page in a workspace; sub-pages hang off it ("/financials-comparison"). */
export function clientBase(clientId: string, workspace: ClientWorkspace = 'sbr'): string {
  return workspace === 'cvl' ? `/cvl/${clientId}` : `/clients/${clientId}`
}

/** A client's CVL case as read with it (`cvl_cases(removed_at)`): one row, an array of one, or none. */
export type CvlCaseLink = { removed_at: string | null } | { removed_at: string | null }[] | null | undefined

/** Which workspaces the file is in now. */
export function membershipOf(
  client: { workflow?: string | null; archived_at?: string | null },
  cvlCase: CvlCaseLink,
): Record<ClientWorkspace, boolean> {
  const c = Array.isArray(cvlCase) ? (cvlCase[0] ?? null) : (cvlCase ?? null)
  return {
    sbr: workspaceOf(client) === 'sbr' && !client.archived_at,
    cvl: !!c && !c.removed_at,
  }
}

/** Where a client file is opened: the Archive when archived, else its own workspace. */
export function clientFileHref(client: {
  id: string
  archivedAt?: string | null
  workflow?: string | null
}): string {
  if (client.archivedAt) return `/sbr/archive/${client.id}`
  return clientBase(client.id, workspaceOf(client))
}

/**
 * For a page shared by both workspaces: where to send the browser instead, or
 * null when the file is in this workspace. A file only in the other workspace
 * opens the same page there; a file in neither is read in the Archive.
 *
 * @param client with its CVL case, read as `cvl_cases(removed_at)`
 * @param sub the page under the client, e.g. "/financials-comparison"
 */
export function sharedPageRedirect(
  client: { id: string; archived_at: string | null; workflow?: string | null; cvl_cases?: CvlCaseLink },
  workspace: ClientWorkspace,
  sub = '',
): string | null {
  const inside = membershipOf(client, client.cvl_cases)
  if (inside[workspace]) return null
  const other: ClientWorkspace = workspace === 'sbr' ? 'cvl' : 'sbr'
  if (inside[other]) return `${clientBase(client.id, other)}${sub}`
  return `/sbr/archive/${client.id}`
}

/** What a page shared by both workspaces is rendered with. */
export interface ClientPageView {
  id: string
  workspace: ClientWorkspace
}
