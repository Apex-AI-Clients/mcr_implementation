/**
 * Reading a lead's answers back from Meta's Graph API.
 *
 * Shared by the webhook (which only receives a leadgen id) and the one-off
 * state backfill (which re-reads leads already stored). Server only: it reads
 * the page access tokens.
 */

/**
 * GET /{leadgen_id}?access_token={page_token}
 *
 * The page token is looked up by page id so switching from the test Page to
 * Gabby's real one is a config change, not a code change.
 *
 * `form_id` comes back alongside the answers and is kept: it is the only thing
 * in the response that says which of the Page's 19 forms a lead came from, an
 * unmapped question key is not actionable without it, and it is stored on the
 * lead because a second fetch cannot recover it later.
 *
 * `fields` has to be named explicitly: without it the Lead node returns only
 * its defaults (id, created_time, field_data), form_id is silently absent, and
 * every warning read form_id=unknown.
 *
 * Meta keeps a lead for 90 days; after that this returns null.
 */
export async function fetchLead(
  leadgenId: string,
  pageId: string | null,
): Promise<{ fieldData: unknown; formId: string | null } | null> {
  const token = pageAccessToken(pageId)
  if (!token) {
    console.error(`[webhooks/leads] no page access token configured for page_id=${pageId}`)
    return null
  }

  try {
    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(leadgenId)}?fields=id,created_time,form_id,field_data&access_token=${encodeURIComponent(token)}`
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) {
      console.error(`[webhooks/leads] Graph API returned ${response.status} for ${leadgenId}`)
      return null
    }
    const payload = (await response.json()) as { field_data?: unknown; form_id?: unknown }
    if (payload.field_data === undefined || payload.field_data === null) return null
    return {
      fieldData: payload.field_data,
      formId: typeof payload.form_id === 'string' ? payload.form_id : null,
    }
  } catch (err) {
    console.error('[webhooks/leads] Graph API fetch threw:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * META_PAGE_TOKENS is a JSON object of pageId -> token, so more than one Page
 * can be live at once (the test Page and the real one during changeover).
 * META_PAGE_ACCESS_TOKEN is the single-Page fallback.
 *
 * A parse failure is logged without the value: the value is a token.
 */
export function pageAccessToken(pageId: string | null): string | null {
  const map = process.env.META_PAGE_TOKENS
  if (map && pageId) {
    try {
      const parsed = JSON.parse(map) as Record<string, string>
      if (typeof parsed[pageId] === 'string') return parsed[pageId]
    } catch {
      console.error('[webhooks/leads] META_PAGE_TOKENS is not valid JSON')
    }
  }
  return process.env.META_PAGE_ACCESS_TOKEN ?? null
}
