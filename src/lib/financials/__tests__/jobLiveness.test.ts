import { describe, it, expect } from 'vitest'
import { isJobDead, JOB_MAX_AGE_MS } from '../jobLiveness'

describe('isJobDead', () => {
  const now = Date.parse('2026-10-06T10:00:00Z')
  const at = (msAgo: number) => new Date(now - msAgo).toISOString()

  it('keeps a running job alive within the function lifetime', () => {
    expect(isJobDead({ status: 'processing', created_at: at(10 * 60_000) }, now)).toBe(false)
    expect(isJobDead({ status: 'pending', created_at: at(JOB_MAX_AGE_MS - 1_000) }, now)).toBe(false)
  })

  it('treats an active job older than the function can live as dead', () => {
    expect(isJobDead({ status: 'processing', created_at: at(JOB_MAX_AGE_MS + 1_000) }, now)).toBe(true)
    expect(isJobDead({ status: 'pending', created_at: at(60 * 60_000) }, now)).toBe(true)
  })

  it('never calls a finished job dead', () => {
    expect(isJobDead({ status: 'done', created_at: at(60 * 60_000) }, now)).toBe(false)
    expect(isJobDead({ status: 'failed', created_at: at(60 * 60_000) }, now)).toBe(false)
  })

  it('outlasts the 800s function limit', () => {
    expect(JOB_MAX_AGE_MS).toBeGreaterThan(800_000)
  })
})
