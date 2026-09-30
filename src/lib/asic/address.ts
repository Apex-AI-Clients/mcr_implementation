/**
 * Making an ASIC address readable.
 *
 * ASIC prints addresses in capitals: "UNIT 1, 10 SAMPLE ROAD, NORTH MELBOURNE
 * VIC 3051". tidyRegisterName (src/lib/abr/names.ts) is tuned for entity names
 * — it writes PTY and LTD as "Pty"/"Ltd" — and would turn "PO BOX" into
 * "Po Box". Addresses get their own token map instead, and names.ts is left
 * alone.
 *
 * Tidies casing only. Never reorders, drops or adds anything.
 */

const ADDRESS_TOKENS: Record<string, string> = {
  PO: 'PO',
  GPO: 'GPO',
  UNIT: 'Unit',
  U: 'U',
  LOT: 'Lot',
  LEVEL: 'Level',
  LVL: 'Lvl',
  SHOP: 'Shop',
  NSW: 'NSW',
  VIC: 'VIC',
  QLD: 'QLD',
  WA: 'WA',
  SA: 'SA',
  TAS: 'TAS',
  ACT: 'ACT',
  NT: 'NT',
}

/**
 * "NORTH" -> "North", "O'CONNOR" -> "O'Connor", "(EAST)" -> "(East)".
 * A lone letter after an apostrophe is a possessive: "JONES'S" -> "Jones's".
 */
function titleCase(word: string): string {
  return word
    .toLowerCase()
    .replace(/(^|[^a-z])([a-z])([a-z]*)/g, (_, before: string, first: string, rest: string) => {
      if (before === "'" && !rest) return before + first
      return before + first.toUpperCase() + rest
    })
}

function tidyToken(token: string): string {
  // Already mixed case — somebody cased it on purpose.
  if (/[a-z]/.test(token)) return token

  const letters = token.replace(/[^A-Za-z]/g, '')
  if (!letters) return token
  const known = ADDRESS_TOKENS[letters.toUpperCase()]
  // Only when the token is that word, possibly with punctuation ("VIC,").
  // "U1" or "12A" fall through: a unit or street number keeps its capitals.
  if (known && token.replace(/[^A-Za-z0-9]/g, '') === letters) return token.replace(letters, known)
  if (/\d/.test(token)) return token

  return titleCase(token)
}

export function tidyAddress(address: string): string {
  const trimmed = address.trim()
  if (!trimmed) return ''
  return trimmed.split(/\s+/).map(tidyToken).join(' ')
}
