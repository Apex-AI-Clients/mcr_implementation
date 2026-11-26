import { describe, expect, it } from 'vitest'
import { LabelMasker, namesUnknownPlaceholder } from '../maskLabels'

// Synthetic names only.
const records = {
  client: ['Example Earthworks Pty Ltd'],
  directors: ['Jane Example', 'Sam Sample'],
  relatedCompanies: ['Sample Holdings Pty Ltd'],
  beneficiaries: ['Alex Placeholder'],
}

describe('LabelMasker', () => {
  it('replaces names by role from our records, the same person always the same placeholder', () => {
    const m = new LabelMasker(records)
    expect(m.mask('Loan - Jane Example')).toBe('Loan - [director 1]')
    expect(m.mask('Jane Example - Drawings')).toBe('[director 1] - Drawings')
    expect(m.mask('Sam Sample - Share of Profit')).toBe('[director 2] - Share of Profit')
    expect(m.mask('Loan to Example Earthworks Pty Ltd')).toBe('Loan to [client]')
    expect(m.mask('Loan - Sample Holdings Pty Ltd')).toBe('Loan - [related company 1]')
    expect(m.mask('Alex Placeholder - Capital Introduced')).toBe('[beneficiary 1] - Capital Introduced')
  })

  it('gives anyone else a [person n], consistently', () => {
    const m = new LabelMasker(records)
    expect(m.mask('Matthew Nobody - Drawings')).toBe('[person 1] - Drawings')
    expect(m.mask('Matthew Nobody - Share of Profit')).toBe('[person 1] - Share of Profit')
    expect(m.mask('Loan - chris unknown')).toBe('Loan - [person 2]')
    expect(m.mask('Loan from Pat Stranger')).toBe('Loan from [person 3]')
    expect(m.mask('Acme Widgets Pty Ltd')).toBe('[person 4]')
    expect(namesUnknownPlaceholder(m.mask('Matthew Nobody - Drawings'))).toBe(true)
    expect(namesUnknownPlaceholder(m.mask('Loan - Jane Example'))).toBe(false)
  })

  it('leaves accounting wording alone', () => {
    const m = new LabelMasker(records)
    for (const label of [
      'Total Current Assets',
      'Net Profit',
      'Provision for Income Tax',
      'Owner A Drawings',
      'Loan - Hino Truck',
      'Director Loan Account',
      'Chattel Mortgage - Current',
      'Accumulated Depreciation - Motor Vehicles',
      'Beneficiary Accounts',
    ]) {
      expect(m.mask(label)).toBe(label)
    }
  })

  it('masks long digit strings and street addresses', () => {
    const m = new LabelMasker(records)
    expect(m.mask('Westpac Account 032-123 456789')).toBe('Westpac Account [number]')
    expect(m.mask('ABN 12 345 678 901')).toBe('ABN [number]')
    expect(m.mask('Property - 12 Example Street')).toBe('Property - [address]')
    expect(m.mask('Div 7A Loan 2019')).toBe('Div 7A Loan 2019')
  })

  it('restores the names on our side only', () => {
    const m = new LabelMasker(records)
    m.mask('Loan - Jane Example')
    m.mask('Matthew Nobody - Drawings')
    expect(m.restore('[director 1]\'s loan account, and [person 1]\'s drawings.')).toBe("Jane Example's loan account, and Matthew Nobody's drawings.")
  })
})
