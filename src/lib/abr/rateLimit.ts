/**
 * Per-staff-user sliding window on the ABR proxy.
 *
 * Not abuse protection — everyone reaching these routes is signed-in staff.
 * It is there because a debounce is a client-side promise: a stuck key, a hot
 * reload loop or a mistyped call site can put the register under a burst from
 * one browser tab, and the GUID we are protecting is registered to MCR. Better
 * that a person sees "slow down" than that the practice's registration does.
 *
 * Keyed on the Supabase user id rather than the IP, which is the instruction
 * and also the better key: the whole office can share one NAT address.
 *
 * LIMIT: in-memory, per serverless instance, same as src/lib/leads/rateLimit.
 * It blunts a burst from one tab; it is not a distributed limit.
 */

/** Comfortably above real typing — a debounced search is a few per minute —
 *  and well below anything that would look like a script. */
export const ABR_RATE_LIMIT = { max: 40, windowMs: 60_000 }

const MAX_TRACKED_USERS = 1_000

const hits = new Map<string, number[]>()

export interface AbrRateLimitResult {
  allowed: boolean
  /** Seconds until the window frees up, for the Retry-After header. */
  retryAfter: number
}

export function checkAbrRateLimit(
  userId: string,
  now: number = Date.now(),
  limit = ABR_RATE_LIMIT,
): AbrRateLimitResult {
  const cutoff = now - limit.windowMs
  const recent = (hits.get(userId) ?? []).filter((at) => at > cutoff)

  if (recent.length >= limit.max) {
    const oldest = recent[0]
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((oldest + limit.windowMs - now) / 1000)),
    }
  }

  recent.push(now)
  hits.set(userId, recent)

  if (hits.size > MAX_TRACKED_USERS) {
    for (const [key, times] of hits) {
      if (times.every((at) => at <= cutoff)) hits.delete(key)
      if (hits.size <= MAX_TRACKED_USERS) break
    }
  }

  return { allowed: true, retryAfter: 0 }
}

/** Test seam. */
export function resetAbrRateLimit(): void {
  hits.clear()
}
