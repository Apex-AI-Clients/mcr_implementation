import { describe, it, expect } from 'vitest'
import { tidyAddress } from '../address'

describe('tidyAddress', () => {
  it('title-cases words and keeps state codes upper', () => {
    expect(tidyAddress('UNIT 1, 10 SAMPLE ROAD, NORTH MELBOURNE VIC 3051')).toBe(
      'Unit 1, 10 Sample Road, North Melbourne VIC 3051',
    )
    for (const state of ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']) {
      expect(tidyAddress(`1 EXAMPLE STREET, SAMPLETON ${state} 2000`)).toBe(
        `1 Example Street, Sampleton ${state} 2000`,
      )
    }
  })

  it('writes PO and GPO boxes the way Australia Post does', () => {
    expect(tidyAddress('PO BOX 12, SAMPLETON VIC 3000')).toBe('PO Box 12, Sampleton VIC 3000')
    expect(tidyAddress('GPO BOX 1234, SAMPLETON NSW 2001')).toBe('GPO Box 1234, Sampleton NSW 2001')
  })

  it('handles unit, lot, level and shop prefixes', () => {
    expect(tidyAddress('LEVEL 2, 20 EXAMPLE ST')).toBe('Level 2, 20 Example St')
    expect(tidyAddress('LOT 4 DEMO HWY')).toBe('Lot 4 Demo Hwy')
    expect(tidyAddress('SHOP 3, 7 DEMO PDE')).toBe('Shop 3, 7 Demo Pde')
    expect(tidyAddress('U 5, 1 SAMPLE RD')).toBe('U 5, 1 Sample Rd')
  })

  it('leaves tokens with digits alone', () => {
    expect(tidyAddress('U1/10 SAMPLE RD')).toBe('U1/10 Sample Rd')
    expect(tidyAddress('12A SAMPLE RD')).toBe('12A Sample Rd')
  })

  it("capitalises after hyphens and apostrophes, but not a possessive 's", () => {
    expect(tidyAddress("1 O'CONNOR ST, SAMPLE-ON-SEA SA 5000")).toBe(
      "1 O'Connor St, Sample-On-Sea SA 5000",
    )
    expect(tidyAddress("2 ST JOHN'S RD")).toBe("2 St John's Rd")
  })

  it('does not touch an address that is already mixed case', () => {
    expect(tidyAddress('Unit 1, 10 McSample Road')).toBe('Unit 1, 10 McSample Road')
  })

  it('does not change what tidyRegisterName does for entity names', async () => {
    const { tidyRegisterName } = await import('@/lib/abr/names')
    expect(tidyRegisterName('SAMPLE TRADING PTY LTD')).toBe('Sample Trading Pty Ltd')
  })
})
