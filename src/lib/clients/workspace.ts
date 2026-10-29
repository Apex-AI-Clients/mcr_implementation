/**
 * Which workspace a client file is in (clients.workflow, migration 0039), and
 * where its pages live there.
 *
 * A file is in one workspace at a time. Its documents, details and analyses
 * are keyed on the client, so the same comparison, ATO account and DPN pages
 * serve both workspaces, each under its own path so staff stay in the
 * workspace they are working in:
 *
 *   SBR  /clients/{id}/…
 *   CVL  /cvl/{id}/…
 *
 * The outcome prediction and the readiness checklist are SBR only. A client
 * moved to CVL keeps its SBR record read-only, in the SBR Archive.
 */

export type ClientWorkspace = 'sbr' | 'cvl'

export const CLIENT_WORKSPACES: readonly ClientWorkspace[] = ['sbr', 'cvl']

/** A stored workflow read safely: anything unknown is SBR, where every file started. */
export function workspaceOf(client: { workflow?: string | null }): ClientWorkspace {
  return client.workflow === 'cvl' ? 'cvl' : 'sbr'
}

/** The client page in a workspace; sub-pages hang off it ("/financials-comparison"). */
export function clientBase(clientId: string, workspace: ClientWorkspace = 'sbr'): string {
  return workspace === 'cvl' ? `/cvl/${clientId}` : `/clients/${clientId}`
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
 * null when the page is in the right place. An archived file is read in the
 * Archive; a file in the other workspace opens the same page there.
 *
 * @param sub the page under the client, e.g. "/financials-comparison"
 */
export function sharedPageRedirect(
  client: { id: string; archived_at: string | null; workflow?: string | null },
  workspace: ClientWorkspace,
  sub = '',
): string | null {
  if (client.archived_at) return `/sbr/archive/${client.id}`
  const home = workspaceOf(client)
  return home === workspace ? null : `${clientBase(client.id, home)}${sub}`
}

/** What a page shared by both workspaces is rendered with. */
export interface ClientPageView {
  id: string
  workspace: ClientWorkspace
}
