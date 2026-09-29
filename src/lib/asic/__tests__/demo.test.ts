import { describe, it, expect, vi } from 'vitest'
import { DEMO_ACNS, createDemoProvider } from '../providers/demo'
import { AsicRejectedError } from '../errors'
import { isValidAbn, isValidAcn } from '../identifiers'

/**
 * The demo provider. Its one hard rule: it never puts invented people on an
 * ACN that is not its own — otherwise a demo after an ABR pick would pair a
 * real company with Jane Sample and John Example.
 */

const OPTIONS = { idempotencyKey: '3f1c2a9e-0000-4000-8000-000000000001' }

describe('demo provider', () => {
  it('shows two directors on its main sample company', async () => {
    const { summary } = await createDemoProvider().purchaseCurrentExtract('000000019', OPTIONS)
    expect(summary.companyName).toBe('Sample Trading Pty Ltd')
    expect(summary.directors).toEqual([
      { name: 'Jane Sample', dateOfBirth: '1970-05-01' },
      { name: 'John Example', dateOfBirth: '1982-11' },
    ])
    expect(summary.registeredOffice).not.toBe(summary.principalPlaceOfBusiness)
  })

  it('has a second sample with a missing date of birth and one address used twice', async () => {
    const { summary } = await createDemoProvider().purchaseCurrentExtract('000000028', OPTIONS)
    expect(summary.directors).toEqual([{ name: 'Alex Placeholder', dateOfBirth: null }])
    expect(summary.registeredOffice).toBe(summary.principalPlaceOfBusiness)
  })

  it('answers the free lookup for its own ACNs', async () => {
    const company = await createDemoProvider().lookupCompany('000000019')
    expect(company).toMatchObject({ acn: '000000019', abn: '89000000019', name: 'Sample Trading Pty Ltd' })
  })

  it('does not know any other company, so it can never attach fake directors to one', async () => {
    const demo = createDemoProvider()
    // 004 085 616 is a valid ACN (asicapi's documented example) that is not a demo one.
    expect(await demo.lookupCompany('004085616')).toBeNull()
    await expect(demo.purchaseCurrentExtract('004085616', OPTIONS)).rejects.toBeInstanceOf(
      AsicRejectedError,
    )
  })

  it('uses ACNs and ABNs that pass their check digits', async () => {
    const demo = createDemoProvider()
    for (const acn of DEMO_ACNS) {
      expect(isValidAcn(acn)).toBe(true)
      const company = await demo.lookupCompany(acn)
      expect(isValidAbn(company!.abn)).toBe(true)
    }
  })

  it('reports itself as demo, stamps the time and references the click', async () => {
    const now = vi.fn(() => new Date('2026-09-29T01:02:03Z'))
    const demo = createDemoProvider(now)
    const purchase = await demo.purchaseCurrentExtract('000000019', OPTIONS)
    expect(demo.mode).toBe('demo')
    expect(purchase.asOf).toBe('2026-09-29T01:02:03.000Z')
    expect(purchase.providerExtractId).toBe('demo_000000019_3f1c2a9e')
  })

  it('stores no place of birth, even for invented people', async () => {
    const { raw } = await createDemoProvider().purchaseCurrentExtract('000000019', OPTIONS)
    expect(JSON.stringify(raw)).not.toContain('SAMPLEVILLE')
  })
})
