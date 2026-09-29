import type { AsicMode } from './types'

/**
 * Which ASIC provider this deployment uses, and in which mode. SERVER ONLY.
 *
 *   ASIC_PROVIDER unset      feature hidden — the form works exactly as before
 *   ASIC_PROVIDER=demo       invented data, never charged, no key needed
 *   ASIC_PROVIDER=asicapi    needs ASICAPI_KEY; the key's prefix sets the mode:
 *                              asicapi_test_…  -> 'test'  (sandbox, never charged)
 *                              asicapi_live_…  -> 'live'  (charged)
 *
 * The mode comes from the key rather than a separate flag on purpose: a flag
 * can say "test" while the key is live, and then real extracts are bought and
 * cached as sandbox ones. A key with neither prefix is treated as not
 * configured — guessing a mode is how a sandbox extract gets served as live.
 *
 * Like ABR_GUID, "not configured" is a supported state, not an error: the
 * routes answer 503 and the UI hides the control.
 */

export const DEFAULT_ASICAPI_BASE_URL = 'https://api.asicapi.dev/v1'

/** What the button says when ASIC_EXTRACT_FEE_CENTS is unset: $10.00. */
export const DEFAULT_FEE_CENTS = 1000

export type AsicConfig =
  | { provider: 'demo'; mode: 'demo'; feeCents: number }
  | {
      provider: 'asicapi'
      mode: Extract<AsicMode, 'test' | 'live'>
      key: string
      baseUrl: string
      feeCents: number
    }

function feeCents(env: NodeJS.ProcessEnv): number {
  const raw = env.ASIC_EXTRACT_FEE_CENTS?.trim()
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_FEE_CENTS
  return Number(raw)
}

/** `env` is a test seam; everything else reads process.env. */
export function asicConfig(env: NodeJS.ProcessEnv = process.env): AsicConfig | null {
  const provider = env.ASIC_PROVIDER?.trim().toLowerCase()

  if (provider === 'demo') {
    return { provider: 'demo', mode: 'demo', feeCents: feeCents(env) }
  }

  if (provider === 'asicapi') {
    const key = env.ASICAPI_KEY?.trim()
    if (!key) return null

    let mode: 'test' | 'live'
    if (key.startsWith('asicapi_test_')) mode = 'test'
    else if (key.startsWith('asicapi_live_')) mode = 'live'
    else return null

    const baseUrl = (env.ASICAPI_BASE_URL?.trim() || DEFAULT_ASICAPI_BASE_URL).replace(/\/+$/, '')
    return { provider: 'asicapi', mode, key, baseUrl, feeCents: feeCents(env) }
  }

  return null
}

export function isAsicConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return asicConfig(env) !== null
}

/**
 * What a purchase actually costs in this mode. The button shows the live price
 * everywhere so the flow reads the same in a demo, but only live is charged.
 */
export function chargedCents(config: Pick<AsicConfig, 'mode' | 'feeCents'>): number {
  return config.mode === 'live' ? config.feeCents : 0
}
