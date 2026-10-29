/**
 * An Australian address as one line → the forms' four boxes. Pure.
 *
 *   "Unit 1, 10 Sample Road, North Melbourne VIC 3051"
 *     → street "Unit 1, 10 Sample Road", suburb "North Melbourne", state "VIC", postcode "3051"
 *
 * Anything it cannot split goes whole into the street box, for staff to tidy.
 */

export interface AddressParts {
  street: string
  suburb: string
  state: string
  postcode: string
}

const STATES = 'NSW|VIC|QLD|SA|WA|TAS|NT|ACT'
const TAIL = new RegExp(`^(.*?)[,\\s]+(${STATES})\\.?[,\\s]+(\\d{4})\\s*(?:,?\\s*(?:australia|aus))?$`, 'i')

export function splitAddress(address: string | null | undefined): AddressParts | null {
  const text = (address ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  const m = TAIL.exec(text)
  if (!m) return { street: text, suburb: '', state: '', postcode: '' }
  const before = m[1].replace(/,\s*$/, '')
  const comma = before.lastIndexOf(',')
  // "10 Sample Road, North Melbourne": the suburb is after the last comma.
  // With no comma the street and suburb cannot be told apart: all of it is the street.
  const street = comma >= 0 ? before.slice(0, comma).trim() : before
  const suburb = comma >= 0 ? before.slice(comma + 1).trim() : ''
  return { street, suburb, state: m[2].toUpperCase(), postcode: m[3] }
}
