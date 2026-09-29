import {
  AsicAuthError,
  AsicRateLimitedError,
  AsicRejectedError,
  AsicResponseError,
  AsicTimeoutError,
  AsicUnavailableError,
} from '../errors'
import { mapAsicapiCompany, mapAsicapiExtract } from '../map'
import type { AsicCompany, AsicProvider, AsicPurchase, PurchaseOptions } from '../types'

/**
 * asicapi (https://www.asicapi.com/docs). SERVER ONLY.
 *
 * UNVERIFIED PROVIDER: no company name, ABN, pricing or terms on its site at
 * the time of writing. Use a sandbox key (asicapi_test_…) or ASIC_PROVIDER=demo
 * until that is resolved.
 *
 *   GET  /companies/{acn}            free — identity and status
 *   POST /companies/{acn}/extracts   PAID with a live key — {"type":"current"}
 *
 * The key goes in one header and nowhere else: not in a URL, not in a log
 * line, not in an error message. Errors carry the provider's stable `code`
 * (e.g. 'company_not_found') and our own wording, never the provider's message,
 * which might echo the request.
 *
 * Idempotency: asicapi replays the original response for a repeated
 * Idempotency-Key for 24 hours, and answers 409 idempotency_conflict if the
 * same key comes with a different body. The key is the caller's — one per
 * click, reused on retry — so a timeout followed by a retry cannot buy twice.
 */

/** A free lookup is interactive; a staff member is waiting on the answer. */
const LOOKUP_TIMEOUT_MS = 10_000
/** A purchase queries ASIC live and can be slow. Nothing else waits on it. */
const PURCHASE_TIMEOUT_MS = 30_000

/** asicapi's limit on X-Client-Reference. */
const MAX_CLIENT_REFERENCE = 30

export interface AsicapiOptions {
  key: string
  baseUrl: string
  mode: 'test' | 'live'
}

interface ErrorEnvelope {
  code: string
  type: string
}

async function readErrorEnvelope(response: Response): Promise<ErrorEnvelope> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; type?: unknown } }
    return {
      code: typeof body?.error?.code === 'string' ? body.error.code : '',
      type: typeof body?.error?.type === 'string' ? body.error.type : '',
    }
  } catch {
    return { code: '', type: '' }
  }
}

function retryAfterSeconds(response: Response): number {
  const value = Number(response.headers.get('Retry-After'))
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 30
}

/** A non-2xx answer -> the error that says what to do about it. */
async function failure(response: Response, what: string): Promise<Error> {
  const { code } = await readErrorEnvelope(response)
  const status = response.status

  if (status === 401 || status === 403) {
    return new AsicAuthError(`asicapi refused the key for ${what} (${status}${code ? ` ${code}` : ''}).`)
  }
  if (status === 429) {
    return new AsicRateLimitedError(`asicapi rate limited ${what}.`, retryAfterSeconds(response))
  }
  if (status >= 500) {
    return new AsicUnavailableError(`asicapi answered ${status} for ${what}.`)
  }
  return new AsicRejectedError(
    `asicapi rejected ${what} (${status}${code ? ` ${code}` : ''}).`,
    code || `http_${status}`,
    status,
  )
}

export function createAsicapiProvider({ key, baseUrl, mode }: AsicapiOptions): AsicProvider {
  async function call(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    what: string,
  ): Promise<Response> {
    try {
      return await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${key}`,
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      })
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new AsicTimeoutError(`asicapi did not answer ${what} within ${timeoutMs / 1_000}s.`)
      }
      const reason = err instanceof Error ? err.message : 'unknown error'
      throw new AsicUnavailableError(`Could not reach asicapi for ${what} (${reason}).`)
    }
  }

  async function json(response: Response, what: string): Promise<unknown> {
    try {
      return await response.json()
    } catch {
      throw new AsicResponseError(`asicapi sent a response to ${what} that is not JSON.`)
    }
  }

  return {
    name: 'asicapi',
    mode,

    async lookupCompany(acn: string): Promise<AsicCompany | null> {
      const what = 'the company lookup'
      const response = await call(
        `/companies/${encodeURIComponent(acn)}`,
        { method: 'GET' },
        LOOKUP_TIMEOUT_MS,
        what,
      )

      if (response.status === 404) return null
      if (!response.ok) throw await failure(response, what)

      const company = mapAsicapiCompany(await json(response, what))
      if (!company) throw new AsicResponseError(`asicapi's answer to ${what} had no ACN or name.`)
      return company
    },

    async purchaseCurrentExtract(acn: string, options: PurchaseOptions): Promise<AsicPurchase> {
      const what = 'the extract purchase'
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Idempotency-Key': options.idempotencyKey,
      }
      const reference = options.clientReference?.trim().slice(0, MAX_CLIENT_REFERENCE)
      if (reference) headers['X-Client-Reference'] = reference

      const response = await call(
        `/companies/${encodeURIComponent(acn)}/extracts`,
        { method: 'POST', headers, body: JSON.stringify({ type: 'current' }) },
        PURCHASE_TIMEOUT_MS,
        what,
      )

      // 404 on a purchase is not "no such company, show nothing" as it is on a
      // lookup — it is a purchase that did not happen, and the caller has to
      // record it as failed.
      if (!response.ok) throw await failure(response, what)

      return mapAsicapiExtract(await json(response, what), acn)
    },
  }
}
