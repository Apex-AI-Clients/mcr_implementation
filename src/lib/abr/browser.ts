import type { AbrEntityDetails, AbrNameMatch } from './types'

/**
 * Browser edge of the ABR proxy.
 *
 * Results rather than exceptions, the same shape src/lib/leads/convert.ts uses:
 * every failure here is a thing to say quietly next to a search box, and none
 * of them is allowed to escape and take the conversion dialog down with it.
 *
 * Imports types only. Nothing on this side of the wire ever sees the GUID.
 */

export type AbrSearchResult =
  | { kind: 'ok'; matches: AbrNameMatch[]; message: string }
  | { kind: 'failed'; message: string }

export type AbrDetailsResult =
  | { kind: 'ok'; details: AbrEntityDetails }
  | { kind: 'failed'; message: string }

const UNREACHABLE = "Couldn't reach the lookup service. Enter the details by hand."

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json()
    const error = (body as { error?: unknown } | null)?.error
    return typeof error === 'string' && error ? error : fallback
  } catch {
    return fallback
  }
}

/**
 * Whether this deployment has an ABR registration at all.
 *
 * Asked once per page load and remembered — the answer is a deployment fact,
 * and re-asking it every time the dialog opens would make the lookup control
 * flicker in on each open.
 *
 * Any failure answers "not available", which hides the control. Erring towards
 * hidden is right: the fallback is the form staff already know how to fill in.
 */
let configuredProbe: Promise<boolean> | null = null

export function abrConfigured(): Promise<boolean> {
  configuredProbe ??= fetch('/api/abr/status', { headers: { Accept: 'application/json' } })
    .then((response) => (response.ok ? response.json() : { configured: false }))
    .then((body: { configured?: unknown }) => body?.configured === true)
    .catch(() => false)
  return configuredProbe
}

/** Test seam — the probe is memoised for the life of the page. */
export function resetAbrConfiguredProbe(): void {
  configuredProbe = null
}

export async function searchAbr(name: string, signal?: AbortSignal): Promise<AbrSearchResult> {
  let response: Response
  try {
    response = await fetch(`/api/abr/search?name=${encodeURIComponent(name)}`, {
      headers: { Accept: 'application/json' },
      signal,
    })
  } catch (err) {
    // An aborted request is a superseded keystroke, not a failure to report.
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    return { kind: 'failed', message: UNREACHABLE }
  }

  if (!response.ok) {
    return { kind: 'failed', message: await errorMessage(response, UNREACHABLE) }
  }

  try {
    const body = (await response.json()) as { matches?: AbrNameMatch[]; message?: string }
    return { kind: 'ok', matches: body.matches ?? [], message: body.message ?? '' }
  } catch {
    return { kind: 'failed', message: UNREACHABLE }
  }
}

export async function lookupAbn(abn: string): Promise<AbrDetailsResult> {
  let response: Response
  try {
    response = await fetch(`/api/abr/abn?abn=${encodeURIComponent(abn)}`, {
      headers: { Accept: 'application/json' },
    })
  } catch {
    return { kind: 'failed', message: UNREACHABLE }
  }

  if (!response.ok) {
    return { kind: 'failed', message: await errorMessage(response, UNREACHABLE) }
  }

  try {
    const body = (await response.json()) as { details?: AbrEntityDetails }
    if (!body.details) return { kind: 'failed', message: UNREACHABLE }
    return { kind: 'ok', details: body.details }
  } catch {
    return { kind: 'failed', message: UNREACHABLE }
  }
}
