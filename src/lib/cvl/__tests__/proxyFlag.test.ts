// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy, config } from '@/proxy'

/** The proxy hides CVL while it is switched off. */

afterEach(() => vi.unstubAllEnvs())

describe('proxy and the CVL switch', () => {
  it('answers 404 for CVL pages and the CVL API while CVL is off', async () => {
    vi.stubEnv('NEXT_PUBLIC_CVL_ENABLED', '')
    for (const p of ['/cvl', '/cvl/abc', '/cvl/settings', '/api/admin/cvl/convert']) {
      expect((await proxy(new NextRequest(`http://localhost${p}`))).status, p).toBe(404)
    }
  })

  it('lets the CVL API through to its own auth while CVL is on', async () => {
    vi.stubEnv('NEXT_PUBLIC_CVL_ENABLED', 'true')
    const res = await proxy(new NextRequest('http://localhost/api/admin/cvl/convert'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('runs on the CVL API as well as the pages', () => {
    expect(config.matcher).toContain('/api/admin/cvl/:path*')
  })
})
