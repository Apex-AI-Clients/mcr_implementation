import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveAdAttribution, AD_RESOLVE_TIMEOUT_MS } from '../metaAds'

/**
 * The resolver's contract is almost entirely about what it does when things go
 * wrong: it must never throw and never return a partial lead-blocking failure,
 * because the caller stores the lead either way.
 */

const AD_ID = '23859402118830412'
const TOKEN = 'test-ads-token'

const AD_RESPONSE = {
  id: AD_ID,
  name: 'SBR_Verified_Static_A',
  account_id: '1029384756',
  campaign: { id: '23859402118800412', name: 'MCR26 | SBR | Prospecting' },
}

function mockFetch(impl: (url: string, init?: RequestInit) => unknown) {
  const fn = vi.fn(async (url: unknown, init?: unknown) => impl(String(url), init as RequestInit))
  vi.stubGlobal('fetch', fn)
  return fn
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('resolveAdAttribution', () => {
  it('maps the campaign, ad name and account off a successful response', async () => {
    mockFetch(() => jsonResponse(AD_RESPONSE))

    expect(await resolveAdAttribution(AD_ID, TOKEN)).toEqual({
      campaignId: '23859402118800412',
      campaignName: 'MCR26 | SBR | Prospecting',
      adName: 'SBR_Verified_Static_A',
      accountId: '1029384756',
    })
  })

  it('asks for exactly the four fields, on the ad node', async () => {
    const fetchMock = mockFetch(() => jsonResponse(AD_RESPONSE))
    await resolveAdAttribution(AD_ID, TOKEN)

    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]))
    expect(url).toContain(`/${AD_ID}?`)
    expect(url).toContain('fields=account_id,name,campaign{id,name}')
  })

  it('does not call Meta at all when there is no ad', async () => {
    // A test lead and an organic Page submission both arrive without an ad_id.
    // Neither is a failure, so neither should spend a request or log an error.
    const fetchMock = mockFetch(() => jsonResponse(AD_RESPONSE))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await resolveAdAttribution(null, TOKEN)).toEqual({
      campaignId: null,
      campaignName: null,
      adName: null,
      accountId: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('gives up with nulls, loudly, when no ads token is configured', async () => {
    const fetchMock = mockFetch(() => jsonResponse(AD_RESPONSE))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await resolveAdAttribution(AD_ID, null)

    expect(result.campaignId).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    // The gap has to be visible — silently empty campaign columns are the
    // failure mode this log exists to prevent.
    expect(error.mock.calls[0][0]).toContain('META_ADS_ACCESS_TOKEN is not configured')
  })

  it('names App Review when ads_read is refused', async () => {
    // ads_read is Ready for testing, so in production this is the expected
    // failure, and the log has to say what the fix is.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch(() =>
      jsonResponse(
        { error: { message: '(#200) Requires ads_read permission', type: 'OAuthException', code: 200 } },
        403,
      ),
    )

    expect((await resolveAdAttribution(AD_ID, TOKEN)).campaignId).toBeNull()
    expect(error.mock.calls[0][0]).toContain('App Review')
  })

  it('calls a dead token a token problem, not an App Review problem', async () => {
    // Different cause, different fix — folding 190 in with the permission codes
    // would send somebody to App Review over an expired token.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch(() =>
      jsonResponse(
        { error: { message: 'Session has expired', type: 'OAuthException', code: 190 } },
        401,
      ),
    )

    await resolveAdAttribution(AD_ID, TOKEN)
    expect(error.mock.calls[0][0]).toContain('invalid or expired')
    expect(error.mock.calls[0][0]).not.toContain('App Review')
  })

  it('survives a timeout rather than taking the lead down with it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch(() => {
      const err = new Error('The operation was aborted due to timeout')
      err.name = 'TimeoutError'
      throw err
    })

    expect((await resolveAdAttribution(AD_ID, TOKEN)).campaignId).toBeNull()
    expect(error.mock.calls[0][0]).toContain(`${AD_RESOLVE_TIMEOUT_MS}ms`)
  })

  it('passes an abort signal, so a slow Meta cannot stall the webhook', async () => {
    const fetchMock = mockFetch(() => jsonResponse(AD_RESPONSE))
    await resolveAdAttribution(AD_ID, TOKEN)

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('survives a network failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch(() => {
      throw new TypeError('fetch failed')
    })

    expect((await resolveAdAttribution(AD_ID, TOKEN)).adName).toBeNull()
  })

  it('survives a body that is not JSON', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch(() => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      },
    }))

    expect((await resolveAdAttribution(AD_ID, TOKEN)).campaignId).toBeNull()
  })

  it('takes what it can when the campaign edge is missing', async () => {
    // A deleted campaign, or a token that can read the ad but not its campaign.
    // Half an attribution beats none, and beats throwing.
    mockFetch(() => jsonResponse({ id: AD_ID, name: 'Orphaned_Ad', account_id: '1029384756' }))

    expect(await resolveAdAttribution(AD_ID, TOKEN)).toEqual({
      campaignId: null,
      campaignName: null,
      adName: 'Orphaned_Ad',
      accountId: '1029384756',
    })
  })

  it('keeps the account id exactly as Meta sends it', async () => {
    // Numeric in the response, string in the column — and never reformatted
    // into the act_ prefix, which names a different node.
    mockFetch(() => jsonResponse({ ...AD_RESPONSE, account_id: 1029384756 }))

    const result = await resolveAdAttribution(AD_ID, TOKEN)
    expect(result.accountId).toBe('1029384756')
  })

  it('never lets the token reach a log line', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch(() => jsonResponse({ error: { message: 'nope', code: 200 } }, 403))

    await resolveAdAttribution(AD_ID, TOKEN)
    for (const call of error.mock.calls) {
      expect(String(call[0])).not.toContain(TOKEN)
    }
  })
})
