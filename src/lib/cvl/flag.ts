/**
 * Whether the CVL workspace is switched on (NEXT_PUBLIC_CVL_ENABLED=true).
 *
 * Off unless set: no CVL link, button, tab or choice is shown anywhere, and
 * /cvl/* and /api/admin/cvl/* answer 404 (proxy.ts), as if CVL did not exist.
 * Read the same way on the server and in the browser (Next inlines
 * NEXT_PUBLIC_ variables at build time, so a change needs a new build).
 */
export function cvlEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CVL_ENABLED === 'true'
}

/** A path that belongs to CVL: its pages and its API. */
export function isCvlPath(pathname: string): boolean {
  return /^\/(cvl|api\/admin\/cvl)(\/|$)/.test(pathname)
}
