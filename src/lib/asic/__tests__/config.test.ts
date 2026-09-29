import { describe, it, expect } from 'vitest'
import { DEFAULT_ASICAPI_BASE_URL, asicConfig, chargedCents, isAsicConfigured } from '../config'
import { getAsicProvider } from '../provider'

/**
 * Which mode a deployment is in. The failure this guards against is a live
 * key running in a mode that is labelled — and cached — as something else.
 * Keys here are obviously fake.
 */

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv

describe('asicConfig', () => {
  it('is off when ASIC_PROVIDER is unset or unknown', () => {
    expect(asicConfig(env({}))).toBeNull()
    expect(asicConfig(env({ ASIC_PROVIDER: 'globalx' }))).toBeNull()
    expect(isAsicConfigured(env({}))).toBe(false)
  })

  it('runs demo with no key at all', () => {
    expect(asicConfig(env({ ASIC_PROVIDER: 'demo' }))).toEqual({
      provider: 'demo',
      mode: 'demo',
      feeCents: 1000,
    })
  })

  it('is off for asicapi without a key', () => {
    expect(asicConfig(env({ ASIC_PROVIDER: 'asicapi' }))).toBeNull()
    expect(asicConfig(env({ ASIC_PROVIDER: 'asicapi', ASICAPI_KEY: '  ' }))).toBeNull()
  })

  it('takes the mode from the key prefix', () => {
    expect(
      asicConfig(env({ ASIC_PROVIDER: 'asicapi', ASICAPI_KEY: 'asicapi_test_fake' }))?.mode,
    ).toBe('test')
    expect(
      asicConfig(env({ ASIC_PROVIDER: 'asicapi', ASICAPI_KEY: 'asicapi_live_fake' }))?.mode,
    ).toBe('live')
  })

  it('refuses a key whose mode it cannot tell, rather than guess', () => {
    expect(asicConfig(env({ ASIC_PROVIDER: 'asicapi', ASICAPI_KEY: 'sk_fake' }))).toBeNull()
  })

  it('defaults the base URL and drops a trailing slash from an override', () => {
    const base = { ASIC_PROVIDER: 'asicapi', ASICAPI_KEY: 'asicapi_test_fake' }
    expect(asicConfig(env(base))).toMatchObject({ baseUrl: DEFAULT_ASICAPI_BASE_URL })
    expect(
      asicConfig(env({ ...base, ASICAPI_BASE_URL: 'https://sandbox.example.test/v1/' })),
    ).toMatchObject({ baseUrl: 'https://sandbox.example.test/v1' })
  })

  it('reads the fee, falling back to $10.00 on anything unusable', () => {
    const fee = (value: string) =>
      asicConfig(env({ ASIC_PROVIDER: 'demo', ASIC_EXTRACT_FEE_CENTS: value }))?.feeCents
    expect(fee('1250')).toBe(1250)
    expect(fee('0')).toBe(0)
    for (const bad of ['', 'ten', '-5', '10.50']) expect(fee(bad)).toBe(1000)
  })

  it('is case- and space-tolerant about the provider name', () => {
    expect(asicConfig(env({ ASIC_PROVIDER: ' Demo ' }))?.provider).toBe('demo')
  })
})

describe('chargedCents', () => {
  it('charges only in live mode', () => {
    expect(chargedCents({ mode: 'live', feeCents: 1000 })).toBe(1000)
    expect(chargedCents({ mode: 'test', feeCents: 1000 })).toBe(0)
    expect(chargedCents({ mode: 'demo', feeCents: 1000 })).toBe(0)
  })
})

describe('getAsicProvider', () => {
  it('picks the implementation the config names', () => {
    expect(getAsicProvider(env({}))).toBeNull()
    expect(getAsicProvider(env({ ASIC_PROVIDER: 'demo' }))).toMatchObject({
      name: 'demo',
      mode: 'demo',
    })
    expect(
      getAsicProvider(env({ ASIC_PROVIDER: 'asicapi', ASICAPI_KEY: 'asicapi_test_fake' })),
    ).toMatchObject({ name: 'asicapi', mode: 'test' })
  })
})
