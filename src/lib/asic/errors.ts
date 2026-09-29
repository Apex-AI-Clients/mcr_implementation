/**
 * How a provider call can fail, told apart because the advice differs.
 *
 * Same shape as the ABR errors (src/lib/abr/service.ts): a timeout is a
 * subclass of "unavailable", so a caller that does not care can catch the
 * parent. Unlike ABR, a timeout on a *purchase* is not harmless — the provider
 * may have charged — which is why the purchase flow keeps its pending row and
 * retries with the same idempotency key rather than starting a new one.
 *
 * No message here ever includes a key, a request header or personal data. They
 * end up in logs.
 */

export class AsicUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AsicUnavailableError'
  }
}

export class AsicTimeoutError extends AsicUnavailableError {
  constructor(message: string) {
    super(message)
    this.name = 'AsicTimeoutError'
  }
}

/** The provider turned us away for going too fast. */
export class AsicRateLimitedError extends AsicUnavailableError {
  constructor(
    message: string,
    /** Seconds, from Retry-After. */
    readonly retryAfter: number,
  ) {
    super(message)
    this.name = 'AsicRateLimitedError'
  }
}

/**
 * The provider refused this request, and asking again unchanged will not help:
 * an ACN that fails the check digit, a company that is not on the register, a
 * company type with no current extract, an idempotency key reused for a
 * different request.
 *
 * `code` is the provider's stable code (e.g. 'company_not_found'), for branching
 * and for the reason tag on the API response. Never shown raw to staff.
 */
export class AsicRejectedError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'AsicRejectedError'
  }
}

/** Our key was refused (401/403). A deployment problem, not a staff one. */
export class AsicAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AsicAuthError'
  }
}

/** The provider answered 2xx with something that is not an extract. */
export class AsicResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AsicResponseError'
  }
}
