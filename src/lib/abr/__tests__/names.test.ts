import { describe, it, expect } from 'vitest'
import {
  hasTrusteePrefix,
  stripTrusteePrefix,
  tidyRegisterName,
  tidyTrustName,
} from '../names'

/**
 * Turning register text into something a person would have typed.
 *
 * Only the value that gets filled in is tidied — the result row keeps showing
 * the raw EntityName — so the one rule that matters here is that tidying never
 * loses information, only casing and a trustee prefix.
 */

describe('tidyTrustName', () => {
  it('strips the trustee prefix and title-cases what is left', () => {
    expect(tidyTrustName('THE TRUSTEE FOR SMITH FAMILY TRUST')).toBe('Smith Family Trust')
  })

  it('handles the prefix without the leading "THE"', () => {
    expect(tidyTrustName('TRUSTEE FOR SMITH FAMILY TRUST')).toBe('Smith Family Trust')
  })

  it('leaves a second "THE" alone — it belongs to the trust name', () => {
    expect(tidyTrustName('THE TRUSTEE FOR THE SMITH FAMILY TRUST')).toBe('The Smith Family Trust')
  })

  it('is unbothered by a name with no prefix at all', () => {
    expect(tidyTrustName('SMITH FAMILY TRUST')).toBe('Smith Family Trust')
  })
})

describe('stripTrusteePrefix / hasTrusteePrefix', () => {
  it('detects the prefix whatever its casing', () => {
    expect(hasTrusteePrefix('The Trustee for Smith Family Trust')).toBe(true)
    expect(hasTrusteePrefix('SMITH PTY LTD')).toBe(false)
  })

  it('does not strip a name that merely starts with "TRUSTEE"', () => {
    expect(stripTrusteePrefix('TRUSTEE SERVICES PTY LTD')).toBe('TRUSTEE SERVICES PTY LTD')
  })
})

describe('tidyRegisterName', () => {
  it('title-cases a company name', () => {
    expect(tidyRegisterName('JONES PTY LTD')).toBe('Jones Pty Ltd')
  })

  it('leaves a name that is already mixed case alone', () => {
    expect(tidyRegisterName('Jones Pty Ltd')).toBe('Jones Pty Ltd')
  })

  it('leaves deliberate internal capitals alone', () => {
    expect(tidyRegisterName("McDonald's Bakery Pty Ltd")).toBe("McDonald's Bakery Pty Ltd")
  })

  it('keeps state abbreviations upper', () => {
    expect(tidyRegisterName('WHITLOCK CIVIL NSW PTY LTD')).toBe('Whitlock Civil NSW Pty Ltd')
    expect(tidyRegisterName('COASTAL QLD HOLDINGS PTY LTD')).toBe('Coastal QLD Holdings Pty Ltd')
  })

  it('keeps ATF upper', () => {
    expect(tidyRegisterName('WHITLOCK PTY LTD ATF WHITLOCK TRUST')).toBe(
      'Whitlock Pty Ltd ATF Whitlock Trust',
    )
  })

  it('fixes an all-caps acronym sitting inside an otherwise normal name', () => {
    expect(tidyRegisterName('Coastal NSW Holdings')).toBe('Coastal NSW Holdings')
  })

  it('capitalises after a hyphen', () => {
    expect(tidyRegisterName('SMITH-JONES PTY LTD')).toBe('Smith-Jones Pty Ltd')
  })

  it("capitalises after an apostrophe but not a possessive 's'", () => {
    expect(tidyRegisterName("O'BRIEN PTY LTD")).toBe("O'Brien Pty Ltd")
    expect(tidyRegisterName("JONES'S BAKERY")).toBe("Jones's Bakery")
  })

  it('keeps punctuation around a known token', () => {
    expect(tidyRegisterName('WHITLOCK CIVIL (PTY) LTD')).toBe('Whitlock Civil (Pty) Ltd')
  })

  it('leaves an ampersand as an ampersand', () => {
    expect(tidyRegisterName('SMITH & SONS PTY LTD')).toBe('Smith & Sons Pty Ltd')
  })

  it('collapses the double spaces the register is full of', () => {
    expect(tidyRegisterName('WHITLOCK  CIVIL PTY LTD')).toBe('Whitlock Civil Pty Ltd')
  })

  it('returns empty for an empty name rather than throwing', () => {
    expect(tidyRegisterName('')).toBe('')
    expect(tidyRegisterName('   ')).toBe('')
  })
})
