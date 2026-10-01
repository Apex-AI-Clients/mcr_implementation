import { describe, it, expect } from 'vitest'
import { identityDisplay, NO_OWN_ABN } from '../identityDisplay'

// Synthetic numbers: ACN 123 456 780, its company ABN 11 123 456 780, and the
// ATO's published example ABN standing in for a trust's.

const valueOf = (rows: { label: string; value: string | null }[], label: string) =>
  rows.find((row) => row.label === label)?.value

describe('identityDisplay', () => {
  it('a Company with its own ABN: company rows, no trust', () => {
    const shown = identityDisplay({
      entityType: 'company',
      companyName: 'Sample Trading Pty Ltd',
      acnNumber: '123456780',
      abnNumber: '11123456780',
    })
    expect(shown.company).toEqual([
      { label: 'Company name', value: 'Sample Trading Pty Ltd', numeric: false },
      { label: 'ACN', value: '123456780', numeric: true },
      { label: 'Company ABN', value: '11123456780', numeric: true },
    ])
    expect(shown.trust).toBeNull()
  })

  it('a trustee with no ABN of its own says so, and shows the trust', () => {
    const shown = identityDisplay({
      entityType: 'trust',
      companyName: 'Sample Holdings Pty Ltd',
      acnNumber: '123456780',
      abnNumber: '',
      trustName: 'Sample Family Trust',
      trustAbnNumber: '51824753556',
    })
    expect(valueOf(shown.company, 'Company ABN')).toBe(NO_OWN_ABN)
    expect(shown.trust).toEqual([
      { label: 'Trust name', value: 'Sample Family Trust', numeric: false },
      { label: 'Trust ABN', value: '51824753556', numeric: true },
    ])
  })

  it('a trustee with its own ABN shows both, apart', () => {
    const shown = identityDisplay({
      entityType: 'trust',
      abnNumber: '11123456780',
      trustAbnNumber: '51824753556',
    })
    expect(valueOf(shown.company, 'Company ABN')).toBe('11123456780')
    expect(valueOf(shown.trust!, 'Trust ABN')).toBe('51824753556')
  })

  it('a Company with no ABN yet is simply not recorded — not "no ABN of its own"', () => {
    expect(valueOf(identityDisplay({ entityType: 'company' }).company, 'Company ABN')).toBeNull()
  })

  it('a trustee with no trust details yet still has a Trust section, empty', () => {
    expect(identityDisplay({ entityType: 'trust' }).trust).toEqual([
      { label: 'Trust name', value: null, numeric: false },
      { label: 'Trust ABN', value: null, numeric: true },
    ])
  })

  it('still shows a trust name recorded against a Company', () => {
    const shown = identityDisplay({ entityType: 'company', trustName: 'Old Trust' })
    expect(valueOf(shown.trust!, 'Trust name')).toBe('Old Trust')
  })

  it('treats a record from before entity types as a Company', () => {
    expect(valueOf(identityDisplay({ abnNumber: null }).company, 'Company ABN')).toBeNull()
  })

  it('reads blank and whitespace as nothing recorded', () => {
    const shown = identityDisplay({ companyName: '  ', trustName: ' ', trustAbnNumber: '' })
    expect(valueOf(shown.company, 'Company name')).toBeNull()
    expect(shown.trust).toBeNull()
  })
})
