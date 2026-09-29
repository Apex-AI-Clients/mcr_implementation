import { tidyRegisterName } from '@/lib/abr/names'

/**
 * An ASIC address as one readable line.
 *
 * ASIC stores addresses in capitals across separate parts:
 *
 *   { careOf: 'C/- EXAMPLE ACCOUNTANTS', line1: 'LEVEL 3',
 *     street: '12 EXAMPLE STREET', locality: 'NORTH MELBOURNE',
 *     state: 'VIC', postcode: '3051', country: 'AUSTRALIA' }
 *
 *   -> 'C/- Example Accountants, Level 3, 12 Example Street, North Melbourne VIC 3051'
 *
 * tidyRegisterName already does the casing the way the rest of the app writes
 * it — state codes stay upper, mixed case is left alone — so it is reused
 * rather than reinvented. Country is dropped when it is Australia, which is
 * every registered office there is; anything else is kept.
 *
 * The result goes into an editable text field, so the aim is "reads right
 * almost always", not a postal standard.
 *
 * Browser-safe: pure.
 */

export interface AsicAddressParts {
  careOf?: string | null
  line1?: string | null
  street?: string | null
  locality?: string | null
  state?: string | null
  postcode?: string | null
  country?: string | null
}

function part(value: string | null | undefined): string {
  return typeof value === 'string' ? tidyRegisterName(value) : ''
}

/** Null when nothing usable is there, so an empty address is never ''. */
export function formatAsicAddress(address: AsicAddressParts | null | undefined): string | null {
  if (!address) return null

  // "North Melbourne VIC 3051" — locality, state and postcode read as one unit.
  const place = [part(address.locality), part(address.state), part(address.postcode)]
    .filter(Boolean)
    .join(' ')

  const country = part(address.country)
  const showCountry = country && country.toUpperCase() !== 'AUSTRALIA'

  const line = [part(address.careOf), part(address.line1), part(address.street), place]
    .concat(showCountry ? [country] : [])
    .filter(Boolean)
    .join(', ')

  return line || null
}
