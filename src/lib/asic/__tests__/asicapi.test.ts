import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createAsicapiProvider } from '../providers/asicapi'
import {
  AsicAuthError,
  AsicRateLimitedError,
  AsicRejectedError,
  AsicResponseError,
  AsicTimeoutError,
  AsicUnavailableError,
} from '../errors'

/**
 * The asicapi client, offline. fetch is stubbed throughout; the key is fake.
 *
 * What is asserted beyond "it parses": the key travels in the Authorization
 * header and nowhere else, the idempotency key is the caller's and is sent
 * unchanged, and every failure is classified so the route can give the right
 * advice — above all a purchase timeout, which may have been charged.
 */

const KEY = 'asicapi_test_FAKEKEY0000'
const BASE = 'https://api.example.test/v1'
const IDEMPOTENCY_KEY = '3f1c2a9e-0000-4000-8000-000000000001'

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8')
}

function provider() {
  return createAsicapiProvider({ key: KEY, baseUrl: BASE, mode: 'test' })
}

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl)
  vi.stubGlobal('fetch', mock)
  return mock
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    })
}

function errorBody(code: string) {
  return { error: { type: 'x', code, message: `echo of request with ${KEY}`, requestId: 'req_1' } }
}

/** The thrown error, for asserting on its class and its text. */
async function thrown(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (err) {
    return err as Error
  }
  throw new Error('expected a rejection')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('lookupCompany', () => {
  it('calls the free endpoint with the key in the Authorization header only', async () => {
    const fetchMock = stubFetch(respond(200, fixture('company_lookup')))
    const company = await provider().lookupCompany('000000019')

    expect(company?.name).toBe('Sample Trading Pty Ltd')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${BASE}/companies/000000019`)
    expect(String(url)).not.toContain(KEY)
    expect(init?.method).toBe('GET')
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
  })

  it('answers null for a company the register does not have', async () => {
    stubFetch(respond(404, errorBody('company_not_found')))
    expect(await provider().lookupCompany('000000019')).toBeNull()
  })

  it('refuses a 200 that is not a company', async () => {
    stubFetch(respond(200, { object: 'company' }))
    expect(await thrown(provider().lookupCompany('000000019'))).toBeInstanceOf(AsicResponseError)
  })
})

describe('purchaseCurrentExtract', () => {
  it('posts a current extract with the caller’s idempotency key', async () => {
    const fetchMock = stubFetch(respond(201, fixture('extract_two_directors')))
    const purchase = await provider().purchaseCurrentExtract('000000019', {
      idempotencyKey: IDEMPOTENCY_KEY,
      clientReference: 'MCR-CONVERSION',
    })

    expect(purchase.summary.directors).toHaveLength(2)
    expect(purchase.providerExtractId).toBe('ext_TEST0000000001')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${BASE}/companies/000000019/extracts`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ type: 'current' })
    const headers = init?.headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBe(IDEMPOTENCY_KEY)
    expect(headers['X-Client-Reference']).toBe('MCR-CONVERSION')
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers.Authorization).toBe(`Bearer ${KEY}`)
  })

  it('sends the same request for the same key, so a retry is a replay', async () => {
    const fetchMock = stubFetch(respond(201, fixture('extract_two_directors')))
    const options = { idempotencyKey: IDEMPOTENCY_KEY }
    await provider().purchaseCurrentExtract('000000019', options)
    await provider().purchaseCurrentExtract('000000019', options)

    const [first, second] = fetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      body: init?.body,
      key: (init?.headers as Record<string, string>)['Idempotency-Key'],
    }))
    expect(second).toEqual(first)
  })

  it('cuts the client reference to asicapi’s 30 characters and omits a blank one', async () => {
    const fetchMock = stubFetch(respond(201, fixture('extract_two_directors')))
    await provider().purchaseCurrentExtract('000000019', {
      idempotencyKey: IDEMPOTENCY_KEY,
      clientReference: 'X'.repeat(40),
    })
    await provider().purchaseCurrentExtract('000000019', {
      idempotencyKey: IDEMPOTENCY_KEY,
      clientReference: '  ',
    })
    const headers = fetchMock.mock.calls.map(([, init]) => init?.headers as Record<string, string>)
    expect(headers[0]['X-Client-Reference']).toHaveLength(30)
    expect(headers[1]).not.toHaveProperty('X-Client-Reference')
  })

  it('stores a redacted copy, not what came over the wire', async () => {
    stubFetch(respond(201, fixture('extract_two_directors')))
    const { raw } = await provider().purchaseCurrentExtract('000000019', {
      idempotencyKey: IDEMPOTENCY_KEY,
    })
    expect(JSON.stringify(raw)).not.toContain('PRIVATE HOME STREET')
    expect(raw).not.toHaveProperty('members')
  })

  it('treats a 404 as a failed purchase, not as "nothing there"', async () => {
    stubFetch(respond(404, errorBody('company_not_found')))
    const err = await thrown(
      provider().purchaseCurrentExtract('000000019', { idempotencyKey: IDEMPOTENCY_KEY }),
    )
    expect(err).toBeInstanceOf(AsicRejectedError)
    expect((err as AsicRejectedError).code).toBe('company_not_found')
  })

  it('surfaces an idempotency conflict as a rejection with its code', async () => {
    stubFetch(respond(409, errorBody('idempotency_conflict')))
    const err = await thrown(
      provider().purchaseCurrentExtract('000000019', { idempotencyKey: IDEMPOTENCY_KEY }),
    )
    expect(err).toBeInstanceOf(AsicRejectedError)
    expect((err as AsicRejectedError).code).toBe('idempotency_conflict')
    expect((err as AsicRejectedError).status).toBe(409)
  })

  it('classifies a timeout as a timeout', async () => {
    stubFetch(async () => {
      const err = new Error('The operation was aborted due to timeout')
      err.name = 'TimeoutError'
      throw err
    })
    const err = await thrown(
      provider().purchaseCurrentExtract('000000019', { idempotencyKey: IDEMPOTENCY_KEY }),
    )
    expect(err).toBeInstanceOf(AsicTimeoutError)
    expect(err).toBeInstanceOf(AsicUnavailableError)
  })

  it('refuses an extract for a different company than the one bought', async () => {
    stubFetch(respond(201, fixture('extract_two_directors')))
    const err = await thrown(
      provider().purchaseCurrentExtract('000000028', { idempotencyKey: IDEMPOTENCY_KEY }),
    )
    expect(err).toBeInstanceOf(AsicResponseError)
  })

  it('refuses a 2xx that is not JSON', async () => {
    stubFetch(respond(201, '<html>oops</html>'))
    const err = await thrown(
      provider().purchaseCurrentExtract('000000019', { idempotencyKey: IDEMPOTENCY_KEY }),
    )
    expect(err).toBeInstanceOf(AsicResponseError)
  })
})

describe('failures', () => {
  const cases: Array<[string, () => Promise<Response>, new (...args: never[]) => Error]> = [
    ['401', respond(401, errorBody('unauthorized')), AsicAuthError],
    ['403', respond(403, errorBody('forbidden')), AsicAuthError],
    ['422', respond(422, errorBody('acn_invalid')), AsicRejectedError],
    ['429', respond(429, errorBody('rate_limited'), { 'Retry-After': '12' }), AsicRateLimitedError],
    ['500', respond(500, errorBody('api_error')), AsicUnavailableError],
    ['503', respond(503, errorBody('asic_unavailable')), AsicUnavailableError],
    [
      'network',
      async () => {
        throw new TypeError('fetch failed')
      },
      AsicUnavailableError,
    ],
  ]

  it.each(cases)('classifies %s', async (_label, impl, expected) => {
    stubFetch(impl)
    expect(await thrown(provider().lookupCompany('000000019'))).toBeInstanceOf(expected)
  })

  it('passes Retry-After through on a 429', async () => {
    stubFetch(respond(429, errorBody('rate_limited'), { 'Retry-After': '12' }))
    const err = await thrown(provider().lookupCompany('000000019'))
    expect((err as AsicRateLimitedError).retryAfter).toBe(12)
  })

  it.each(cases)('never puts the key in the error message (%s)', async (_label, impl) => {
    // The fake provider echoes the key in its own message; ours must not.
    stubFetch(impl)
    const err = await thrown(provider().lookupCompany('000000019'))
    expect(err.message).not.toContain(KEY)
    expect(err.message).not.toContain('echo of request')
  })
})
