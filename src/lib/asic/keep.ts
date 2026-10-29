import type { Director } from './types'

/**
 * Keeping an ASIC extract on a client file (migration 0041): what it changes
 * on the file. Pure.
 *
 * Only two dates are written from it, for the CVL forms: the company's
 * registration date, and each director's appointment date. Names, addresses
 * and dates of birth on the file are left as staff saved them — the extract
 * filled those when it was uploaded, and staff may have corrected them since.
 */

const nameKey = (name: string) => name.toUpperCase().replace(/[^A-Z]/g, '')

/** Same year at least, when both have a date of birth; either missing is no evidence against. */
const dobCompatible = (a: string | null | undefined, b: string | null | undefined) =>
  !a || !b || a.slice(0, 4) === b.slice(0, 4)

/**
 * The file's directors with the extract's appointment dates added, matched by
 * name (letters only, any case) and a compatible date of birth. A director on
 * file the extract does not list keeps what it had. `matched` counts the
 * directors given a date.
 */
export function withAppointmentDates(
  onFile: Director[],
  fromExtract: Director[],
): { directors: Director[]; matched: number } {
  let matched = 0
  const directors = onFile.map((d) => {
    const hit = fromExtract.find(
      (e) => e.appointedOn && nameKey(e.name) === nameKey(d.name) && dobCompatible(e.dateOfBirth, d.dateOfBirth),
    )
    if (!hit?.appointedOn) return d
    matched++
    return { ...d, appointedOn: hit.appointedOn }
  })
  return { directors, matched }
}
