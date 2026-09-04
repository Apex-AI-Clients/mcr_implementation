import { RATE_LIMIT } from './ingestConfig'

/**
 * Per-IP sliding window for the public ingestion endpoint.
 *
 * The upstream form has no captcha and no honeypot of its own, so whatever junk
 * currently arrives by email will start arriving here the moment the handler is
 * wired up.
 *
 * LIMIT: this is per serverless instance, held in memory. It blunts a burst
 * from one source but is not a real distributed limit — a spread-out flood
 * across warm instances will get through, and the counters reset on deploy.
 * Upgrade to Redis or Supabase-backed counting if the volume justifies it.
 */

const hits = new Map<string, number[]>()

/** Guards against the map growing without bound on a long-lived instance. */
const MAX_TRACKED_IPS = 5_000

export interface RateLimitResult {
  allowed: boolean
  /** Seconds until the window frees up, for the Retry-After header. */
  retryAfter: number
}

export function checkRateLimit(
  ip: string,
  now: number = Date.now(),
  limit = RATE_LIMIT,
): RateLimitResult {
  const cutoff = now - limit.windowMs
  const recent = (hits.get(ip) ?? []).filter((at) => at > cutoff)

  if (recent.length >= limit.max) {
    const oldest = recent[0]
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((oldest + limit.windowMs - now) / 1000)),
    }
  }

  recent.push(now)
  hits.set(ip, recent)

  if (hits.size > MAX_TRACKED_IPS) {
    for (const [key, times] of hits) {
      if (times.every((at) => at <= cutoff)) hits.delete(key)
      if (hits.size <= MAX_TRACKED_IPS) break
    }
  }

  return { allowed: true, retryAfter: 0 }
}

/** Test seam. */
export function resetRateLimit(): void {
  hits.clear()
}

/**
 * Best-effort client IP. Vercel sets x-forwarded-for; the leftmost entry is the
 * original client. Falls back to a constant, which means an unknown-IP flood
 * shares one bucket rather than bypassing the limit entirely.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip')?.trim() || 'unknown'
}
