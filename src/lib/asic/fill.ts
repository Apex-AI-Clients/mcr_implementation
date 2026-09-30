import { formatDob, parseDobInput } from './dates'
import { digitsOnly } from './identifiers'
import type { AsicExtract, Director } from './types'

/**
 * Filling a form from an ASIC extract. Pure, and shared by every form that has
 * the upload: lead conversion and the intake company step.
 *
 * What an extract fills is narrow on purpose:
 *
 *   - the registered office address
 *   - the principal place of business
 *   - the directors: name and date of birth, one row each
 *
 * It never fills the company name, ACN or ABN, even when those boxes are empty.
 * They come from the business register lookup on the name fields, or from
 * typing, exactly as before. The extract's ACN is read for one thing only: to
 * notice that the PDF is for a different company than the one on the form.
 */

/** A director as the form holds it: the date of birth is what was typed. */
export interface DirectorRow {
  name: string
  /** "14/03/1970", "03/1970", "1970" or "". Validated on save, not as typed. */
  dateOfBirth: string
}

/** The three fields an extract fills. */
export interface AsicFields {
  registeredOfficeAddress: string
  principalPlaceOfBusiness: string
  directors: DirectorRow[]
}

export type AsicSource = 'asic_pdf' | 'asic_pdf_edited' | 'manual'

/**
 * A fill that has been applied and can still be undone.
 *
 * `filled` is what the extract put in the form, kept so a later save can tell
 * "saved as filled" from "filled, then edited". `previous` is what was there
 * before, for undo.
 */
export interface AsicFill {
  /** The extract's own date — the "as at". */
  extractedAt: string | null
  /**
   * Whose extract it was. Never filled into the form — kept only so an ACN
   * typed after the fill can still be checked against it.
   */
  acn: string
  companyName: string | null
  warnings: string[]
  filled: AsicFields
  previous: AsicFields
}

export const EMPTY_ASIC_FIELDS: AsicFields = {
  registeredOfficeAddress: '',
  principalPlaceOfBusiness: '',
  directors: [],
}

export function emptyDirectorRow(): DirectorRow {
  return { name: '', dateOfBirth: '' }
}

export function directorRows(directors: readonly Director[]): DirectorRow[] {
  return directors.map((director) => ({
    name: director.name,
    dateOfBirth: formatDob(director.dateOfBirth),
  }))
}

/**
 * Apply an extract to the fields it fills.
 *
 * Only what the extract actually has: a missing address or an empty director
 * list leaves what was typed alone rather than blanking it.
 */
export function applyExtract(current: AsicFields, extract: AsicExtract): AsicFill {
  const filled: AsicFields = {
    registeredOfficeAddress: extract.registeredOffice ?? current.registeredOfficeAddress,
    principalPlaceOfBusiness: extract.principalPlaceOfBusiness ?? current.principalPlaceOfBusiness,
    directors: extract.directors.length > 0 ? directorRows(extract.directors) : current.directors,
  }
  return {
    extractedAt: extract.extractedAt,
    acn: extract.acn,
    companyName: extract.companyName,
    warnings: extract.warnings,
    filled,
    previous: current,
  }
}

/**
 * Whether the extract is for a different company than the form.
 *
 * Only when the form has a whole ACN to compare with: an empty or half-typed
 * ACN is not a contradiction, and there is nothing to warn about.
 */
export function acnDiffers(formAcn: string, extractAcn: string): boolean {
  const typed = digitsOnly(formAcn)
  return typed.length === 9 && typed !== digitsOnly(extractAcn)
}

/** "123456780" -> "123 456 780", for the mismatch question. */
export function formatAcn(acn: string): string {
  const digits = digitsOnly(acn)
  return digits.length === 9 ? `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}` : acn
}

function isBlank(row: DirectorRow): boolean {
  return !row.name.trim() && !row.dateOfBirth.trim()
}

/**
 * What is wrong with each director row, or null. Same length as `rows`.
 *
 * A wholly blank row is fine — it is simply dropped on save. A date of birth
 * is optional; a name is not, once anything has been typed in the row.
 */
export function directorRowErrors(rows: readonly DirectorRow[]): (string | null)[] {
  return rows.map((row) => {
    if (isBlank(row)) return null
    if (!row.name.trim()) return "Enter the director's name."
    const parsed = parseDobInput(row.dateOfBirth)
    return parsed.ok ? null : parsed.message
  })
}

/** Form rows -> what is stored: blank rows dropped, dates as ISO. */
export function directorsForSave(rows: readonly DirectorRow[]): Director[] {
  return rows
    .filter((row) => !isBlank(row))
    .map((row) => {
      const parsed = parseDobInput(row.dateOfBirth)
      return { name: row.name.trim(), dateOfBirth: parsed.ok ? parsed.iso : null }
    })
}

function comparable(fields: AsicFields): string {
  return JSON.stringify({
    registered: fields.registeredOfficeAddress.trim(),
    principal: fields.principalPlaceOfBusiness.trim(),
    directors: directorsForSave(fields.directors),
  })
}

function isEmpty(fields: AsicFields): boolean {
  return (
    !fields.registeredOfficeAddress.trim() &&
    !fields.principalPlaceOfBusiness.trim() &&
    directorsForSave(fields.directors).length === 0
  )
}

/**
 * Where the fields being saved came from.
 *
 *   'asic_pdf'         filled from an extract and saved as filled
 *   'asic_pdf_edited'  filled from an extract, then an address or a director changed
 *   'manual'           typed by hand, no extract
 *   null               nothing there to have a source
 *
 * The browser decides this because only it knows what the fill contained; the
 * routes check the value is one of the three.
 */
export function sourceFor(
  fill: Pick<AsicFill, 'filled'> | null,
  current: AsicFields,
): AsicSource | null {
  if (fill) return comparable(fill.filled) === comparable(current) ? 'asic_pdf' : 'asic_pdf_edited'
  return isEmpty(current) ? null : 'manual'
}

/** A stored director on a read-only page: "Jane Sample · born 14/03/1970". */
export function describeDirector(director: Director): string {
  const born = formatDob(director.dateOfBirth)
  return born ? `${director.name} · born ${born}` : director.name
}

/** The line under the fields on a saved record. */
export function sourceLabel(source: string | null | undefined, asAt: string): string | null {
  if (source === 'asic_pdf') return `From ASIC extract as at ${asAt}`
  if (source === 'asic_pdf_edited') return `From ASIC extract as at ${asAt}, edited`
  return null
}

/** What a saved record says about where its ASIC fields came from. */
export interface SavedAsicOrigin {
  source: string | null
  extractedAt: string | null
  /** The fields as they were saved, to tell "unchanged" from "edited since". */
  fields: AsicFields
}

/**
 * The source and extract date to save, for a form editing an existing record.
 *
 * A fill made in this sitting decides it, exactly as at conversion. Without
 * one, the record's own origin carries forward: something that came from an
 * extract stays "from the extract" until a field it filled is changed, at which
 * point it becomes — and stays — "edited", keeping the extract's date. Emptied
 * out entirely, there is nothing left to have come from anywhere.
 */
export function resolveOrigin(
  fill: AsicFill | null,
  saved: SavedAsicOrigin | null,
  current: AsicFields,
): { source: AsicSource | null; extractedAt: string | null } {
  if (fill) return { source: sourceFor(fill, current), extractedAt: fill.extractedAt }

  const fromExtract = saved?.source === 'asic_pdf' || saved?.source === 'asic_pdf_edited'
  if (saved && fromExtract && !isEmpty(current)) {
    const unchanged = saved.source === 'asic_pdf' && comparable(saved.fields) === comparable(current)
    return { source: unchanged ? 'asic_pdf' : 'asic_pdf_edited', extractedAt: saved.extractedAt }
  }
  return { source: sourceFor(null, current), extractedAt: null }
}
