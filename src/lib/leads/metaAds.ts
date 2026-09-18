/**
 * Resolving a Facebook ad to its campaign, at the moment a lead arrives.
 *
 * The webhook gives us an ad id and nothing readable: no campaign, no ad name.
 * Those are resolved here and stored denormalised on the lead, so the dashboard
 * renders from our own table and never calls Meta.
 *
 * Nothing in this module throws, and nothing in it can reject a lead. Every
 * failure path returns nulls and logs — a lead with raw ids and no campaign
 * name is worth far more than no lead, and the raw ids keep a later backfill
 * possible. That asymmetry is the whole design.
 */

const GRAPH_VERSION = 'v21.0'

/**
 * Deliberately short. The webhook already spends ~2.5s across four external
 * calls before this one, and Meta retries the delivery if we take too long —
 * losing the lead to a timeout while looking up a campaign name would be an
 * absurd trade.
 */
export const AD_RESOLVE_TIMEOUT_MS = 1_500

export interface AdAttribution {
  campaignId: string | null
  campaignName: string | null
  adName: string | null
  accountId: string | null
}

/** No ad to resolve, or the resolve failed. The four are always null together. */
export const NO_AD_ATTRIBUTION: AdAttribution = Object.freeze({
  campaignId: null,
  campaignName: null,
  adName: null,
  accountId: null,
})

/** A Graph value we are willing to treat as an id or a name. */
function str(value: unknown): string | null {
  if (typeof value === 'string' && value) return value
  if (typeof value === 'number') return String(value)
  return null
}

interface GraphError {
  message?: unknown
  type?: unknown
  code?: unknown
  error_subcode?: unknown
}

/**
 * Meta's permission refusals. 10 and 200 are both "you do not hold the
 * permission for this edge"; 3 is "unknown method", which is what an
 * unapproved app can get instead. 190 is a dead token, which is a different
 * problem with a different fix, so it is not folded in here.
 */
const PERMISSION_CODES = new Set([3, 10, 200])

/**
 * `ads_read` is Ready for testing on the app, which means it works for users
 * with a role on it and fails for everyone else. In production that failure is
 * the signal that App Review is needed — so it is logged as its own thing and
 * not as a generic Graph error, because the two lead to completely different
 * actions.
 */
function logFailure(adId: string, status: number, body: unknown): void {
  const error = ((body as { error?: unknown } | null)?.error ?? {}) as GraphError
  const code = typeof error.code === 'number' ? error.code : null
  const message = typeof error.message === 'string' ? error.message : 'no message'

  if (status === 403 || (code !== null && PERMISSION_CODES.has(code))) {
    console.error(
      `[metaAds] ads_read refused for ad_id=${adId} (http=${status} code=${code}): ${message} — ` +
        'the permission is Ready for testing only, so this needs App Review before ' +
        'production leads carry campaign detail. Lead stored with raw ids.',
    )
    return
  }

  if (code === 190) {
    console.error(
      `[metaAds] META_ADS_ACCESS_TOKEN is invalid or expired (ad_id=${adId}): ${message}. ` +
        'Lead stored with raw ids.',
    )
    return
  }

  console.error(
    `[metaAds] could not resolve ad_id=${adId} (http=${status} code=${code}): ${message}. ` +
      'Lead stored with raw ids.',
  )
}

/**
 * GET /{ad_id}?fields=account_id,name,campaign{id,name}
 *
 * Callers pass a null adId for test leads and organic submissions — there is no
 * ad behind either, so there is nothing to look up and nothing has gone wrong.
 */
export async function resolveAdAttribution(
  adId: string | null,
  token: string | null = process.env.META_ADS_ACCESS_TOKEN ?? null,
): Promise<AdAttribution> {
  if (!adId) return NO_AD_ATTRIBUTION

  if (!token) {
    // Not an error in the Graph sense, but it is a silent gap if unlogged: every
    // lead would store raw ids forever and nobody would know why the campaign
    // columns are empty.
    console.error(
      `[metaAds] META_ADS_ACCESS_TOKEN is not configured — ad_id=${adId} stored without ` +
        'campaign detail. A Page token cannot read an ad; this needs a user or system-user ' +
        'token holding ads_read on the ad account.',
    )
    return NO_AD_ATTRIBUTION
  }

  const fields = encodeURIComponent('account_id,name,campaign{id,name}')
  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(adId)}` +
    `?fields=${fields}&access_token=${encodeURIComponent(token)}`

  let response: Response
  try {
    response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(AD_RESOLVE_TIMEOUT_MS),
    })
  } catch (err) {
    // AbortSignal.timeout raises TimeoutError; an outright network failure
    // raises something else. Both mean the same thing here.
    const name = err instanceof Error ? err.name : ''
    const detail = err instanceof Error ? err.message : String(err)
    console.error(
      name === 'TimeoutError'
        ? `[metaAds] ad lookup exceeded ${AD_RESOLVE_TIMEOUT_MS}ms for ad_id=${adId}. Lead stored with raw ids.`
        : `[metaAds] ad lookup failed for ad_id=${adId}: ${detail}. Lead stored with raw ids.`,
    )
    return NO_AD_ATTRIBUTION
  }

  // Meta sends a JSON body on failures too, and it is the only place the
  // permission code appears, so it is read before the status is judged.
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    logFailure(adId, response.status, payload)
    return NO_AD_ATTRIBUTION
  }

  const ad = (payload ?? {}) as { name?: unknown; account_id?: unknown; campaign?: unknown }
  const campaign = (ad.campaign ?? {}) as { id?: unknown; name?: unknown }

  return {
    campaignId: str(campaign.id),
    campaignName: str(campaign.name),
    adName: str(ad.name),
    // Returned as bare digits, without the `act_` prefix that names the
    // AdAccount node. Stored exactly as returned rather than reformatted.
    accountId: str(ad.account_id),
  }
}
