/**
 * Making register text readable.
 *
 * ABR stores names in ALL CAPS and stores a trust under its trustee:
 * "THE TRUSTEE FOR SMITH FAMILY TRUST". Dropped into a form field as-is, both
 * of those read as a mistake somebody has to go and correct.
 *
 * This tidies only the value that gets *filled in*. The result row keeps
 * showing the raw EntityName, because what the register actually says is the
 * thing staff are checking before they pick.
 */

const TRUSTEE_PREFIX = /^\s*(?:the\s+)?trustee\s+for\s+/i

export function hasTrusteePrefix(name: string): boolean {
  return TRUSTEE_PREFIX.test(name)
}

/** "THE TRUSTEE FOR SMITH FAMILY TRUST" -> "SMITH FAMILY TRUST". */
export function stripTrusteePrefix(name: string): string {
  return name.replace(TRUSTEE_PREFIX, '').trim()
}

/**
 * Tokens with a settled shape, which naive title case gets wrong.
 *
 * PTY and LTD are here as "Pty"/"Ltd" rather than left upper: that is how the
 * rest of the app writes them ("Whitlock Civil Pty Ltd"), and matching the
 * surrounding text is the point of tidying at all. The state abbreviations and
 * ATF stay upper, because "Nsw" and "Atf" are simply wrong.
 */
const KNOWN_TOKENS: Record<string, string> = {
  PTY: 'Pty',
  LTD: 'Ltd',
  ATF: 'ATF',
  NSW: 'NSW',
  VIC: 'VIC',
  QLD: 'QLD',
  WA: 'WA',
  SA: 'SA',
  TAS: 'TAS',
  ACT: 'ACT',
  NT: 'NT',
}

/** "SMITH" -> "Smith", keeping hyphen and apostrophe parts capitalised. */
function titleCaseWord(word: string): string {
  const parts = word.split(/([-'])/)
  let previousSeparator = ''

  return parts
    .map((part) => {
      if (part === '-' || part === "'") {
        previousSeparator = part
        return part
      }
      const afterApostrophe = previousSeparator === "'"
      previousSeparator = ''
      if (!part) return part
      // "JONES'S" -> "Jones's", but "O'BRIEN" -> "O'Brien". A single letter
      // after an apostrophe is a possessive, not the start of a name.
      if (afterApostrophe && part.length === 1) return part.toLowerCase()
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    })
    .join('')
}

function tidyToken(token: string): string {
  // Already mixed case — somebody (or the register) has cased this on purpose.
  // "McDonald's", "eStore", "iCare" all survive only because of this line.
  if (/[a-z]/.test(token)) return token

  const letters = token.replace(/[^A-Za-z]/g, '')
  const known = KNOWN_TOKENS[letters.toUpperCase()]
  // Replaces just the letters, so "(PTY)" and "PTY." keep their punctuation.
  if (known) return token.replace(letters, known)

  return titleCaseWord(token)
}

/**
 * Register text as a person would write it.
 *
 * Per token, so an all-caps acronym sitting inside an otherwise normal name is
 * still handled, and a name that already reads properly comes back untouched.
 * Runs of whitespace collapse to one space — ABR has plenty of double spaces.
 */
export function tidyRegisterName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ''
  return trimmed.split(/\s+/).map(tidyToken).join(' ')
}

/**
 * The trust's own name, for the trust name field.
 *
 * "THE TRUSTEE FOR SMITH FAMILY TRUST" -> "Smith Family Trust".
 */
export function tidyTrustName(entityName: string): string {
  return tidyRegisterName(stripTrusteePrefix(entityName))
}
