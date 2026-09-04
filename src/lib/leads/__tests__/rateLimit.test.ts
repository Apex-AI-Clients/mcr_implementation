import { describe, it, expect, beforeEach } from 'vitest'
import { checkRateLimit, resetRateLimit, clientIp } from '../rateLimit'

const LIMIT = { max: 3, windowMs: 60_000 }
const T0 = 1_800_000_000_000

beforeEach(() => resetRateLimit())

describe('checkRateLimit', () => {
  it('allows up to the limit within the window', () => {
    for (let i = 0; i < LIMIT.max; i++) {
      expect(checkRateLimit('1.2.3.4', T0 + i, LIMIT).allowed).toBe(true)
    }
  })

  it('blocks the request past the limit', () => {
    for (let i = 0; i < LIMIT.max; i++) checkRateLimit('1.2.3.4', T0 + i, LIMIT)
    const result = checkRateLimit('1.2.3.4', T0 + 10, LIMIT)
    expect(result.allowed).toBe(false)
    expect(result.retryAfter).toBeGreaterThan(0)
  })

  it('keeps buckets per IP', () => {
    for (let i = 0; i < LIMIT.max; i++) checkRateLimit('1.2.3.4', T0 + i, LIMIT)
    expect(checkRateLimit('1.2.3.4', T0 + 10, LIMIT).allowed).toBe(false)
    // A different submitter is unaffected by someone else's burst.
    expect(checkRateLimit('5.6.7.8', T0 + 10, LIMIT).allowed).toBe(true)
  })

  it('lets the window slide', () => {
    for (let i = 0; i < LIMIT.max; i++) checkRateLimit('1.2.3.4', T0 + i, LIMIT)
    expect(checkRateLimit('1.2.3.4', T0 + 100, LIMIT).allowed).toBe(false)
    // Once the earlier hits fall outside the window, the bucket frees up.
    expect(checkRateLimit('1.2.3.4', T0 + LIMIT.windowMs + 1, LIMIT).allowed).toBe(true)
  })

  it('reports a retry-after inside the window length', () => {
    for (let i = 0; i < LIMIT.max; i++) checkRateLimit('1.2.3.4', T0, LIMIT)
    const { retryAfter } = checkRateLimit('1.2.3.4', T0, LIMIT)
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(LIMIT.windowMs / 1000)
  })
})

describe('clientIp', () => {
  it('takes the leftmost x-forwarded-for entry', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' })
    expect(clientIp(headers)).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
  })

  it('shares one bucket when the IP is unknown, rather than bypassing the limit', () => {
    expect(clientIp(new Headers())).toBe('unknown')
  })
})
