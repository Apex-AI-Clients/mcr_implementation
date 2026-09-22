import { parseAbnDetails, parseMatchingNames } from './parse'
import type { AbrEntityDetails, AbrSearchResponse } from './types'

/**
 * Server-side ABR client. SERVER ONLY.
 *
 * ABR_GUID must never reach the browser. The register's own integration guide
 * has you put the GUID in a <script src> on the page, which publishes it to
 * anyone who views source; the two routes in src/app/api/abr exist so it stays
 * here instead.
 *
 * Nothing in src/components may import this module.
 */

const ABR_BASE = 'https://abr.business.gov.au/json'

/**
 * How long to wait for the register.
 *
 * Was 5s, which was too tight and produced the failure it was meant to prevent:
 * the first search for a term ABR has not served recently can take well over
 * five seconds, and the same search a moment later comes straight back. Staff
 * saw a lookup fail and then work on a retype, which reads as random.
 *
 * Ten is affordable because nothing waits on this. The field stays typeable
 * throughout, a slow answer only holds a spinner in a dropdown, and a superseded
 * search is abandoned by the browser long before this fires.
 */
const TIMEOUT_MS = 10_000

/** ABR pages its own results; more than this is a search that needs narrowing,
 *  not a longer list. */
const MAX_RESULTS = 20

export class AbrUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AbrUnavailableError'
  }
}

/**
 * The register was reachable but too slow.
 *
 * A subclass, so every existing `instanceof AbrUnavailableError` still holds,
 * but callers that care can tell the two apart — and they should. "Ask again"
 * is good advice for a timeout and useless for a 500, and collapsing them into
 * one message is what made the first live failure impossible to read.
 */
export class AbrTimeoutError extends AbrUnavailableError {
  constructor(message: string) {
    super(message)
    this.name = 'AbrTimeoutError'
  }
}

/**
 * The registered GUID, or null when the deployment has none.
 *
 * Null is a supported state, not a misconfiguration to throw on: the routes
 * answer 503 and the UI hides the lookup control entirely, so conversion works
 * exactly as it did before lookup existed.
 */
export function abrGuid(): string | null {
  const guid = process.env.ABR_GUID?.trim()
  return guid ? guid : null
}

export function isAbrConfigured(): boolean {
  return abrGuid() !== null
}

async function fetchJsonp(url: URL): Promise<string> {
  let response: Response
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/javascript, text/plain, */*' },
      cache: 'no-store',
    })
  } catch (err) {
    // A timeout is its own thing and is kept that way. AbortSignal.timeout
    // rejects with a TimeoutError; an AbortError means the signal fired for
    // some other reason, which from here amounts to the same outcome.
    const name = err instanceof Error ? err.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new AbrTimeoutError(`The ABR did not answer within ${TIMEOUT_MS / 1_000}s.`)
    }

    // DNS, TLS, connection refused — the register was not reachable at all.
    const reason = err instanceof Error ? err.message : 'unknown error'
    throw new AbrUnavailableError(`Could not reach the ABR (${reason}).`)
  }

  if (!response.ok) {
    throw new AbrUnavailableError(`The ABR answered ${response.status}.`)
  }

  return response.text()
}

/** MatchingNames.aspx — entity and business names matching free text. */
export async function searchAbrNames(name: string, guid: string): Promise<AbrSearchResponse> {
  const url = new URL(`${ABR_BASE}/MatchingNames.aspx`)
  url.searchParams.set('name', name)
  url.searchParams.set('guid', guid)
  url.searchParams.set('maxResults', String(MAX_RESULTS))

  return parseMatchingNames(await fetchJsonp(url))
}

// ============================================================
// ABN details, cached
// ============================================================

/**
 * Registration details change on the order of years, and the same handful of
 * companies get looked up over and over while a matter is being set up. A day
 * is well inside the register's own update cadence.
 *
 * LIMIT: in-memory and per serverless instance, like the ingestion rate limiter.
 * It saves the repeat lookups that actually happen — the same staff member,
 * the same company, twice in five minutes — and resets on deploy. That is the
 * whole intent; it is not a shared cache.
 *
 * Only successes are cached. A timeout must be retryable immediately.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000
const MAX_CACHE_ENTRIES = 500

interface CacheEntry {
  details: AbrEntityDetails | null
  storedAt: number
}

const cache = new Map<string, CacheEntry>()

/** Test seam. */
export function resetAbrCache(): void {
  cache.clear()
}

function readCache(abn: string, now: number): CacheEntry | undefined {
  const entry = cache.get(abn)
  if (!entry) return undefined
  if (now - entry.storedAt > CACHE_TTL_MS) {
    cache.delete(abn)
    return undefined
  }
  return entry
}

function writeCache(abn: string, details: AbrEntityDetails | null, now: number): void {
  cache.set(abn, { details, storedAt: now })
  if (cache.size <= MAX_CACHE_ENTRIES) return
  // Insertion-ordered, so the oldest keys come out first.
  for (const key of cache.keys()) {
    cache.delete(key)
    if (cache.size <= MAX_CACHE_ENTRIES) break
  }
}

/**
 * AbnDetails.aspx. Null means the register answered and has no such entity.
 *
 * A null is cached too: a mistyped ABN gets retried by hand more than once,
 * and the register's answer to it is just as stable as a hit.
 */
export async function fetchAbnDetails(
  abn: string,
  guid: string,
  now: number = Date.now(),
): Promise<{ details: AbrEntityDetails | null; cached: boolean }> {
  const cached = readCache(abn, now)
  if (cached) return { details: cached.details, cached: true }

  const url = new URL(`${ABR_BASE}/AbnDetails.aspx`)
  url.searchParams.set('abn', abn)
  url.searchParams.set('guid', guid)

  const details = parseAbnDetails(await fetchJsonp(url))
  writeCache(abn, details, now)
  return { details, cached: false }
}
