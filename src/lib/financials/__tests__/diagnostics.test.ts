import { describe, it, expect, vi, afterEach } from 'vitest'
import { financialsDiagnosticsEnabled } from '../diagnostics'

afterEach(() => vi.unstubAllEnvs())

describe('financialsDiagnosticsEnabled', () => {
  it('is on only for exactly "true"', () => {
    vi.stubEnv('SHOW_FINANCIALS_DIAGNOSTICS', 'true')
    expect(financialsDiagnosticsEnabled()).toBe(true)
  })

  it('treats unset, empty or anything else as production (off)', () => {
    for (const value of [undefined, '', 'false', '1', 'TRUE', 'yes']) {
      vi.stubEnv('SHOW_FINANCIALS_DIAGNOSTICS', value as string)
      expect(financialsDiagnosticsEnabled()).toBe(false)
    }
  })
})
