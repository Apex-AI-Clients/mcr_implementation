import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  AbrTimeoutError,
  AbrUnavailableError,
  fetchAbnDetails,
  resetAbrCache,
  searchAbrNames,
} from '../service'
import { JsonpParseError } from '../jsonp'
import { abrFailureResponse } from '../routeError'

/**
 * How a failed lookup is classified.
 *
 * This exists because of a live failure that could not be read: a search timed
 * out, the route flattened it into the same 502 and the same sentence as every
 * other failure, and the symptom staff saw was a lookup that failed once and
 * then worked on a retype. A timeout and a broken register need different
 * advice, so they are told apart here and the distinction is asserted.
 *
 * Offline: fetch is stubbed throughout, and no ABR_GUID is needed.
 */

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', `${name}.txt`), 'utf8')
}

/** What Node's fetch rejects with when AbortSignal.timeout fires. */
function timeoutError(): Error {
  const err = new Error('The operation was aborted due to timeout')
  err.name = 'TimeoutError'
  return err
}

beforeEach(() => {
  resetAbrCache()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Typed with fetch's own first parameter, so call assertions can read the URL. */
function stubFetch(impl: (input: RequestInfo | URL) => Promise<Response>) {
  const mock = vi.fn(impl)
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('searchAbrNames', () => {
  it('parses a successful response', async () => {
    stubFetch(async () => new Response(fixture('matching_names_multi')))
    const result = await searchAbrNames('whitlock civil', 'test-guid')
    expect(result.matches[0].entityName).toBe('WHITLOCK CIVIL PTY LTD')
  })

  it('sends the guid and the search term, and asks for a capped result set', async () => {
    const mock = stubFetch(async () => new Response(fixture('matching_names_multi')))
    await searchAbrNames('whitlock civil', 'test-guid')

    const url = new URL(String(mock.mock.calls[0][0]))
    expect(url.pathname).toBe('/json/MatchingNames.aspx')
    expect(url.searchParams.get('name')).toBe('whitlock civil')
    expect(url.searchParams.get('guid')).toBe('test-guid')
    expect(url.searchParams.get('maxResults')).toBe('20')
  })

  it('does not care how the search term is cased — it is passed through as given', async () => {
    // "MCR partner" failing where "mcr partner" succeeded was never about case.
    // Both produce the same request; only the register's speed differed.
    const mock = stubFetch(async () => new Response(fixture('matching_names_multi')))
    await searchAbrNames('MCR partner', 'test-guid')
    await searchAbrNames('mcr partner', 'test-guid')

    const [first, second] = mock.mock.calls.map(([input]) => new URL(String(input)))
    expect(first.searchParams.get('name')).toBe('MCR partner')
    expect(second.searchParams.get('name')).toBe('mcr partner')
    expect(first.pathname).toBe(second.pathname)
  })

  it('raises a timeout as its own error, not a generic failure', async () => {
    stubFetch(async () => {
      throw timeoutError()
    })
    await expect(searchAbrNames('whitlock', 'test-guid')).rejects.toBeInstanceOf(AbrTimeoutError)
  })

  it('raises a connection failure as unavailable, not a timeout', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })
    const failure = searchAbrNames('whitlock', 'test-guid')
    await expect(failure).rejects.toBeInstanceOf(AbrUnavailableError)
    await expect(failure).rejects.not.toBeInstanceOf(AbrTimeoutError)
  })

  it('raises a non-200 as unavailable', async () => {
    stubFetch(async () => new Response('nope', { status: 503 }))
    await expect(searchAbrNames('whitlock', 'test-guid')).rejects.toBeInstanceOf(
      AbrUnavailableError,
    )
  })

  it('raises the HTML error page the register serves with a 200 as a parse failure', async () => {
    stubFetch(async () => new Response('<html><body>Service Unavailable</body></html>'))
    await expect(searchAbrNames('whitlock', 'test-guid')).rejects.toBeInstanceOf(JsonpParseError)
  })
})

describe('fetchAbnDetails', () => {
  it('parses a successful response', async () => {
    stubFetch(async () => new Response(fixture('abn_details_company')))
    const { details, cached } = await fetchAbnDetails('53004085616', 'test-guid')
    expect(details?.entityTypeCode).toBe('PRV')
    expect(cached).toBe(false)
  })

  it('serves a repeat lookup from cache without going out again', async () => {
    const mock = stubFetch(async () => new Response(fixture('abn_details_company')))
    await fetchAbnDetails('53004085616', 'test-guid')
    const second = await fetchAbnDetails('53004085616', 'test-guid')

    expect(second.cached).toBe(true)
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('expires a cached entry once it is old enough', async () => {
    const mock = stubFetch(async () => new Response(fixture('abn_details_company')))
    const now = Date.now()
    await fetchAbnDetails('53004085616', 'test-guid', now)
    await fetchAbnDetails('53004085616', 'test-guid', now + 25 * 60 * 60 * 1_000)

    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('never caches a timeout — it has to be retryable straight away', async () => {
    const mock = stubFetch(async () => {
      throw timeoutError()
    })
    await expect(fetchAbnDetails('53004085616', 'test-guid')).rejects.toBeInstanceOf(
      AbrTimeoutError,
    )
    await expect(fetchAbnDetails('53004085616', 'test-guid')).rejects.toBeInstanceOf(
      AbrTimeoutError,
    )
    expect(mock).toHaveBeenCalledTimes(2)
  })
})

describe('abrFailureResponse', () => {
  it('answers a timeout with 504 and advice to try again', async () => {
    const response = abrFailureResponse('GET /api/abr/search', new AbrTimeoutError('too slow'))
    expect(response.status).toBe(504)

    const body = await response.json()
    expect(body.reason).toBe('timeout')
    expect(body.error).toMatch(/too slow/i)
    expect(body.error).toMatch(/search again/i)
  })

  it('answers an unreachable register with 502', async () => {
    const response = abrFailureResponse('GET /api/abr/search', new AbrUnavailableError('down'))
    expect(response.status).toBe(502)
    expect((await response.json()).reason).toBe('unreachable')
  })

  it('answers an unparseable body with 502 and says so', async () => {
    const response = abrFailureResponse('GET /api/abr/search', new JsonpParseError('not json'))
    expect(response.status).toBe(502)
    expect((await response.json()).reason).toBe('unparseable')
  })

  it('answers a bug on our side with 500, kept apart from the register’s faults', async () => {
    const response = abrFailureResponse('GET /api/abr/search', new Error('oops'))
    expect(response.status).toBe(500)
    expect((await response.json()).reason).toBe('unexpected')
  })

  it('never leaks the internal detail into what a person is shown', async () => {
    const response = abrFailureResponse(
      'GET /api/abr/search',
      new AbrUnavailableError('ECONNREFUSED 10.0.0.1:443'),
    )
    expect(await response.text()).not.toContain('10.0.0.1')
  })
})
