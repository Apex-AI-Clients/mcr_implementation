import { asicConfig, type AsicConfig } from './config'
import { createAsicapiProvider } from './providers/asicapi'
import { createDemoProvider } from './providers/demo'
import type { AsicProvider } from './types'

/**
 * The provider this deployment is configured for, or null when the feature is
 * off. SERVER ONLY — the asicapi provider holds the key.
 *
 * The one place that picks an implementation. Swapping to GlobalX, or to
 * ASIC's own API when it reopens, is a new file under ./providers and a new
 * branch here; nothing that calls getAsicProvider() changes.
 *
 * Nothing in src/components may import this module.
 */
export function providerFor(config: AsicConfig): AsicProvider {
  switch (config.provider) {
    case 'demo':
      return createDemoProvider()
    case 'asicapi':
      return createAsicapiProvider({ key: config.key, baseUrl: config.baseUrl, mode: config.mode })
  }
}

export function getAsicProvider(env: NodeJS.ProcessEnv = process.env): AsicProvider | null {
  const config = asicConfig(env)
  return config ? providerFor(config) : null
}
