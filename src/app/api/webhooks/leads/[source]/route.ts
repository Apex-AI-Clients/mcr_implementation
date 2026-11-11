import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import {
  mapLead,
  facebookFieldKeys,
  flattenFacebookFields,
  isHoneypotTripped,
} from '@/lib/leads/ingest'
import { storeIngestedLead, logIntake } from '@/lib/leads/ingestStore'
import { resolveAdAttribution } from '@/lib/leads/metaAds'
import { fetchLead } from '@/lib/leads/metaGraph'
import { checkRateLimit, clientIp } from '@/lib/leads/rateLimit'
import type { LeadSource } from '@/types/leads'

/**
 * Inbound leads.
 *
 * `source` comes from the route param and is validated against LeadSource. It
 * is never read from the body — otherwise anyone who finds the URL can post
 * leads claiming to be Facebook ads.
 *
 * Almost every failure answers 200 with the payload recorded in
 * lead_intake_log. Meta retries on any non-200, and a retry loop on a payload
 * that will never parse buys nothing. Rejected authentication is the exception:
 * that gets a 401 and writes nothing.
 */

export const dynamic = 'force-dynamic'

/** Sources that may be posted to. `manual` is the CRM's own add form. */
const INBOUND_SOURCES = new Set<LeadSource>(['facebook', 'website', 'google_form'])

interface Props {
  params: Promise<{ source: string }>
}

function parseSource(raw: string): LeadSource | null {
  return INBOUND_SOURCES.has(raw as LeadSource) ? (raw as LeadSource) : null
}

/** A string field from an untrusted payload, or null. */
function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/** Constant-time compare that tolerates length differences. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

// ============================================================
// GET — Meta's verification handshake
// ============================================================

/**
 * Meta calls this once when the subscription is created and expects the
 * challenge echoed back as PLAIN TEXT. If it fails the subscription never
 * activates, and Meta's error message will not tell you why.
 */
export async function GET(req: NextRequest, { params }: Props) {
  const { source } = await params
  if (!parseSource(source)) {
    return NextResponse.json({ error: 'Unknown source' }, { status: 404 })
  }

  const url = req.nextUrl.searchParams
  const mode = url.get('hub.mode')
  const token = url.get('hub.verify_token')
  const challenge = url.get('hub.challenge')

  const expected = process.env.META_VERIFY_TOKEN
  if (!expected) {
    console.error('[webhooks/leads] META_VERIFY_TOKEN is not configured')
    return new NextResponse('Forbidden', { status: 403 })
  }

  if (mode !== 'subscribe' || !token || !safeEqual(token, expected)) {
    console.warn(`[webhooks/leads] handshake rejected for source=${source}`)
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Plain text, not JSON — Meta compares the body byte for byte.
  return new NextResponse(challenge ?? '', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

// ============================================================
// POST — inbound leads
// ============================================================

export async function POST(req: NextRequest, { params }: Props) {
  const { source: rawSource } = await params
  const source = parseSource(rawSource)
  if (!source) {
    return NextResponse.json({ error: 'Unknown source' }, { status: 404 })
  }

  const ip = clientIp(req.headers)
  const limit = checkRateLimit(ip)
  if (!limit.allowed) {
    console.warn(`[webhooks/leads] rate limited source=${source}`)
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    )
  }

  // Read once as text: the Facebook signature is over the raw bytes.
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return NextResponse.json({ error: 'Unreadable body' }, { status: 400 })
  }

  if (!(await authenticate(req, source, raw))) {
    console.warn(`[webhooks/leads] auth failed source=${source}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    await logIntake({
      source,
      externalId: null,
      outcome: 'rejected',
      error: 'Body was not valid JSON',
      rawBody: { raw: raw.slice(0, 4000) },
    })
    return NextResponse.json({ ok: true, outcome: 'rejected' })
  }

  // Bots fill every input. The upstream form has no captcha, so this is the
  // only spam signal available here.
  if (isHoneypotTripped(body)) {
    console.warn(`[webhooks/leads] honeypot tripped source=${source}`)
    return NextResponse.json({ ok: true, outcome: 'rejected' })
  }

  try {
    return source === 'facebook'
      ? await handleFacebook(body)
      : await handleDirect(body, source)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[webhooks/leads] source=${source} threw:`, message)
    await logIntake({
      source,
      externalId: null,
      outcome: 'error',
      error: message,
      rawBody: body,
    })
    return NextResponse.json({ ok: true, outcome: 'error' })
  }
}

// ============================================================
// Authentication
// ============================================================

async function authenticate(
  req: NextRequest,
  source: LeadSource,
  raw: string,
): Promise<boolean> {
  if (source === 'facebook') {
    const appSecret = process.env.META_APP_SECRET
    const signature = req.headers.get('x-hub-signature-256')
    if (!appSecret || !signature) return false

    const digest = 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex')
    return safeEqual(signature, digest)
  }

  const secret = process.env.MCR_LEAD_SECRET
  if (!secret) {
    console.error('[webhooks/leads] MCR_LEAD_SECRET is not configured')
    return false
  }
  const provided = req.headers.get('x-mcr-secret')
  return !!provided && safeEqual(provided, secret)
}

// ============================================================
// Website and Google Form — the lead is in the body
// ============================================================

async function handleDirect(
  body: Record<string, unknown>,
  source: LeadSource,
): Promise<NextResponse> {
  const externalId = typeof body.external_id === 'string' ? body.external_id : null
  const mapped = mapLead(body, source, externalId)

  if (!mapped.ok) {
    await logIntake({ source, externalId, outcome: 'rejected', error: mapped.error, rawBody: body })
    console.warn(`[webhooks/leads] source=${source} external_id=${externalId} rejected`)
    return NextResponse.json({ ok: true, outcome: 'rejected' })
  }

  const result = await storeIngestedLead(mapped.lead)
  if (result.outcome === 'error') {
    await logIntake({ source, externalId, outcome: 'error', error: 'Store failed', rawBody: body })
  }
  console.info(
    `[webhooks/leads] source=${source} external_id=${externalId} outcome=${result.outcome}`,
  )
  return NextResponse.json({ ok: true, outcome: result.outcome })
}

// ============================================================
// Facebook — the payload carries an id, not the lead
// ============================================================

/**
 * The webhook body contains `leadgen_id` and `page_id`; the answers have to be
 * fetched separately. The leadgen id doubles as the idempotency key.
 */
async function handleFacebook(body: Record<string, unknown>): Promise<NextResponse> {
  const source: LeadSource = 'facebook'
  const entries = Array.isArray(body.entry) ? body.entry : []
  const outcomes: string[] = []

  for (const entry of entries) {
    const changes = Array.isArray((entry as { changes?: unknown }).changes)
      ? ((entry as { changes: unknown[] }).changes as Record<string, unknown>[])
      : []

    for (const change of changes) {
      if (change.field !== 'leadgen') continue
      const value = (change.value ?? {}) as Record<string, unknown>
      const leadgenId = typeof value.leadgen_id === 'string' ? value.leadgen_id : null
      const pageId = str(value.page_id)
      // Which ad and ad set delivered the lead. Present on a real lead, absent
      // on a test one — nothing generated by Meta's test tool came from an ad.
      // Neither can be recovered later, so they are read here and stored even
      // though nothing reads them back yet.
      const adId = str(value.ad_id)
      const adgroupId = str(value.adgroup_id)
      // The webhook names the form too. The Graph response is preferred, but
      // this covers a response that comes back without it.
      const webhookFormId = str(value.form_id)

      if (!leadgenId) {
        await logIntake({
          source,
          externalId: null,
          outcome: 'rejected',
          error: 'Change carried no leadgen_id',
          rawBody: change,
        })
        outcomes.push('rejected')
        continue
      }

      const lead = await fetchLead(leadgenId, pageId)
      if (!lead) {
        await logIntake({
          source,
          externalId: leadgenId,
          outcome: 'error',
          error: 'Could not retrieve lead fields from the Graph API',
          rawBody: change,
        })
        outcomes.push('error')
        continue
      }

      // The ad is resolved to its campaign here, in the same request, because
      // this is the last moment ad_id is guaranteed to mean anything to us.
      // A null adId short-circuits it, and every failure inside it returns
      // nulls rather than throwing — see the module. The lead lands either way.
      const ad = await resolveAdAttribution(adId)

      // formId also names the form in an unmapped-question-key warning — there
      // are 19 of them on the Page.
      const formId = lead.formId ?? webhookFormId
      const mapped = mapLead(flattenFacebookFields(lead.fieldData, formId), source, leadgenId, {
        formId,
        adId,
        adgroupId,
        pageId,
        ad,
        // Names only — what lets the next reworded question be found from the
        // database (migration 0051) instead of from logs.
        fieldKeys: facebookFieldKeys(lead.fieldData),
      })
      if (!mapped.ok) {
        await logIntake({
          source,
          externalId: leadgenId,
          outcome: 'rejected',
          error: mapped.error,
          rawBody: { form_id: formId, field_data: lead.fieldData },
        })
        outcomes.push('rejected')
        continue
      }

      const result = await storeIngestedLead(mapped.lead)
      console.info(
        `[webhooks/leads] source=facebook external_id=${leadgenId} outcome=${result.outcome}`,
      )
      outcomes.push(result.outcome)
    }
  }

  return NextResponse.json({ ok: true, outcomes })
}
